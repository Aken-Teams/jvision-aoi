import os, io, time, json, uuid, hashlib
from contextlib import asynccontextmanager
from typing import Literal
from PIL import Image, UnidentifiedImageError
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Response, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator
from .core import *
from .jobs import split_snapshot, train_job
from .adapters import ADAPTERS
from . import vlm, runtime

@asynccontextmanager
async def lifespan(app):
    secret(); init()
    username=os.getenv('ADMIN_USER','admin'); password=os.getenv('ADMIN_PASSWORD','')
    if len(password)<12: raise RuntimeError('ADMIN_PASSWORD 至少 12 字元')
    if not rows('user'): new('user',{'username':username,'password':password_hash(password)})
    yield
app=FastAPI(title='JVision AOI Studio',version='0.1.0',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url='/api/v1/openapi.json')

@app.middleware('http')
async def security(request,call_next):
    # Reject cross-origin browser mutations; bearer clients remain supported.
    origin=request.headers.get('origin')
    if request.method not in ('GET','HEAD','OPTIONS') and origin:
        if origin.rstrip('/') != os.getenv('PUBLIC_ORIGIN','http://localhost:3000').rstrip('/'):
            return Response('Origin forbidden',status_code=403)
    r=await call_next(request); r.headers['X-Content-Type-Options']='nosniff'; r.headers['Cache-Control']='no-store'; return r

class Login(BaseModel):
    username:str=Field(max_length=100)
    password:str=Field(max_length=256)
@app.get('/api/v1/health')
def health(): return {'status':'ok','version':'0.1.0'}
@app.post('/api/v1/login')
def login(body:Login,response:Response):
    # Database backed lockout, shared between API processes.
    users=[u for u in rows('user') if u['username']==body.username]
    if not users: raise HTTPException(401,'帳號或密碼錯誤')
    u=users[0]
    if u.get('locked_until',0)>time.time(): raise HTTPException(429,'登入嘗試過多，請稍後再試')
    if not verify_password(body.password,u['password']):
        failed=u.get('failed',0)+1; update(u['id'],failed=failed,locked_until=time.time()+300 if failed>=5 else 0)
        raise HTTPException(401,'帳號或密碼錯誤')
    update(u['id'],failed=0,locked_until=0)
    t=token(u); response.set_cookie('aoi_session',t,httponly=True,samesite='strict',secure=os.getenv('COOKIE_SECURE','false')=='true',max_age=28800)
    return {'username':u['username'],'access_token':t,'token_type':'bearer'}
@app.post('/api/v1/logout')
def logout(response:Response,u=Depends(auth)):
    update(u['id'],token_version=u.get('token_version',0)+1)
    response.delete_cookie('aoi_session'); return {'ok':True}
@app.get('/api/v1/me')
def me(u=Depends(auth)): return {'username':u['username'],'id':u['id']}

def valid_labels(labels):
    return len(set(labels))==len(labels) and all(x.strip() and len(x)<=60 for x in labels)
class ProjectIn(BaseModel):
    name:str=Field(min_length=1,max_length=120)
    task:Literal['classification','detection']='classification'
    labels:list[str]=Field(default=['OK','NG'],min_length=2,max_length=30)
    adapter:Literal['transfer','baseline','cnn','yolo']|None=None
    @model_validator(mode='after')
    def valid(self):
        if not valid_labels(self.labels): raise ValueError('類別不可重複或空白')
        if self.adapter and (self.task=='detection')!=(self.adapter=='yolo'): raise ValueError('任務與模型類型不相容')
        if 'OK' not in self.labels: raise ValueError('須包含 OK 類別')
        return self
@app.get('/api/v1/projects')
def projects(u=Depends(auth)): return [p for p in rows('project') if p['owner']==u['id']]
@app.post('/api/v1/projects')
def create_project(b:ProjectIn,u=Depends(auth)): return new('project',{**b.model_dump(),'owner':u['id']})
class ProjectPatch(BaseModel):
    name:str=Field(min_length=1,max_length=120)
@app.patch('/api/v1/projects/{pid}')
def project_rename(pid:str,b:ProjectPatch,u=Depends(auth)):
    own(pid,u); return update(pid,name=b.name.strip() or '未命名專案')

