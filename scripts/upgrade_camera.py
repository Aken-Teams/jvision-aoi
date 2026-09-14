"""Add camera environment keys without overwriting existing deployment settings."""
from pathlib import Path
import secrets
p=Path(__file__).resolve().parents[1]/'.env'
if not p.exists():raise SystemExit('請先執行 python3 scripts/setup.py')
s=p.read_text();keys={line.split('=',1)[0] for line in s.splitlines() if '=' in line and not line.startswith('#')}
for key,value in [('CAMERA_ALLOWED_IPS',''),('CAMERA_GATEWAY_TOKEN',secrets.token_hex(32)),('CAMERA_GATEWAY_URL','')]:
    if key not in keys:s+='\n'+key+'='+value+'\n'
p.write_text(s);p.chmod(0o600)
print('已補齊相機設定欄位；請在 .env 填入 CAMERA_ALLOWED_IPS。既有密鑰未變更。')
