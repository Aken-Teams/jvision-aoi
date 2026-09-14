"""Pose projects with the real YOLO11 pose model; skipped unless ultralytics and pose weights are available."""
import os,io,tempfile
import pytest
pytest.importorskip('ultralytics')
if not os.path.isfile(os.getenv('POSE_WEIGHTS','/weights/yolo11n-pose.pt')): pytest.skip('POSE_WEIGHTS not available',allow_module_level=True)
os.environ.setdefault('DATA_DIR',tempfile.mkdtemp(prefix='aoi-pose-'))
os.environ.setdefault('SECRET_KEY','test-only-secret-key-with-more-than-32-chars')
os.environ.setdefault('ADMIN_PASSWORD','test-password-12345')
os.environ['SYNC_TRAIN']='true'
from pathlib import Path
from PIL import Image,ImageEnhance,ImageOps
from fastapi.testclient import TestClient
import ultralytics
from app.main import app
from app.core import get
from app import pose

ASSETS=Path(ultralytics.__file__).parent/'assets'
def photo(name,i):
    im=Image.open(ASSETS/name).convert('RGB')
    im=ImageEnhance.Brightness(im).enhance(.8+i*.05)
    if i%2: im=ImageOps.mirror(im)
    b=io.BytesIO();im.save(b,format='JPEG',quality=90);return b.getvalue()
def blank():
    b=io.BytesIO();Image.new('RGB',(320,240),(200,200,200)).save(b,format='PNG');return b.getvalue()

@pytest.fixture(scope='module')
def client():
    with TestClient(app) as c:
        assert c.post('/api/v1/login',json={'username':'admin','password':'test-password-12345'}).status_code==200
        yield c

def test_detect_person():
    kp=pose.detect(photo('zidane.jpg',0));assert kp is not None and kp.shape==(17,3) and (kp[:,2]>.3).sum()>=8
    assert pose.detect(blank()) is None
    assert pose.features(kp).shape==(51,) and pose.features(pose.synthetic_pose(__import__('numpy').random.default_rng(0),True)).shape==(51,)

def test_static_pose_project(client):
    p=client.post('/api/v1/projects',json={'name':'pose','task':'pose','labels':['A','B'],'adapter':'pose'}).json();pid=p['id']
    assert p['pose_mode']=='static' and p['pass_labels']==['A']
    for label,name in (('A','zidane.jpg'),('B','bus.jpg')):
        for i in range(6):
            r=client.post(f'/api/v1/projects/{pid}/images',data={'label':label},files={'file':('p.jpg',photo(name,i),'image/jpeg')});assert r.status_code==200,r.text
            assert r.json()['media']=='pose' and len(r.json()['keypoints'])==17
    assert client.post(f'/api/v1/projects/{pid}/images',data={'label':'A'},files={'file':('b.png',blank())}).status_code==422
    x=client.get(f'/api/v1/projects/{pid}/overview').json()['image'][0]
    assert client.get(f'/api/v1/images/{x["id"]}/thumbnail').headers['content-type']=='image/png'
    job=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'pose','mode':'advanced','epochs':15,'learning_rate':.005}).json()
    assert job['status']=='completed',job
    model=get(job['model_id']);assert len(model['history'])==15
    client.post(f'/api/v1/projects/{pid}/deploy',json={'model_id':job['model_id'],'threshold':.5})
    r=client.post('/api/v1/inference',data={'project_id':pid},files={'file':('p.jpg',photo('zidane.jpg',9),'image/jpeg')}).json()
    assert r['primary']['label'] in ('A','B') and len(r['primary']['keypoints'])==17 and r['result'] in ('PASS','FAIL','REVIEW')
    r=client.post('/api/v1/inference',data={'project_id':pid},files={'file':('b.png',blank())}).json()
    assert r['result']=='REVIEW' and r['primary']['label']=='UNKNOWN'
    assert client.post(f'/api/v1/projects/{pid}/preview',files={'file':('p.jpg',photo('bus.jpg',3))}).json()['primary']['label'] in ('A','B')
    archive=client.get(f'/api/v1/projects/{pid}/archive').content
    imported=client.post('/api/v1/projects/import',files={'file':('p.zip',archive)}).json();assert imported['imported']==12

def test_sequence_pose_project(client):
    p=client.post('/api/v1/projects',json={'name':'seq','task':'pose','pose_mode':'sequence','labels':['動作','靜止']}).json();pid=p['id']
    for label,name in (('動作','zidane.jpg'),('靜止','bus.jpg')):
        for i in range(5):
            frames=[('file',(f'f{j}.jpg',photo(name,i+j),'image/jpeg')) for j in range(8)]
            r=client.post(f'/api/v1/projects/{pid}/images',data={'label':label,'group':f'{label}{i}'},files=frames);assert r.status_code==200,r.text
            assert r.json()['media']=='pose-sequence' and len(r.json()['keypoints'])==pose.SEQUENCE_FRAMES
    assert client.post(f'/api/v1/projects/{pid}/images',data={'label':'動作'},files=[('file',('b.png',blank()))]*8).status_code==422
    job=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'pose','mode':'advanced','epochs':10}).json();assert job['status']=='completed',job
    frames=[('file',(f'f{j}.jpg',photo('zidane.jpg',j),'image/jpeg')) for j in range(8)]
    r=client.post(f'/api/v1/projects/{pid}/preview',data={'model_id':job['model_id']},files=frames).json()
    assert r['primary']['label'] in ('動作','靜止') and len(r['primary']['keypoints'])==17

def test_pose_demo(client):
    p=client.post('/api/v1/demo?kind=pose').json();pid=p['id']
    job=client.post(f'/api/v1/projects/{pid}/train',json={'adapter':'pose','mode':'advanced','epochs':20,'learning_rate':.005}).json()
    assert job['status']=='completed' and get(job['model_id'])['metrics']['test']['accuracy']>=.8,job

def test_pose_detect_endpoint(client):
    pid=client.post('/api/v1/projects',json={'name':'live','task':'pose'}).json()['id']
    r=client.post(f'/api/v1/projects/{pid}/pose/detect',files={'file':('p.jpg',photo('zidane.jpg',0),'image/jpeg')}).json()
    assert len(r['keypoints'])==17
    assert client.post(f'/api/v1/projects/{pid}/pose/detect',files={'file':('b.png',blank())}).json()['keypoints'] is None
    img=client.post('/api/v1/projects',json={'name':'img'}).json()['id']
    assert client.post(f'/api/v1/projects/{img}/pose/detect',files={'file':('p.jpg',photo('zidane.jpg',0))}).status_code==422