ARCHIVE_FORMAT='jvision-aoi-project'
@app.get('/api/v1/projects/{pid}/archive')
def project_export(pid:str,u=Depends(auth)):
    # Samples and annotations only; model versions stay bound to this server's audit trail.
    import zipfile,tempfile
    p=own(pid,u); images=live_images(pid)
    manifest={'format':ARCHIVE_FORMAT,'version':1,'name':p['name'],'task':p['task'],'labels':p['labels'],'adapter':p.get('adapter'),
              'images':[{'file':f'images/{x["id"]}.png','label':x['label'],'group':x['group'],'boxes':x['boxes'],'reviewed':x['reviewed']} for x in images]}
    tmp=tempfile.NamedTemporaryFile(suffix='.zip',delete=False)
    with zipfile.ZipFile(tmp,'w',zipfile.ZIP_STORED) as z:
        z.writestr('project.json',json.dumps(manifest,ensure_ascii=False,indent=2))
        for x,m in zip(images,manifest['images']): z.writestr(m['file'],blob(x['key']))
    tmp.close()
    from starlette.background import BackgroundTask
    return FileResponse(tmp.name,filename=f'{p["name"][:60]}.aoi.zip',media_type='application/zip',background=BackgroundTask(os.unlink,tmp.name))
@app.post('/api/v1/projects/import')
async def project_import(file:UploadFile=File(...),u=Depends(auth)):
    import zipfile
    try:
        z=zipfile.ZipFile(file.file)
        info=z.getinfo('project.json')
        if info.file_size>20*1024*1024: raise ValueError()
        m=json.loads(z.read(info))
        if m.get('format')!=ARCHIVE_FORMAT or not isinstance(m.get('images'),list) or len(m['images'])>20000: raise ValueError()
        project=ProjectIn(name=str(m.get('name') or '匯入專案')[:120],task=m.get('task','classification'),labels=m.get('labels'),adapter=m.get('adapter'))
    except Exception: raise HTTPException(422,'不是有效的 JVision 專案檔')
    entries=[]
    for x in m['images']:
        try:
            item=z.getinfo(str(x['file']))
            if item.file_size>20*1024*1024 or x['label'] not in project.labels: raise ValueError()
            boxes=[Box(**b).model_dump() for b in x.get('boxes',[])]
            if any(b['label'] not in project.labels or b['label']=='OK' for b in boxes): raise ValueError()
            entries.append((item,x,boxes))
        except Exception: raise HTTPException(422,f'專案檔影像資料無效：{str(x.get("file",""))[:80]}')
    p=new('project',{**project.model_dump(),'owner':u['id']})
    skipped=0
    for item,x,boxes in entries:
        try: save_image(p['id'],z.read(item),x['label'],str(x.get('group',''))[:200],boxes,bool(x.get('reviewed')) and (project.task=='classification' or x['label']=='OK' or bool(boxes)))
        except HTTPException: skipped+=1
    return {**get(p['id']),'imported':len(entries)-skipped,'skipped':skipped}
@app.get('/api/v1/projects/{pid}/overview')
def overview(pid:str,u=Depends(auth)):
    p=own(pid,u)
    result={'project':p,'image':live_images(pid),**{kind:rows(kind,pid) for kind in ('job','model','deployment','inspection')}}
    for j in result['job']: j.pop('snapshot',None)
    return result

class ClassIn(BaseModel):
    name:str=Field(min_length=1,max_length=60)
@app.post('/api/v1/projects/{pid}/classes')
def class_add(pid:str,b:ClassIn,u=Depends(auth)):
    p=own(pid,u); labels=p['labels']+[b.name.strip()]
    if len(labels)>30: raise HTTPException(422,'類別最多 30 個')
    if not valid_labels(labels): raise HTTPException(422,'類別不可重複或空白')
    return update(pid,labels=labels)
@app.patch('/api/v1/projects/{pid}/classes/{name}')
def class_rename(pid:str,name:str,b:ClassIn,u=Depends(auth)):
    p=own(pid,u); new_name=b.name.strip()
    if name not in p['labels']: raise HTTPException(404,'找不到類別')
    if 'OK' in (name,new_name) and name!=new_name: raise HTTPException(422,'OK 類別不可改名')
    labels=[new_name if x==name else x for x in p['labels']]
    if not valid_labels(labels): raise HTTPException(422,'類別不可重複或空白')
    for x in rows('image',pid):
        if x['label']==name or any(box['label']==name for box in x['boxes']):
            update(x['id'],label=new_name if x['label']==name else x['label'],boxes=[{**box,'label':new_name if box['label']==name else box['label']} for box in x['boxes']])
    return update(pid,labels=labels)
