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
    history=get(r.json()['model_id'])['history'];assert [h['epoch'] for h in history]==[1,2] and 0<=history[-1]['val_acc']<=1
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

def test_classes_delete_and_preview(client):
    from app import runtime
    login(client);p=client.post('/api/v1/demo').json();pid=p['id']
    assert client.post(f'/api/v1/projects/{pid}/classes',json={'name':'刮傷'}).json()['labels']==['OK','NG','刮傷']
    assert client.post(f'/api/v1/projects/{pid}/classes',json={'name':'NG'}).status_code==422
    assert client.patch(f'/api/v1/projects/{pid}/classes/OK',json={'name':'GOOD'}).status_code==422
    assert client.delete(f'/api/v1/projects/{pid}/classes/OK').status_code==422
    r=client.patch(f'/api/v1/projects/{pid}/classes/NG',json={'name':'瑕疵'});assert r.json()['labels']==['OK','瑕疵','刮傷']
    state=client.get(f'/api/v1/projects/{pid}/overview').json()
    assert sum(x['label']=='瑕疵' for x in state['image'])==30 and not any(x['label']=='NG' for x in state['image'])
    assert client.delete(f'/api/v1/projects/{pid}/classes/刮傷').json()['labels']==['OK','瑕疵']
    # Classes with images need explicit confirmation.
    client.post(f'/api/v1/projects/{pid}/classes',json={'name':'髒污'})
    x=state['image'][0];raw=blob(x['key'])
    assert client.delete(f'/api/v1/images/{x["id"]}').status_code==200
    assert len(client.get(f'/api/v1/projects/{pid}/overview').json()['image'])==59
    r=client.post(f'/api/v1/projects/{pid}/images',data={'label':'髒污'},files={'file':('again.png',raw,'image/png')});assert r.status_code==200,r.text
    assert client.delete(f'/api/v1/projects/{pid}/classes/髒污').status_code==409
    assert client.delete(f'/api/v1/projects/{pid}/classes/髒污?with_images=true').status_code==200
    state=client.get(f'/api/v1/projects/{pid}/overview').json();assert len(state['image'])==59
    assert client.post(f'/api/v1/projects/{pid}/preview',files={'file':('p.png',raw,'image/png')}).status_code==409
    job=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'baseline'}).json();assert job['status']=='completed',job
    assert x['sha256'] not in {i['sha256'] for s in job['snapshot'].values() for i in s}
    before=len(state['inspection'])
    r=client.post(f'/api/v1/projects/{pid}/preview',files={'file':('p.png',raw,'image/png')});assert r.status_code==200,r.text
    assert set(r.json()['primary']['scores'])=={'OK','瑕疵'} and r.json()['model_id']==job['model_id']
    assert runtime.cached(job['model_id'])
    assert len(client.get(f'/api/v1/projects/{pid}/overview').json()['inspection'])==before

def test_detection_ok_upload_reviewed(client):
    from PIL import Image
    login(client);pid=client.post('/api/v1/projects',json={'name':'det','task':'detection'}).json()['id']
    raw=io.BytesIO();Image.new('RGB',(20,20),(9,9,9)).save(raw,format='PNG')
    assert client.post(f'/api/v1/projects/{pid}/images',data={'label':'OK'},files={'file':('ok.png',raw.getvalue())}).json()['reviewed']

