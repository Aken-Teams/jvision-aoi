import os,tempfile,io
os.environ['DATA_DIR']=tempfile.mkdtemp(prefix='aoi-test-')
os.environ['SECRET_KEY']='test-only-secret-key-with-more-than-32-chars'
os.environ['ADMIN_PASSWORD']='test-password-12345'
os.environ['SYNC_TRAIN']='true'
from fastapi.testclient import TestClient
from app.main import app
from app.core import new,password_hash,blob,get
from app.jobs import split_snapshot
from app import vlm
import pytest

@pytest.fixture(scope='module')
def client():
    with TestClient(app) as c:
        yield c

def login(c,name='admin',password='test-password-12345'):
    r=c.post('/api/v1/login',json={'username':name,'password':password});assert r.status_code==200,r.text

def test_unauthenticated(client):
    assert client.get('/api/v1/projects').status_code==401

def test_full_flow(client):
    login(client)
    p=client.post('/api/v1/demo').json();pid=p['id']
    state=client.get(f'/api/v1/projects/{pid}/overview').json(); assert len(state['image'])==60
    r=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'baseline'});assert r.status_code==200,r.text
    job=r.json(); assert job['status']=='completed',job
    splits=job['snapshot'];hashes=[{x['sha256'] for x in splits[k]} for k in ('train','val','test')]
    assert not hashes[0]&hashes[1] and not hashes[0]&hashes[2] and not hashes[1]&hashes[2]
    mid=job['model_id']; model=get(mid);assert model['metrics']['test']['accuracy']>=.8
    deploy=client.post(f'/api/v1/projects/{pid}/deploy',json={'model_id':mid,'threshold':.5}).json()
    for label,expected in [('OK','PASS'),('NG','FAIL')]:
        image=next(x for x in splits['test'] if x['label']==label)
        r=client.post('/api/v1/inference',data={'project_id':pid},files={'file':('test.png',blob(image['key']),'image/png')})
        assert r.status_code==200,r.text
        assert r.json()['result']==expected,r.json()
    # Threshold 1 forces genuine uncertainty into secondary inspection, no fake VLM output.
    d2=client.post(f'/api/v1/projects/{pid}/deploy',json={'model_id':mid,'threshold':1,'vlm_enabled':True}).json()
    r=client.post('/api/v1/inference',data={'project_id':pid},files={'file':('test.png',blob(image['key']),'image/png')})
    assert r.json()['result']=='REVIEW'; assert '未設定' in r.json()['secondary']['reason']
    iid=r.json()['id'];r=client.post(f'/api/v1/inspections/{iid}/review',json={'decision':'FAIL','note':'人工確認刮痕'})
    assert r.json()['review']['decision']=='FAIL'
    assert client.post(f'/api/v1/projects/{pid}/rollback/{deploy["id"]}').status_code==200
    state=client.get(f'/api/v1/projects/{pid}/overview').json();assert state['project']['active_deployment']==deploy['id']
    assert len(state['inspection'])==3
    assert client.get(f'/api/v1/models/{mid}/export').status_code==200
    assert client.get(f'/api/v1/models/{mid}/export?format=onnx').status_code==422
    assert client.post(f'/api/v1/projects/{pid}/images',data={'label':'NG'},files={'file':('again.png',blob(image['key']),'image/png')}).status_code==409
    other=new('user',{'username':'other','password':password_hash('other-password-123')})
    login(client,'other','other-password-123')
    assert client.get(f'/api/v1/projects/{pid}/overview').status_code==403
    assert client.get('/api/v1/projects').json()==[]
    assert client.get(f'/api/v1/images/{image["id"]}/content').status_code==403
    login(client)

def test_invalid_images_and_labels(client):
    login(client);p=client.post('/api/v1/projects',json={'name':'test'}).json()
    assert client.post(f'/api/v1/projects/{p["id"]}/images',files={'file':('bad.png',b'not an image')}).status_code==400
    assert client.post(f'/api/v1/projects/{p["id"]}/train',json={'adapter':'yolo'}).status_code==422
    assert client.post(f'/api/v1/projects/{p["id"]}/train',json={}).status_code==422
    assert client.post('/api/v1/projects',json={'name':'x','labels':['OK','OK']}).status_code==422

def test_origin(client):
    assert client.post('/api/v1/projects',json={'name':'x'},headers={'Origin':'https://untrusted.example'}).status_code==403

def test_group_split():
    images=[{'label':c,'group':f'{c}-{i//2}','sha256':str(i),'id':f'{c}-{i}'} for c in ('OK','NG') for i in range(12)]
    s=split_snapshot(images);groups=[{x['group'] for x in s[k]} for k in ('train','val','test')]
    assert all(not groups[i]&groups[j] for i,j in ((0,1),(0,2),(1,2)))
    with pytest.raises(ValueError): split_snapshot(images[:2])

def test_vlm_blocked(monkeypatch):
    monkeypatch.setenv('VLM_BASE_URL','https://example.com/v1')
    r=vlm.inspect(b'raw',{'label':'NG'});assert r['decision']=='REVIEW'