@app.delete('/api/v1/projects/{pid}/classes/{name}')
def class_delete(pid:str,name:str,with_images:bool=False,u=Depends(auth)):
    p=own(pid,u)
    if name not in p['labels']: raise HTTPException(404,'找不到類別')
    if name=='OK': raise HTTPException(422,'OK 類別不可刪除')
    if len(p['labels'])<=2: raise HTTPException(422,'至少保留 2 個類別')
    images=[x for x in live_images(pid) if x['label']==name or any(box['label']==name for box in x['boxes'])]
    if images and not with_images: raise HTTPException(409,f'此類別仍有 {len(images)} 張影像')
    for x in images: update(x['id'],deleted=True)
    return update(pid,labels=[x for x in p['labels'] if x!=name])

def normalize(raw):
    if len(raw)>20*1024*1024: raise HTTPException(413,'影像上限 20 MB')
    try:
        im=Image.open(io.BytesIO(raw))
        if im.width*im.height>25_000_000: raise HTTPException(413,'影像像素過大')
        im=im.convert('RGB'); out=io.BytesIO(); im.save(out,format='PNG')
        return out.getvalue(),im.width,im.height
    except (UnidentifiedImageError,OSError,Image.DecompressionBombError): raise HTTPException(400,'無效影像')
def save_image(pid,raw,label,group='',boxes=None,reviewed=False):
    raw,w,h=normalize(raw); sha=hashlib.sha256(raw).hexdigest()
    if any(x['sha256']==sha for x in live_images(pid)): raise HTTPException(409,'此影像已存在')
    key=f'images/{pid}/{uuid.uuid4()}.png'; put_blob(key,raw)
    return new('image',{'key':key,'width':w,'height':h,'sha256':sha,'label':label,'group':group,'boxes':boxes or [],'reviewed':reviewed},pid)
@app.post('/api/v1/projects/{pid}/images')
async def upload(pid:str,file:UploadFile=File(...),label:str=Form('OK'),group:str=Form(''),u=Depends(auth)):
    p=own(pid,u)
    if label not in p['labels']: raise HTTPException(422,'類別不在專案內')
    return save_image(pid,await file.read(20*1024*1024+1),label,group[:200],reviewed=p['task']=='classification' or label=='OK')
@app.get('/api/v1/images/{iid}/content')
def content(iid:str,u=Depends(auth)):
    x=get(iid,'image'); own(x['project_id'],u); return Response(blob(x['key']),media_type='image/png')
@app.delete('/api/v1/images/{iid}')
def image_delete(iid:str,u=Depends(auth)):
    x=get(iid,'image'); own(x['project_id'],u); update(iid,deleted=True); return {'ok':True}
class Box(BaseModel):
    label:str
    x:float=Field(ge=0,lt=1); y:float=Field(ge=0,lt=1)
    w:float=Field(gt=0,le=1); h:float=Field(gt=0,le=1)
    @model_validator(mode='after')
    def fit(self):
        if self.x+self.w>1.000001 or self.y+self.h>1.000001: raise ValueError('標註超出影像')
        return self
class Annotation(BaseModel):
    label:str
    boxes:list[Box]=Field(default=[],max_length=500)
    reviewed:bool=True
@app.put('/api/v1/images/{iid}/annotation')
def annotate(iid:str,b:Annotation,u=Depends(auth)):
    x=get(iid,'image'); p=own(x['project_id'],u)
    if x.get('deleted'): raise HTTPException(404,'找不到資料')
    if b.label not in p['labels'] or any(box.label not in p['labels'] or box.label=='OK' for box in b.boxes): raise HTTPException(422,'瑕疵類別無效')
    if p['task']=='detection' and b.label!='OK' and not b.boxes: raise HTTPException(422,'NG 影像至少需要一個瑕疵框')
    if b.label=='OK' and b.boxes: raise HTTPException(422,'OK 影像不可含瑕疵框')
    return update(iid,**b.model_dump())

class TrainIn(BaseModel):
    adapter:Literal['baseline','cnn','transfer','yolo']='baseline'
    mode:Literal['fast','balanced','accurate','advanced']='fast'
    epochs:int=Field(default=10,ge=1,le=500)
    batch_size:int=Field(default=16,ge=1,le=128)
    learning_rate:float=Field(default=.001,ge=.000001,le=.1)