def test_project_rename_archive_roundtrip(client):
    import zipfile,json as js
    login(client);p=client.post('/api/v1/demo').json();pid=p['id']
    assert client.patch(f'/api/v1/projects/{pid}',json={'name':'外觀檢查'}).json()['name']=='外觀檢查'
    assert client.post('/api/v1/projects',json={'name':'x','task':'detection','adapter':'transfer'}).status_code==422
    assert client.post('/api/v1/projects',json={'name':'x','adapter':'transfer'}).json()['adapter']=='transfer'
    x=client.get(f'/api/v1/projects/{pid}/overview').json()['image'][0]
    client.delete(f'/api/v1/images/{x["id"]}')
    r=client.get(f'/api/v1/projects/{pid}/archive');assert r.status_code==200
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        m=js.loads(z.read('project.json'));assert len(m['images'])==59 and len(z.namelist())==60
    r=client.post('/api/v1/projects/import',files={'file':('p.aoi.zip',r.content,'application/zip')});assert r.status_code==200,r.text
    imported=r.json();assert imported['name']=='外觀檢查' and imported['imported']==59 and imported['id']!=pid
    state=client.get(f'/api/v1/projects/{imported["id"]}/overview').json()
    assert len(state['image'])==59 and all(i['reviewed'] for i in state['image'])
    assert client.post('/api/v1/projects/import',files={'file':('bad.zip',b'not a zip')}).status_code==422
    other=io.BytesIO()
    with zipfile.ZipFile(other,'w') as z: z.writestr('project.json',js.dumps({'format':'jvision-aoi-project','labels':['OK','NG'],'images':[{'file':'../x.png','label':'NG'}]}))
    assert client.post('/api/v1/projects/import',files={'file':('evil.zip',other.getvalue())}).status_code==422

def test_few_groups_fallback_split():
    burst=[{'label':'OK','group':'burst-a','sha256':f'ok{i}','id':f'ok{i}'} for i in range(7)]
    groups=[{'label':'NG','group':f'g{i}','sha256':f'ng{i}','id':f'ng{i}'} for i in range(6)]
    warnings=[];s=split_snapshot(burst+groups,warnings)
    assert len(warnings)==1 and '「OK」' in warnings[0]
    assert all(any(x['label']=='OK' for x in s[k]) for k in ('train','val','test'))
    ng=[{x['group'] for x in s[k] if x['label']=='NG'} for k in ('train','val','test')]
    assert not ng[0]&ng[1] and not ng[0]&ng[2]
    with pytest.raises(ValueError): split_snapshot(burst[:4]+groups)

def test_train_with_single_burst_warns(client):
    from PIL import Image
    import numpy as np
    login(client);pid=client.post('/api/v1/projects',json={'name':'burst'}).json()['id']
    rng=np.random.default_rng(1)
    for label,value in (('OK',60),('NG',200)):
        for i in range(7):
            b=io.BytesIO();Image.fromarray(np.uint8(np.clip(rng.normal(value,10,(32,32,3)),0,255))).save(b,format='PNG')
            assert client.post(f'/api/v1/projects/{pid}/images',data={'label':label,'group':f'burst-{label}'},files={'file':('x.png',b.getvalue())}).status_code==200
    job=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'baseline'}).json()
    assert job['status']=='completed',job
    assert len(job['warnings'])==2
    assert len(get(job['model_id'])['warnings'])==2

def test_concurrent_uploads_dedupe(client):
    from PIL import Image
    from concurrent.futures import ThreadPoolExecutor
    import numpy as np
    login(client);pid=client.post('/api/v1/projects',json={'name':'concurrent'}).json()['id']
    rng=np.random.default_rng(7)
    frames=[]
    for i in range(6):
        b=io.BytesIO();Image.fromarray(np.uint8(rng.integers(0,255,(64,64,3)))).save(b,format='JPEG',quality=95);frames.append(b.getvalue())
    post=lambda raw:client.post(f'/api/v1/projects/{pid}/images',data={'label':'NG','group':'burst-x'},files={'file':('f.jpg',raw,'image/jpeg')}).status_code
    with ThreadPoolExecutor(8) as pool: codes=list(pool.map(post,frames+[frames[0]]*4))
    assert codes[:6]==[200]*6 or sorted(codes).count(200)==6, codes
    assert sorted(codes).count(200)==6 and sorted(codes).count(409)==4, codes
    assert len(client.get(f'/api/v1/projects/{pid}/overview').json()['image'])==6

