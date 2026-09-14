"""Run inside API container: python -m app.manage USERNAME."""
import sys,getpass
from .core import init,rows,new,password_hash
if __name__=='__main__':
    if len(sys.argv)!=2: raise SystemExit('Usage: python -m app.manage USERNAME')
    init(); name=sys.argv[1]
    if any(u['username']==name for u in rows('user')): raise SystemExit('帳號已存在')
    password=getpass.getpass('Password (12+ chars): ')
    if len(password)<12: raise SystemExit('密碼過短')
    if password!=getpass.getpass('Confirm: '): raise SystemExit('密碼不一致')
    new('user',{'username':name,'password':password_hash(password)})
    print('帳號已建立；專案依使用者隔離。')