@app.post('/api/v1/projects/{pid}/train')
def train(pid:str,b:TrainIn,u=Depends(auth)):
    p=own(pid,u)
    if (p['task']=='detection') != (b.adapter=='yolo'): raise HTTPException(422,'任務與模型不相容')
    if any(j['status'] in ('queued','running') for j in rows('job',pid)): raise HTTPException(409,'此專案已有待執行或執行中的訓練')
    images=live_images(pid)
    if not images or any(not x['reviewed'] for x in images): raise HTTPException(422,'請完成所有影像標註確認')
    if set(x['label'] for x in images)!=set(p['labels']): raise HTTPException(422,'每個專案類別都需要訓練影像')
    warnings=[]
    try: snapshot=split_snapshot(images,warnings)
    except ValueError as e: raise HTTPException(422,str(e))
    params={'epochs':{'fast':5,'balanced':20,'accurate':50}.get(b.mode,b.epochs),'batch_size':b.batch_size if b.mode=='advanced' else 16,'learning_rate':b.learning_rate if b.mode=='advanced' else .001}
    job=new('job',{'name':f'{p["name"]} · {b.adapter} · {time.strftime("%m/%d %H:%M")}','adapter':b.adapter,'parameters':params,'snapshot':snapshot,'snapshot_hash':hashlib.sha256(json.dumps(snapshot,sort_keys=True).encode()).hexdigest(),'warnings':warnings,'status':'queued','progress':0,'logs':[]},pid)
    if os.getenv('SYNC_TRAIN','false')=='true':
        try: train_job(job['id'])
        except Exception: pass
    else:
        try:
            from redis import Redis
            from rq import Queue
            Queue('gpu',connection=Redis.from_url(os.environ['REDIS_URL'])).enqueue(train_job,job['id'],job_id=job['id'],job_timeout=86400,retry=None)
        except Exception:
            update(job['id'],status='failed',error='無法加入訓練佇列'); raise HTTPException(503,'訓練佇列不可用')
    return get(job['id'])

class DeployIn(BaseModel):
    model_id:str
    threshold:float=Field(default=.85,ge=.5,le=1)
    vlm_enabled:bool=False
    vlm_can_pass:bool=False
@app.post('/api/v1/projects/{pid}/deploy')
def deploy(pid:str,b:DeployIn,u=Depends(auth)):
    own(pid,u); m=get(b.model_id,'model')
    if m['project_id']!=pid: raise HTTPException(422,'模型不屬於專案')
    d=new('deployment',{**b.model_dump(),'name':f'部署 {time.strftime("%m/%d %H:%M:%S")}','state':'active'},pid)
    # active pointer is the authoritative deployment; old versions retained for rollback.
    update(pid,active_deployment=d['id']); return d
@app.post('/api/v1/projects/{pid}/rollback/{did}')
def rollback(pid:str,did:str,u=Depends(auth)):
    own(pid,u); d=get(did,'deployment')
    if d['project_id']!=pid: raise HTTPException(422,'部署不屬於專案')
    update(pid,active_deployment=did); return d
@app.post('/api/v1/inference')
async def inference(project_id:str=Form(...),file:UploadFile=File(...),model_id:str=Form(''),u=Depends(auth)):
    p=own(project_id,u); start=time.perf_counter()
    if model_id: m=get(model_id,'model'); policy={'threshold':.85,'vlm_enabled':False,'vlm_can_pass':False}; did=None
    else:
        if not p.get('active_deployment'): raise HTTPException(409,'請先部署模型')
        policy=get(p['active_deployment'],'deployment'); m=get(policy['model_id'],'model'); did=policy['id']
    if m['project_id']!=project_id: raise HTTPException(403,'無權使用此模型')
    raw,_,_=normalize(await file.read(20*1024*1024+1))
    try: primary=runtime.predict(m,raw)
    except Exception as e: raise HTTPException(503,f'推論失敗：{type(e).__name__}')
    decision='REVIEW'
    if primary['confidence']>=policy['threshold'] and primary['label']!='UNKNOWN': decision='PASS' if primary['label']=='OK' else 'FAIL'
    secondary=None
    if decision=='REVIEW' and policy['vlm_enabled']:
        secondary=vlm.inspect(raw,primary)
        if secondary['confidence']>=policy['threshold']:
            if secondary['decision']=='NG': decision='FAIL'
            elif secondary['decision']=='OK' and policy['vlm_can_pass']: decision='PASS'
    key=f'inspections/{project_id}/{uuid.uuid4()}.png'; put_blob(key,raw)
    return new('inspection',{'result':decision,'primary':primary,'secondary':secondary,'model_id':m['id'],'deployment_id':did,'latency_ms':round((time.perf_counter()-start)*1000,2),'key':key,'review':None},project_id)