def test_project_roi(client):
    login(client);pid=client.post('/api/v1/projects',json={'name':'roi'}).json()['id']
    r=client.patch(f'/api/v1/projects/{pid}',json={'roi':{'x':.1,'y':.2,'w':.5,'h':.6}});assert r.json()['roi']=={'x':.1,'y':.2,'w':.5,'h':.6}
    assert client.patch(f'/api/v1/projects/{pid}',json={'name':'改名'}).json()['roi']['w']==.5
    assert client.patch(f'/api/v1/projects/{pid}',json={'roi':{'x':.8,'y':0,'w':.5,'h':.5}}).status_code==422
    assert client.patch(f'/api/v1/projects/{pid}',json={'roi':{'x':0,'y':0,'w':.01,'h':.5}}).status_code==422
    archive=client.get(f'/api/v1/projects/{pid}/archive').content
    assert client.post('/api/v1/projects/import',files={'file':('p.zip',archive)}).json()['roi']['h']==.6
    assert client.patch(f'/api/v1/projects/{pid}',json={'roi':None}).json()['roi'] is None

def test_audio_project_flow(client):
    pytest.importorskip('torch')
    import zipfile,json as js
    import numpy as np
    from app import audio
    login(client)
    p=client.post('/api/v1/demo?kind=audio').json();pid=p['id']
    assert p['task']=='audio' and p['pass_labels']==['正常']
    state=client.get(f'/api/v1/projects/{pid}/overview').json()
    assert len(state['image'])==60 and all(x['media']=='audio' and x['reviewed'] for x in state['image'])
    x=state['image'][0]
    assert client.get(f'/api/v1/images/{x["id"]}/content').headers['content-type']=='audio/wav'
    thumb=client.get(f'/api/v1/images/{x["id"]}/thumbnail');assert thumb.headers['content-type']=='image/png'
    assert client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'transfer'}).status_code==422
    job=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'audio','mode':'advanced','epochs':6,'learning_rate':.003}).json()
    assert job['status']=='completed',job
    model=get(job['model_id']);assert model['metrics']['test']['accuracy']>=.8 and len(model['history'])==6
    client.post(f'/api/v1/projects/{pid}/deploy',json={'model_id':job['model_id'],'threshold':.5})
    rng=np.random.default_rng(99)
    for abnormal,expected in ((False,'PASS'),(True,'FAIL')):
        # A 3-second 44.1 kHz stereo recording: the server resamples, mixes down and scores the last second.
        clip=audio.samples(audio.synth_motor(rng,abnormal));long=np.tile(clip,3);up=np.interp(np.linspace(0,len(long)-1,int(len(long)*44100/16000)),np.arange(len(long)),long)
        pcm=(np.stack([up,up],1)*32767).astype('<i2').tobytes()
        import struct
        wav=b'RIFF'+struct.pack('<I',36+len(pcm))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,2,44100,44100*4,4,16)+b'data'+struct.pack('<I',len(pcm))+pcm
        r=client.post('/api/v1/inference',data={'project_id':pid},files={'file':('m.wav',wav,'audio/wav')});assert r.status_code==200,r.text
        assert r.json()['result']==expected,r.json()
        assert client.get(f'/api/v1/inspections/{r.json()["id"]}/thumbnail').status_code==200
    assert client.post(f'/api/v1/projects/{pid}/preview',files={'file':('m.wav',wav)}).json()['primary']['label']=='異常'
    assert client.post(f'/api/v1/projects/{pid}/images',data={'label':'正常'},files={'file':('bad.wav',b'RIFFnope')}).status_code==400
    # Pass labels follow class edits.
    assert client.patch(f'/api/v1/projects/{pid}',json={'pass_labels':['正常','不存在']}).status_code==422
    client.post(f'/api/v1/projects/{pid}/classes',json={'name':'背景'})
    assert client.patch(f'/api/v1/projects/{pid}',json={'pass_labels':['背景','正常']}).json()['pass_labels']==['正常','背景']
    assert client.patch(f'/api/v1/projects/{pid}/classes/正常',json={'name':'運轉正常'}).json()['pass_labels']==['運轉正常','背景']
    assert client.delete(f'/api/v1/projects/{pid}/classes/背景').json()['pass_labels']==['運轉正常']
    archive=client.get(f'/api/v1/projects/{pid}/archive').content
    with zipfile.ZipFile(io.BytesIO(archive)) as z: assert js.loads(z.read('project.json'))['images'][0]['file'].endswith('.wav')
    imported=client.post('/api/v1/projects/import',files={'file':('a.zip',archive)}).json()
    assert imported['task']=='audio' and imported['imported']==60 and imported['pass_labels']==['運轉正常']
    img=client.post('/api/v1/projects',json={'name':'img'}).json()
    assert client.patch(f'/api/v1/projects/{img["id"]}',json={'pass_labels':['NG']}).status_code==422
    assert client.post('/api/v1/projects',json={'name':'a','task':'audio','labels':['x','y'],'pass_labels':['z']}).status_code==422

