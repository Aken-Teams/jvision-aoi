"""Generate private deployment settings without fixed default passwords."""
from pathlib import Path
import secrets, os
root=Path(__file__).resolve().parents[1]
p=root/'.env'
if p.exists(): raise SystemExit('.env 已存在，保留原設定；請直接編輯。')
text=(root/'.env.example').read_text()
for placeholder in ('replace-with-at-least-12-characters','replace-with-at-least-32-random-characters','replace-with-random-hex'):
    while placeholder in text: text=text.replace(placeholder,secrets.token_hex(24),1)
p.write_text(text); os.chmod(p,0o600)
print('已建立 .env。請在此檔設定管理員密碼、PUBLIC_ORIGIN 與存取位址。')
