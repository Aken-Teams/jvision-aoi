"""Network camera capture; credentials encrypted, hosts explicitly configured by admin."""
import os,io,base64,hashlib,ipaddress,subprocess
from urllib.parse import urlsplit,unquote
import httpx
from PIL import Image
from cryptography.fernet import Fernet
from .core import secret

def cipher(): return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret()).digest()))
def encrypt(value): return cipher().encrypt(value.encode()).decode()
def decrypt(value): return cipher().decrypt(value.encode()).decode()
def validate_url(url):
    try:
        p=urlsplit(url)
        if p.scheme not in ('rtsp','http','https') or not p.hostname or p.fragment: raise ValueError()
        ip=ipaddress.ip_address(p.hostname)
        allowed={x.strip() for x in os.getenv('CAMERA_ALLOWED_IPS','').split(',') if x.strip()}
        if str(ip) not in allowed or not ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified: raise ValueError()
        if p.port is not None and not 1<=p.port<=65535: raise ValueError()
        return p
    except Exception: raise ValueError('請使用管理員 CAMERA_ALLOWED_IPS 允許的廠內相機 IP 與 rtsp/http/https 位址')

def capture(url):
    p=validate_url(url)
    if p.scheme=='rtsp':
        command=['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-rtsp_transport','tcp','-timeout','5000000','-i',url,'-frames:v','1','-vf','scale=1920:1080:force_original_aspect_ratio=decrease','-f','image2pipe','-vcodec','png','pipe:1']
        try:
            r=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=12,check=True)
            raw=r.stdout
        except Exception: raise ValueError('RTSP 擷取失敗或逾時，請檢查相機路徑、帳密與網路') from None
    else:
        host=f'[{p.hostname}]' if ':' in p.hostname else p.hostname
        endpoint=f'{p.scheme}://{host}'+(f':{p.port}' if p.port else '')+(p.path or '/')+('?' + p.query if p.query else '')
        auth=httpx.BasicAuth(unquote(p.username or ''),unquote(p.password or '')) if p.username is not None else None
        try:
            with httpx.Client(trust_env=False,timeout=8,follow_redirects=False) as client:
                with client.stream('GET',endpoint,auth=auth) as response:
                    if response.status_code!=200: raise ValueError()
                    chunks=[];size=0
                    for part in response.iter_bytes():
                        size+=len(part)
                        if size>20*1024*1024: raise ValueError()
                        chunks.append(part)
                    raw=b''.join(chunks)
        except Exception: raise ValueError('HTTP 快照擷取失敗，請確認快照端點、Basic 帳密與憑證') from None
    try:
        im=Image.open(io.BytesIO(raw))
        if im.width*im.height>25_000_000: raise ValueError()
        out=io.BytesIO();im.convert('RGB').save(out,format='PNG');return out.getvalue()
    except Exception: raise ValueError('相機沒有回傳有效影像') from None