def test_inspection_apps(client,monkeypatch):
    login(client)
    p=client.post('/api/v1/demo').json();pid=p['id']
    job=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'baseline'}).json()
    image=next(x for x in job['snapshot']['test'] if x['label']=='NG');raw=blob(image['key'])
    r=client.post(f'/api/v1/projects/{pid}/apps',json={'name':'產線 A','slug':'產線A'});assert r.status_code==200,r.text
    created=r.json();code=created['access_code'];aid=created['id']
    assert len(code)==8 and 'access_hash' not in created and created['url'].endswith('/產線A')
    assert client.post(f'/api/v1/projects/{pid}/apps',json={'name':'dup','slug':'產線A'}).status_code==409
    assert client.post(f'/api/v1/projects/{pid}/apps',json={'name':'bad','slug':'a/b'}).status_code==422
    assert 'access_code' not in client.get(f'/api/v1/projects/{pid}/apps').json()[0]
    studio_cookie=client.cookies.get('aoi_session')
    # The admin session is not an operator session.
    assert client.get('/api/runtime/產線A/config').status_code==401
    client.cookies.clear()
    for _ in range(5): assert client.post('/api/runtime/產線A/login',json={'code':'00000000'}).status_code==401
    assert client.post('/api/runtime/產線A/login',json={'code':code}).status_code==429
    from app.core import update as db_update
    db_update(aid,locked_until=0,failed=0)
    r=client.post('/api/runtime/產線A/login',json={'code':code[:4]+'-'+code[4:]});assert r.status_code==200,r.text
    app_token=r.json()['access_token']
    assert client.get('/api/v1/projects',headers={'Authorization':'Bearer '+app_token}).status_code==401
    cfg=client.get('/api/runtime/產線A/config').json();assert cfg['deployment'] is None and cfg['project']['pass_labels']==['OK']
    assert client.post('/api/runtime/產線A/inspect',files={'file':('x.png',raw,'image/png')}).status_code==409
    client.cookies.clear();client.cookies.set('aoi_session',studio_cookie)
    client.post(f'/api/v1/projects/{pid}/deploy',json={'model_id':job['model_id'],'threshold':.5})
    other=client.post(f'/api/v1/projects/{pid}/apps',json={'name':'B','slug':'line-b'}).json()
    client.cookies.clear()
    client.post('/api/runtime/產線A/login',json={'code':code})
    cfg=client.get('/api/runtime/產線A/config').json();assert cfg['deployment']['model_version']==1 and cfg['deployment']['threshold']==.5
    assert client.post('/api/runtime/產線A/preview',files={'file':('x.png',raw)}).json()['primary']['label']=='NG'
    r=client.post('/api/runtime/產線A/inspect',data={'mode':'continuous'},files={'file':('x.png',raw)}).json()
    assert r['result']=='FAIL' and r['trigger']=='continuous'
    stats=client.get('/api/runtime/產線A/inspections').json();assert stats['today']['FAIL']==1 and stats['today']['total']==1
    assert client.get(f'/api/runtime/產線A/inspections/{r["id"]}/thumbnail').status_code==200
    rv=client.post(f'/api/runtime/產線A/inspections/{r["id"]}/review',json={'decision':'FAIL','note':'確認刮痕'}).json()
    assert rv['review']['user_name']=='檢測 App · 產線 A'
    # Another app's session cannot see this app's inspections.
    assert client.get(f'/api/runtime/line-b/inspections/{r["id"]}/thumbnail').status_code==401
    client.post('/api/runtime/line-b/login',json={'code':other['access_code']})
    assert client.get(f'/api/runtime/line-b/inspections/{r["id"]}/thumbnail').status_code==404
    assert client.get('/api/runtime/line-b/inspections').json()['today']['total']==0
    # Origin: runtime host is accepted only for runtime paths.
    monkeypatch.setenv('RUNTIME_ORIGIN','https://inspect.example')
    assert client.post('/api/runtime/產線A/preview',files={'file':('x.png',raw)},headers={'Origin':'https://inspect.example'}).status_code==200
    assert client.post('/api/v1/projects',json={'name':'x'},headers={'Origin':'https://inspect.example'}).status_code==403
    # Regenerating the code signs operators out; disabling hides the app.
    client.cookies.clear();client.cookies.set('aoi_session',studio_cookie)
    new_code=client.patch(f'/api/v1/apps/{aid}',json={'regenerate_code':True}).json()['access_code'];assert new_code!=code or len(new_code)==8
    client.cookies.clear()
    assert client.get('/api/runtime/產線A/config',headers={'Authorization':'Bearer '+app_token}).status_code==401
    assert client.post('/api/runtime/產線A/login',json={'code':new_code}).status_code==200
    client.cookies.clear();client.cookies.set('aoi_session',studio_cookie)
    assert client.delete(f'/api/v1/apps/{aid}').status_code==200
    assert client.post('/api/runtime/產線A/login',json={'code':new_code}).status_code==404
    login(client)

