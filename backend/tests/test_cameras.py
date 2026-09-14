import io,os,tempfile,subprocess,threading
from urllib.parse import urlsplit
from http.server import BaseHTTPRequestHandler,HTTPServer
import pytest
from PIL import Image

def png():
    b=io.BytesIO();Image.new('RGB',(32,24),'gray').save(b,format='PNG');return b.getvalue()

def test_camera_allowlist(monkeypatch):
    from app.cameras import validate_url
    monkeypatch.setenv('CAMERA_ALLOWED_IPS','192.168.1.50')
    assert validate_url('rtsp://user:password@192.168.1.50:554/live').hostname=='192.168.1.50'
    for url in ['file:///etc/passwd','http://127.0.0.1','http://169.254.169.254','http://192.168.1.51','https://example.com','rtsp://192.168.1.50:99999']:
        with pytest.raises(ValueError):validate_url(url)

def test_actual_http_snapshot(monkeypatch):
    from app import cameras
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200 if self.path=='/snapshot' else 302)
            self.send_header('Content-Type','image/png');self.end_headers();self.wfile.write(png())
        def log_message(self,*args):pass
    server=HTTPServer(('127.0.0.1',0),Handler);t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
    # Loopback is permitted only for this test fixture, not in production configuration.
    monkeypatch.setattr(cameras,'validate_url',urlsplit)
    try:
        raw=cameras.capture(f'http://127.0.0.1:{server.server_port}/snapshot')
        assert Image.open(io.BytesIO(raw)).size==(32,24)
        with pytest.raises(ValueError):cameras.capture(f'http://127.0.0.1:{server.server_port}/redirect')
    finally:server.shutdown();server.server_close();t.join()

def test_rtsp_timeout_and_decode(monkeypatch):
    from app import cameras
    monkeypatch.setenv('CAMERA_ALLOWED_IPS','192.168.1.50')
    seen=[]
    def success(cmd,**kw):seen.append((cmd,kw));return subprocess.CompletedProcess(cmd,0,stdout=png())
    monkeypatch.setattr(subprocess,'run',success)
    assert cameras.capture('rtsp://192.168.1.50/live')==png()
    assert seen[0][1]['timeout']==12 and '-rtsp_transport' in seen[0][0]
    def failure(*a,**kw):raise subprocess.TimeoutExpired('ffmpeg',12)
    monkeypatch.setattr(subprocess,'run',failure)
    with pytest.raises(ValueError,match='逾時'):cameras.capture('rtsp://user:secret@192.168.1.50/live')

def test_camera_api_credentials_and_ownership(monkeypatch):
    from app.main import app
    from app.core import get,new,password_hash
    from app.cameras import decrypt
    from fastapi.testclient import TestClient
    import httpx
    monkeypatch.setenv('SECRET_KEY','test-only-secret-key-with-more-than-32-chars')
    monkeypatch.setenv('ADMIN_PASSWORD','test-password-12345')
    monkeypatch.setenv('CAMERA_ALLOWED_IPS','192.168.1.50')
    with TestClient(app) as c:
        assert c.post('/api/v1/login',json={'username':'admin','password':'test-password-12345'}).status_code==200
        pid=c.post('/api/v1/projects',json={'name':'camera-test'}).json()['id']
        url='rtsp://operator:camera-secret@192.168.1.50/live'
        r=c.post(f'/api/v1/projects/{pid}/cameras',json={'name':'camera1','url':url});assert r.status_code==200,r.text
        cid=r.json()['id'];assert 'secret' not in r.text and 'encrypted_url' not in r.text
        assert decrypt(get(cid)['encrypted_url'])==url and 'camera-secret' not in get(cid)['encrypted_url']
        assert c.post(f'/api/v1/cameras/{cid}/capture').status_code==503
        monkeypatch.setenv('CAMERA_GATEWAY_URL','http://camera-gateway:8010');monkeypatch.setenv('CAMERA_GATEWAY_TOKEN','a'*32)
        monkeypatch.setattr(httpx,'post',lambda *a,**kw:httpx.Response(200,content=png()))
        r=c.post(f'/api/v1/cameras/{cid}/capture');assert list(Image.open(io.BytesIO(r.content)).getdata())==list(Image.open(io.BytesIO(png())).getdata())
        assert c.delete(f'/api/v1/cameras/{cid}').status_code==200
        assert c.post(f'/api/v1/cameras/{cid}/capture').status_code==409
        assert c.get(f'/api/v1/projects/{pid}/cameras').json()==[]
        new('user',{'username':'camera-other','password':password_hash('camera-other-password')})
        c.post('/api/v1/login',json={'username':'camera-other','password':'camera-other-password'})
        assert c.post(f'/api/v1/cameras/{cid}/capture').status_code==403