@app.post('/api/v1/projects/{pid}/preview')
async def preview(pid:str,file:UploadFile=File(...),model_id:str=Form(''),u=Depends(auth)):
    # Live preview only: no stored image, no inspection record, no PASS/FAIL decision.
    p=own(pid,u); start=time.perf_counter()
    if model_id: m=get(model_id,'model')
    elif p.get('active_deployment'): m=get(get(p['active_deployment'],'deployment')['model_id'],'model')
    else:
        models=rows('model',pid)
        if not models: raise HTTPException(409,'請先訓練模型')
        m=models[-1]
    if m['project_id']!=pid: raise HTTPException(403,'無權使用此模型')
    raw,_,_=normalize(await file.read(20*1024*1024+1))
    try: primary=runtime.predict(m,raw)
    except Exception as e: raise HTTPException(503,f'推論失敗：{type(e).__name__}')
    return {'primary':primary,'model_id':m['id'],'latency_ms':round((time.perf_counter()-start)*1000,2)}
class ReviewIn(BaseModel):
    decision:Literal['PASS','FAIL']
    note:str=Field(min_length=1,max_length=1000)
@app.post('/api/v1/inspections/{iid}/review')
def review(iid:str,b:ReviewIn,u=Depends(auth)):
    r=get(iid,'inspection'); own(r['project_id'],u)
    event={'decision':b.decision,'note':b.note,'user':u['id'],'at':time.time()}
    new('audit',{'inspection_id':iid,**event},r['project_id'])
    return update(iid,review=event)
@app.get('/api/v1/inspections/{iid}/content')
def inspection_content(iid:str,u=Depends(auth)):
    r=get(iid,'inspection'); own(r['project_id'],u); return Response(blob(r['key']),media_type='image/png')
@app.get('/api/v1/models/{mid}/export')
def export(mid:str,format:Literal['native','onnx','engine']='native',u=Depends(auth)):
    m=get(mid,'model'); own(m['project_id'],u)
    try: path=ADAPTERS[m['adapter']]().load(m['path']).export(m['path'],format)
    except Exception as e: raise HTTPException(422,str(e))
    if format=='native':
        import zipfile
        bundle=Path(m['path'])/'deployment.zip'
        with zipfile.ZipFile(bundle,'w',zipfile.ZIP_DEFLATED) as z:
            z.write(path,path.name)
            for name in ('labels.json','manifest.json'):
                extra=Path(m['path'])/name
                if extra.exists(): z.write(extra,name)
        return FileResponse(bundle,filename=f'{mid}-deployment.zip')
    return FileResponse(path,filename=path.name)
@app.post('/api/v1/projects/{pid}/images/{iid}/suggest')
def suggest(pid:str,iid:str,u=Depends(auth)):
    p=own(pid,u); x=get(iid,'image')
    if x['project_id']!=pid: raise HTTPException(403,'無權存取')
    if not p.get('active_deployment'): raise HTTPException(409,'先部署初始模型才能使用模型輔助標註')
    m=get(get(p['active_deployment'])['model_id']); r=runtime.predict(m,blob(x['key']))
    return {'suggestion':r,'requires_confirmation':True}
@app.post('/api/v1/demo')
def demo(u=Depends(auth)):
    import numpy as np
    from PIL import ImageDraw
    p=new('project',{'name':'Demo · 合成金屬表面（非工業驗證）','task':'classification','labels':['OK','NG'],'owner':u['id'],'synthetic':True})
    rng=np.random.default_rng(42)
    for label in ('OK','NG'):
        for i in range(30):
            a=np.uint8(np.clip(rng.normal(160,12,(96,96,3)),0,255)); im=Image.fromarray(a)
            if label=='NG':
                d=ImageDraw.Draw(im); y=int(rng.integers(32,64)); d.line((12,y,84,y+int(rng.integers(-8,8))),fill=(25,25,25),width=int(rng.integers(3,7)))
            out=io.BytesIO(); im.save(out,format='PNG'); save_image(p['id'],out.getvalue(),label,reviewed=True)
    return p

