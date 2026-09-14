import os, json, uuid, hashlib, hmac, time, base64, secrets
from pathlib import Path
from contextlib import contextmanager
from sqlalchemy import create_engine, String, JSON, select
from sqlalchemy.orm import DeclarativeBase, mapped_column, Session
from fastapi import HTTPException, Request

ROOT = Path(os.getenv('DATA_DIR', './data')).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
DB_URL = os.getenv('DATABASE_URL', f'sqlite:///{ROOT}/aoi.db')
engine = create_engine(DB_URL, **({'connect_args': {'check_same_thread': False}} if DB_URL.startswith('sqlite') else {'pool_pre_ping': True}))
class Base(DeclarativeBase): pass
class Record(Base):
    __tablename__ = 'records'
    id = mapped_column(String(36), primary_key=True)
    kind = mapped_column(String(32), index=True)
    project_id = mapped_column(String(36), index=True, default='')
    data = mapped_column(JSON)

def init(): Base.metadata.create_all(engine)
def new(kind, data, project_id=''):
    rid = str(uuid.uuid4())
    with Session(engine) as s:
        s.add(Record(id=rid, kind=kind, project_id=project_id, data={**data, 'created_at': time.time()})); s.commit()
    return get(rid)
def get(rid, kind=None):
    with Session(engine) as s:
        r=s.get(Record,rid)
        if not r or (kind and r.kind != kind): raise HTTPException(404,'找不到資料')
        return {'id':r.id,'kind':r.kind,'project_id':r.project_id,**r.data}
def rows(kind, project_id=None):
    with Session(engine) as s:
        q=select(Record).where(Record.kind==kind)
        if project_id is not None: q=q.where(Record.project_id==project_id)
        return sorted([{'id':r.id,'kind':r.kind,'project_id':r.project_id,**r.data} for r in s.scalars(q).all()],key=lambda r:r['created_at'])
def update(rid, **changes):
    with Session(engine) as s:
        r=s.get(Record,rid)
        if not r: raise HTTPException(404,'找不到資料')
        r.data={**r.data,**changes}; s.commit()
    return get(rid)
def password_hash(password, salt=None):
    salt=salt or secrets.token_hex(16)
    return salt+':'+hashlib.scrypt(password.encode(),salt=salt.encode(),n=16384,r=8,p=1).hex()
def verify_password(password, value): return hmac.compare_digest(password_hash(password,value.split(':')[0]),value)
def secret():
    value=os.getenv('SECRET_KEY','')
    if len(value)<32: raise RuntimeError('SECRET_KEY 至少 32 字元')
    return value.encode()
def token(user):
    payload=base64.urlsafe_b64encode(json.dumps({'uid':user['id'],'exp':time.time()+28800,'version':user.get('token_version',0)}).encode()).decode()
    return payload+'.'+hmac.new(secret(),payload.encode(),hashlib.sha256).hexdigest()
def auth(request:Request):
    raw=request.cookies.get('aoi_session') or request.headers.get('authorization','').removeprefix('Bearer ')
    try:
        payload,sig=raw.split('.')
        if not hmac.compare_digest(sig,hmac.new(secret(),payload.encode(),hashlib.sha256).hexdigest()): raise ValueError()
        body=json.loads(base64.urlsafe_b64decode(payload))
        if body['exp']<time.time(): raise ValueError()
        user=get(body['uid'],'user')
        if body.get('version',0)!=user.get('token_version',0): raise ValueError()
        return user
    except Exception: raise HTTPException(401,'請先登入')
def own(project_id,user):
    p=get(project_id,'project')
    if p['owner']!=user['id']: raise HTTPException(403,'無權存取此專案')
    return p

def s3():
    import boto3
    return boto3.client('s3',endpoint_url=os.environ['S3_ENDPOINT'],aws_access_key_id=os.environ['S3_ACCESS_KEY'],aws_secret_access_key=os.environ['S3_SECRET_KEY'])
def put_blob(key, data):
    if os.getenv('S3_ENDPOINT'):
        client=s3(); bucket=os.getenv('S3_BUCKET','aoi')
        client.put_object(Bucket=bucket,Key=key,Body=data)
    else:
        path=ROOT/'blobs'/key; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
def blob(key):
    if os.getenv('S3_ENDPOINT'): return s3().get_object(Bucket=os.getenv('S3_BUCKET','aoi'),Key=key)['Body'].read()
    return (ROOT/'blobs'/key).read_bytes()
