"""Standalone inspection apps: per-app access codes and an operator-only runtime API bound to a project's active deployment."""
import os, re, time, json, hmac, base64, hashlib, secrets
from datetime import datetime
from typing import Literal
from fastapi import Depends, HTTPException, UploadFile, File, Form, Request, Response
from pydantic import BaseModel, Field
from .core import new, get, rows, update, auth, own, blob, secret, password_hash, verify_password
from .main import app, inspect_files, score, pass_labels, thumbnail, media_type, IMAGE_TASKS

SLUG = re.compile(r'^[\w-]{1,40}$')
CODE_DIGITS = 8
SESSION_SECONDS = 12 * 3600
MAX_FAILURES = 5


def public_app(a):
    base = os.getenv('RUNTIME_PUBLIC_URL', '').rstrip('/')
    return {**{k: v for k, v in a.items() if k != 'access_hash'}, 'url': f'{base}/{a["slug"]}' if base else f'/{a["slug"]}'}


def new_code():
    return ''.join(secrets.choice('0123456789') for _ in range(CODE_DIGITS))


def find_app(slug):
    found = [a for a in rows('app') if a['slug'] == slug and a.get('enabled', True)]
    if not found or get(found[0]['project_id'], 'project').get('deleted'): raise HTTPException(404, '找不到此檢測 App')
    return found[0]


# ---- Studio management (admin session) ----

class AppIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    slug: str = Field(min_length=1, max_length=40)
    alert_sound: bool = True


@app.get('/api/v1/projects/{pid}/apps')
def apps_list(pid: str, u=Depends(auth)):
    own(pid, u)
    return [public_app(a) for a in rows('app', pid) if a.get('enabled', True)]


@app.post('/api/v1/projects/{pid}/apps')
def apps_create(pid: str, b: AppIn, u=Depends(auth)):
    own(pid, u)
    slug = b.slug.strip()
    if not SLUG.match(slug): raise HTTPException(422, '網址名稱只能使用文字、數字、- 或 _，最多 40 字')
    if any(a['slug'] == slug and a.get('enabled', True) for a in rows('app')): raise HTTPException(409, '此網址名稱已被使用')
    code = new_code()
    a = new('app', {'name': b.name.strip(), 'slug': slug, 'alert_sound': b.alert_sound, 'access_hash': password_hash(code), 'enabled': True, 'token_version': 0, 'owner': u['id']}, pid)
    return {**public_app(a), 'access_code': code}


class AppPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    alert_sound: bool | None = None
    regenerate_code: bool = False


@app.patch('/api/v1/apps/{aid}')
def apps_update(aid: str, b: AppPatch, u=Depends(auth)):
    a = get(aid, 'app'); own(a['project_id'], u)
    changes = {k: v for k, v in (('name', b.name), ('alert_sound', b.alert_sound)) if v is not None}
    code = None
    if b.regenerate_code:
        # A new code signs out every operator session of this app.
        code = new_code(); changes.update(access_hash=password_hash(code), token_version=a.get('token_version', 0) + 1, failed=0, locked_until=0)
    a = update(aid, **changes)
    return {**public_app(a), **({'access_code': code} if code else {})}


@app.delete('/api/v1/apps/{aid}')
def apps_disable(aid: str, u=Depends(auth)):
    a = get(aid, 'app'); own(a['project_id'], u)
    update(aid, enabled=False, token_version=a.get('token_version', 0) + 1)
    return {'ok': True}


# ---- Operator runtime (access-code session, scoped to one app) ----

def app_token(a):
    payload = base64.urlsafe_b64encode(json.dumps({'app': a['id'], 'exp': time.time() + SESSION_SECONDS, 'version': a.get('token_version', 0)}).encode()).decode()
    return payload + '.' + hmac.new(secret(), payload.encode(), hashlib.sha256).hexdigest()


def operator(slug: str, request: Request):
    a = find_app(slug)
    raw = request.cookies.get(f'aoi_app_{a["id"]}') or request.headers.get('authorization', '').removeprefix('Bearer ')
    try:
        payload, sig = raw.split('.')
        if not hmac.compare_digest(sig, hmac.new(secret(), payload.encode(), hashlib.sha256).hexdigest()): raise ValueError()
        body = json.loads(base64.urlsafe_b64decode(payload))
        # Studio user tokens carry "uid" and are never valid here.
        if body.get('app') != a['id'] or body['exp'] < time.time() or body.get('version', 0) != a.get('token_version', 0): raise ValueError()
    except Exception: raise HTTPException(401, '請輸入存取碼')
    return a


class CodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)


@app.post('/api/runtime/{slug}/login')
def runtime_login(slug: str, b: CodeIn, response: Response):
    a = find_app(slug)
    if a.get('locked_until', 0) > time.time(): raise HTTPException(429, '嘗試次數過多，請 5 分鐘後再試')
    if not verify_password(re.sub(r'\D', '', b.code), a['access_hash']):
        failed = a.get('failed', 0) + 1
        update(a['id'], failed=failed, locked_until=time.time() + 300 if failed >= MAX_FAILURES else 0)
        raise HTTPException(401, '存取碼錯誤')
    update(a['id'], failed=0, locked_until=0)
    t = app_token(get(a['id']))
    response.set_cookie(f'aoi_app_{a["id"]}', t, httponly=True, samesite='strict', secure=os.getenv('COOKIE_SECURE', 'false') == 'true', max_age=SESSION_SECONDS)
    return {'ok': True, 'name': a['name'], 'access_token': t}


