"""CPU development server; settings outside the deliverable, no fixed credentials."""
import os,secrets,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
os.environ.setdefault('SECRET_KEY',secrets.token_hex(32))
os.environ.setdefault('ADMIN_PASSWORD',secrets.token_hex(12))
os.environ.setdefault('SYNC_TRAIN','true')
os.environ.setdefault('PUBLIC_ORIGIN','http://localhost:3000')
print('開發帳號：admin；密碼請使用 ADMIN_PASSWORD 環境變數自行指定。',flush=True)
if 'DATABASE_URL' not in os.environ: os.environ.setdefault('DATA_DIR',str(root/'backend/data'))
subprocess.run([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000'],cwd=root/'backend',check=True)