@app.get('/api/v1/docs',include_in_schema=False)
def docs():
    import html
    table=''.join('<tr><td>'+html.escape(method.upper())+'</td><td>'+html.escape(path)+'</td><td>'+html.escape(info.get('summary',''))+'</td></tr>' for path,methods in app.openapi()['paths'].items() for method,info in methods.items())
    return Response('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>JVision API</title><style>body{font:16px/1.6 sans-serif;max-width:1100px;margin:40px auto;padding:20px;color:#142831}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}table{width:100%;border-collapse:collapse}</style><h1>JVision AOI Studio API</h1><p>認證使用 HttpOnly session 或 Authorization: Bearer token。</p><p><a href="/api/v1/openapi.json">下載完整 OpenAPI JSON</a></p><table><tr><th>方法</th><th>端點</th><th>功能</th></tr>'+table+'</table></html>',media_type='text/html')

class CameraIn(BaseModel):
    name:str=Field(min_length=1,max_length=120)
    url:str=Field(min_length=1,max_length=2048)
@app.get('/api/v1/projects/{pid}/cameras')
def cameras_list(pid:str,u=Depends(auth)):
    own(pid,u)
    return [{k:v for k,v in c.items() if k!='encrypted_url'} for c in rows('camera',pid) if c.get('enabled',True)]
@app.post('/api/v1/projects/{pid}/cameras')
def cameras_add(pid:str,b:CameraIn,u=Depends(auth)):
    from .cameras import validate_url,encrypt
    own(pid,u)
    try:p=validate_url(b.url)
    except ValueError as e:raise HTTPException(422,str(e))
    c=new('camera',{'name':b.name,'protocol':p.scheme,'host':p.hostname,'encrypted_url':encrypt(b.url),'enabled':True},pid)
    return {k:v for k,v in c.items() if k!='encrypted_url'}
@app.delete('/api/v1/cameras/{cid}')
def cameras_remove(cid:str,u=Depends(auth)):
    c=get(cid,'camera');own(c['project_id'],u);update(cid,enabled=False);return {'ok':True}
@app.post('/api/v1/cameras/{cid}/capture')
def cameras_capture(cid:str,u=Depends(auth)):
    from .cameras import decrypt
    import httpx
    c=get(cid,'camera');own(c['project_id'],u)
    if not c.get('enabled',True):raise HTTPException(409,'相機已停用')
    gateway=os.getenv('CAMERA_GATEWAY_URL','')
    if not gateway:raise HTTPException(503,'請先啟用 Camera Gateway 服務')
    try:
        r=httpx.post(gateway.rstrip('/')+'/capture',json={'url':decrypt(c['encrypted_url'])},headers={'X-Camera-Token':os.environ['CAMERA_GATEWAY_TOKEN']},timeout=15,trust_env=False,follow_redirects=False)
        if r.status_code!=200:raise ValueError()
        raw,_,_=normalize(r.content)
    except Exception:raise HTTPException(502,'相機擷取失敗，請檢查 Gateway、網路、串流路徑與帳密') from None
    return Response(raw,media_type='image/png',headers={'X-Camera-Id':cid})

@app.post('/api/v1/projects/{pid}/measure')
async def measurement(pid:str,file:UploadFile=File(...),config:str=Form(...),u=Depends(auth)):
    from .measurement import MeasureIn,measure
    own(pid,u)
    raw,_,_=normalize(await file.read(20*1024*1024+1))
    try:
        settings=MeasureIn.model_validate_json(config)
        result=measure(raw,settings)
    except ValueError as e:raise HTTPException(422,str(e))
    key=f'measurements/{pid}/{uuid.uuid4()}.png';put_blob(key,raw)
    return new('measurement',{'result':result,'settings':settings.model_dump(),'key':key,'creator':u['id']},pid)
@app.get('/api/v1/projects/{pid}/measurements')
def measurements(pid:str,u=Depends(auth)):
    own(pid,u);return rows('measurement',pid)
@app.get('/api/v1/measurements/{mid}/content')
def measurement_image(mid:str,u=Depends(auth)):
    m=get(mid,'measurement');own(m['project_id'],u);return Response(blob(m['key']),media_type='image/png')