@app.post('/api/runtime/{slug}/logout')
def runtime_logout(slug: str, response: Response, a=Depends(operator)):
    response.delete_cookie(f'aoi_app_{a["id"]}')
    return {'ok': True}


@app.get('/api/runtime/{slug}/config')
def runtime_config(a=Depends(operator)):
    p = get(a['project_id'], 'project')
    d = get(p['active_deployment'], 'deployment') if p.get('active_deployment') else None
    models = rows('model', p['id'])
    version = next((i + 1 for i, m in enumerate(models) if d and m['id'] == d['model_id']), None)
    cameras = [{'id': c['id'], 'name': c['name']} for c in rows('camera', p['id']) if c.get('enabled', True)] if p['task'] in IMAGE_TASKS or p.get('pose_mode') == 'static' else []
    return {
        'app': {'id': a['id'], 'name': a['name'], 'slug': a['slug'], 'alert_sound': a.get('alert_sound', True)},
        'project': {'name': p['name'], 'task': p['task'], 'labels': p['labels'], 'pass_labels': pass_labels(p), 'pose_mode': p.get('pose_mode'), 'roi': p.get('roi')},
        'deployment': {'id': d['id'], 'threshold': d['threshold'], 'model_version': version, 'deployed_at': d['created_at']} if d else None,
        'cameras': cameras,
    }


def deployed_model(p):
    if not p.get('active_deployment'): raise HTTPException(409, '尚未部署模型，請聯絡管理員')
    return get(get(p['active_deployment'], 'deployment')['model_id'], 'model')


@app.post('/api/runtime/{slug}/preview')
async def runtime_preview(file: list[UploadFile] = File(...), a=Depends(operator)):
    p = get(a['project_id'], 'project'); m = deployed_model(p); start = time.perf_counter()
    try: _, primary, _, _ = await score(p, m, file)
    except HTTPException: raise
    except Exception as e: raise HTTPException(503, f'推論失敗：{type(e).__name__}')
    return {'primary': primary, 'latency_ms': round((time.perf_counter() - start) * 1000, 2)}


@app.post('/api/runtime/{slug}/inspect')
async def runtime_inspect(file: list[UploadFile] = File(...), mode: Literal['single', 'continuous'] = Form('single'), a=Depends(operator)):
    p = get(a['project_id'], 'project')
    r = await inspect_files(p, file, extra_fields={'app_id': a['id'], 'app_name': a['name'], 'trigger': mode})
    return runtime_record(r)


def runtime_record(r):
    return {k: r.get(k) for k in ('id', 'result', 'primary', 'latency_ms', 'created_at', 'review', 'trigger')}


@app.get('/api/runtime/{slug}/inspections')
def runtime_inspections(limit: int = 30, a=Depends(operator)):
    mine = [r for r in rows('inspection', a['project_id']) if r.get('app_id') == a['id']]
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    today = [r for r in mine if r['created_at'] >= start]
    counts = {k: sum(r['result'] == k for r in today) for k in ('PASS', 'FAIL', 'REVIEW')}
    return {'today': {**counts, 'total': len(today), 'pending_review': sum(r['result'] == 'REVIEW' and not r.get('review') for r in today)},
            'recent': [runtime_record(r) for r in reversed(mine[-max(1, min(limit, 100)):])]}


def app_inspection(iid, a):
    r = get(iid, 'inspection')
    if r.get('app_id') != a['id']: raise HTTPException(404, '找不到資料')
    return r


@app.get('/api/runtime/{slug}/inspections/{iid}/thumbnail')
def runtime_thumbnail(iid: str, a=Depends(operator)):
    return thumbnail(app_inspection(iid, a))


@app.get('/api/runtime/{slug}/inspections/{iid}/content')
def runtime_content(iid: str, a=Depends(operator)):
    r = app_inspection(iid, a)
    return Response(blob(r['key']), media_type=media_type(r['key']))


class OperatorReview(BaseModel):
    decision: Literal['PASS', 'FAIL']
    note: str = Field(min_length=1, max_length=1000)


@app.post('/api/runtime/{slug}/inspections/{iid}/review')
def runtime_review(iid: str, b: OperatorReview, a=Depends(operator)):
    r = app_inspection(iid, a)
    event = {'decision': b.decision, 'note': b.note, 'user': f'app:{a["id"]}', 'user_name': f'檢測 App · {a["name"]}', 'at': time.time()}
    new('audit', {'inspection_id': iid, **event}, r['project_id'])
    return runtime_record(update(iid, review=event))


@app.post('/api/runtime/{slug}/cameras/{cid}/capture')
def runtime_camera(cid: str, a=Depends(operator)):
    from .main import cameras_capture
    c = get(cid, 'camera')
    if c['project_id'] != a['project_id']: raise HTTPException(404, '找不到相機')
    owner = get(get(a['project_id'], 'project')['owner'], 'user')
    return cameras_capture(cid, owner)
