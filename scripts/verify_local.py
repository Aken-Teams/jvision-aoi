"""Start real frontend+backend subprocesses and execute HTTP workflow."""
import subprocess,os,sys,time,secrets,tempfile
from pathlib import Path
import httpx
root=Path(__file__).resolve().parents[1]
env={**os.environ,'ADMIN_PASSWORD':secrets.token_hex(16),'SECRET_KEY':secrets.token_hex(32),'DATA_DIR':tempfile.mkdtemp(prefix='aoi-http-'),'SYNC_TRAIN':'true','NEXT_TELEMETRY_DISABLED':'1','AOI_URL':'http://127.0.0.1:3000'}
procs=[]
try:
    for cmd,cwd in [([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000'],root/'backend'),(['npm','run','start'],root/'frontend')]:
        procs.append(subprocess.Popen(cmd,cwd=cwd,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
    with httpx.Client(trust_env=False) as c:
        for i in range(60):
            try:
                r=c.get(env['AOI_URL']+'/api/v1/health');r.raise_for_status();break
            except Exception: time.sleep(.5)
        else: raise RuntimeError('HTTP server unavailable')
        r=c.get(env['AOI_URL']);r.raise_for_status();assert 'JVision' in r.text
    subprocess.run([sys.executable,'scripts/smoke.py'],cwd=root,env=env,check=True)
    print('Production frontend -> API -> training -> deployment -> inspection HTTP flow passed.')
finally:
    for p in procs:p.terminate()
    for p in procs:
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill()