def test_project_trash_and_restore(client):
    login(client)
    p=client.post('/api/v1/demo').json();pid=p['id']
    job=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'baseline'}).json()
    client.post(f'/api/v1/projects/{pid}/deploy',json={'model_id':job['model_id'],'threshold':.5})
    code=client.post(f'/api/v1/projects/{pid}/apps',json={'name':'trash','slug':'trash-app'}).json()['access_code']
    assert client.patch(f'/api/v1/projects/{pid}',json={'name':'改名後'}).json()['name']=='改名後'
    image=client.get(f'/api/v1/projects/{pid}/overview').json()['image'][0]
    assert client.delete(f'/api/v1/projects/{pid}').json()['deleted'] is True
    assert pid not in [x['id'] for x in client.get('/api/v1/projects').json()]
    assert [x['id'] for x in client.get('/api/v1/projects/trash').json()][0]==pid
    assert client.get(f'/api/v1/projects/{pid}/overview').status_code==404
    assert client.get(f'/api/v1/images/{image["id"]}/content').status_code==404
    assert client.post('/api/v1/inference',data={'project_id':pid},files={'file':('x.png',blob(image['key']))}).status_code==404
    assert client.post('/api/runtime/trash-app/login',json={'code':code}).status_code==404
    assert client.delete(f'/api/v1/projects/{pid}').status_code==404
    r=client.post(f'/api/v1/projects/{pid}/restore').json();assert r['deleted'] is False and r['active_deployment']
    assert client.get(f'/api/v1/projects/{pid}/overview').json()['project']['name']=='改名後'
    assert pid not in [x['id'] for x in client.get('/api/v1/projects/trash').json()]
    assert client.post('/api/runtime/trash-app/login',json={'code':code}).status_code==200
    client.cookies.clear();login(client)
    other=new('user',{'username':'trash-other','password':password_hash('other-password-123')})
    login(client,'trash-other','other-password-123')
    assert client.delete(f'/api/v1/projects/{pid}').status_code==403 and client.post(f'/api/v1/projects/{pid}/restore').status_code==403
    login(client)
