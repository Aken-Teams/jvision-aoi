"""Run against real Docker stack: create demo -> RQ train -> deploy -> inference."""
import os,time,httpx
base=os.getenv('AOI_URL','http://localhost:3000')+'/api/v1'
with httpx.Client(base_url=base,timeout=120,trust_env=False) as c:
    r=c.post('/login',json={'username':os.getenv('ADMIN_USER','admin'),'password':os.environ['ADMIN_PASSWORD']}); r.raise_for_status()
    p=c.post('/demo'); p.raise_for_status(); pid=p.json()['id']
    j=c.post(f'/projects/{pid}/train',json={'adapter':'baseline'});j.raise_for_status(); jid=j.json()['id']
    for i in range(120):
        r=c.get(f'/projects/{pid}/overview');r.raise_for_status(); state=r.json(); job=next(x for x in state['job'] if x['id']==jid)
        if job['status']=='failed': raise RuntimeError(job.get('error'))
        if job['status']=='completed': break
        time.sleep(2)
    else: raise TimeoutError('Training did not finish')
    mid=job['model_id'];r=c.post(f'/projects/{pid}/deploy',json={'model_id':mid});r.raise_for_status()
    image=state['image'][0];raw=c.get(f'/images/{image["id"]}/content');raw.raise_for_status()
    r=c.post('/inference',data={'project_id':pid},files={'file':('sample.png',raw.content,'image/png')});r.raise_for_status()
    assert r.json()['result'] in ('PASS','FAIL','REVIEW')
    print({'project_id':pid,'job':job['status'],'result':r.json()['result'],'metrics':state['model'][0]['metrics']})