def test_cnn_optional(client):
    pytest.importorskip('torch')
    login(client);p=client.post('/api/v1/demo').json();pid=p['id']
    r=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'cnn','mode':'advanced','epochs':2})
    assert r.json()['status']=='completed',r.json()
    state=client.get(f'/api/v1/projects/{pid}/overview').json()
    x=state['image'][0]
    r=client.post('/api/v1/inference',data={'project_id':pid,'model_id':r.json()['model_id']},files={'file':('test.png',blob(x['key']),'image/png')})
    assert r.status_code==200 and r.json()['primary']['label'] in ('OK','NG')
    import zipfile
    bundle=client.get(f'/api/v1/models/{r.json()["model_id"]}/export')
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as z:
        assert {'cnn.pt','labels.json','manifest.json'} <= set(z.namelist())
    onnx=pytest.importorskip('onnxruntime')
    from app.adapters import CNN,pixels
    import numpy as np
    m=get(r.json()['model_id']);adapter=CNN().load(m['path']);path=adapter.export(m['path'],'onnx')
    session=onnx.InferenceSession(str(path),providers=['CPUExecutionProvider'])
    raw=blob(x['key']);logits=session.run(None,{'images':pixels(raw).transpose(2,0,1)[None]})[0]
    assert adapter.labels[int(np.argmax(logits))]==adapter.predict(raw)['label']

def test_logout_revokes_token(client):
    login(client)
    r=client.post('/api/v1/login',json={'username':'admin','password':'test-password-12345'})
    token=r.json()['access_token']
    assert client.post('/api/v1/logout').status_code==200
    assert client.get('/api/v1/me',headers={'Authorization':'Bearer '+token}).status_code==401
    login(client)

def test_vlm_schema_and_failure(monkeypatch):
    from PIL import Image
    import socket,httpx
    b=io.BytesIO();Image.new('RGB',(8,8)).save(b,format='PNG')
    monkeypatch.setenv('VLM_BASE_URL','http://vlm:8000/v1')
    monkeypatch.setattr(socket,'getaddrinfo',lambda *a,**kw:[(2,1,6,'',('10.0.0.2',8000))])
    class Reply:
        def raise_for_status(self):pass
        def json(self):return {'choices':[{'message':{'content':'{"decision":"NG","confidence":0.91,"reason":"刮痕","severity":3}'}}]}
    monkeypatch.setattr(httpx,'post',lambda *a,**kw:Reply())
    assert vlm.inspect(b.getvalue(),{'label':'NG'})['decision']=='NG'
    class Invalid(Reply):
        def json(self):return {'choices':[{'message':{'content':'{"decision":"PASS","confidence":2}'}}]}
    monkeypatch.setattr(httpx,'post',lambda *a,**kw:Invalid())
    assert vlm.inspect(b.getvalue(),{})['decision']=='REVIEW'
    def timeout(*a,**kw):raise httpx.TimeoutException('timeout')
    monkeypatch.setattr(httpx,'post',timeout)
    assert vlm.inspect(b.getvalue(),{})['decision']=='REVIEW'

def test_detection_annotation_validation(client):
    from PIL import Image
    login(client);p=client.post('/api/v1/projects',json={'name':'detection','task':'detection'}).json();pid=p['id']
    raw=io.BytesIO();Image.new('RGB',(20,20)).save(raw,format='PNG')
    r=client.post(f'/api/v1/projects/{pid}/images',data={'label':'NG'},files={'file':('im.png',raw.getvalue())});assert r.status_code==200
    iid=r.json()['id']
    assert client.put(f'/api/v1/images/{iid}/annotation',json={'label':'NG','boxes':[]}).status_code==422
    assert client.put(f'/api/v1/images/{iid}/annotation',json={'label':'NG','boxes':[{'label':'NG','x':.9,'y':0,'w':.3,'h':.2}]}).status_code==422
    r=client.put(f'/api/v1/images/{iid}/annotation',json={'label':'NG','boxes':[{'label':'NG','x':.1,'y':.2,'w':.3,'h':.2}]})
    assert r.status_code==200 and r.json()['reviewed']

@pytest.mark.skipif(os.getenv('TEST_REDIS')!='1',reason='Set TEST_REDIS=1 and install redislite for a real Redis queue smoke')
def test_real_redis_queue(client,monkeypatch,tmp_path):
    import redislite,subprocess,time
    from redis import Redis
    from rq import SimpleWorker,Queue
    server=subprocess.Popen([redislite.__redis_executable__,'--bind','127.0.0.1','--port','16379','--save','','--appendonly','no'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    url='redis://127.0.0.1:16379/0'
    monkeypatch.setenv('REDIS_URL',url);monkeypatch.setenv('SYNC_TRAIN','false')
    connection=Redis.from_url(url)
    try:
        for i in range(40):
            try:
                connection.ping();break
            except Exception:time.sleep(.1)
        else:raise RuntimeError('Redis did not start')
        login(client);p=client.post('/api/v1/demo').json();pid=p['id']
        r=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'baseline'})
        assert r.status_code==200 and r.json()['status']=='queued',r.text
        queue=Queue('gpu',connection=connection);assert queue.count==1
        SimpleWorker([queue],connection=connection).work(burst=True)
        state=client.get(f'/api/v1/projects/{pid}/overview').json()
        assert state['job'][0]['status']=='completed' and len(state['model'])==1
    finally:
        server.terminate();server.wait(timeout=5)
