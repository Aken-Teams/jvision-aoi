import json, hashlib, random, traceback, os
from pathlib import Path
from .core import ROOT, get, update, new, blob, put_blob
from .adapters import ADAPTERS

def split_snapshot(images):
    # Group by user supplied lot; repeated bytes cannot cross boundaries.
    groups={}
    for x in images:
        groups.setdefault(x['group'] or x['sha256'],[]).append(x)
    by_class={}
    for gid,items in groups.items():
        signature='|'.join(sorted({x['label'] for x in items}))
        by_class.setdefault(signature,[]).append((gid,items))
    out={'train':[],'val':[],'test':[]}; rng=random.Random(42)
    for signature,units in sorted(by_class.items()):
        if len(units)<5: raise ValueError(f'{signature} 至少需要 5 個獨立影像或批次群組；建議 30 個以上')
        rng.shuffle(units); n=max(1,round(len(units)*0.15))
        for i,(_,items) in enumerate(units): out['test' if i<n else 'val' if i<2*n else 'train'].extend(items)
    return out

def train_job(job_id):
    j=get(job_id,'job'); folder=ROOT/'models'/job_id; folder.mkdir(parents=True,exist_ok=True)
    def progress(p,message):
        current=get(job_id); logs=current.get('logs',[])
        update(job_id,progress=p,logs=(logs+[message])[-200:])
    try:
        update(job_id,status='running',progress=1)
        split=j['snapshot']; hydrated={k:[{**x,'raw':blob(x['key'])} for x in v] for k,v in split.items()}
        adapter=ADAPTERS[j['adapter']]()
        report=adapter.train(hydrated,folder,j['parameters'],progress)
        manifest={**j,'metrics':report,'counts':{k:len(v) for k,v in split.items()}}
        (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
        for f in folder.iterdir():
            if f.is_file(): put_blob(f'models/{job_id}/{f.name}',f.read_bytes())
        model=new('model',{'name':j['name'],'adapter':j['adapter'],'job_id':job_id,'path':str(folder),'metrics':report,'counts':manifest['counts'],'parameters':j['parameters'],'snapshot_hash':j['snapshot_hash']},j['project_id'])
        update(job_id,status='completed',progress=100,model_id=model['id']); progress(100,'模型已登錄')
    except Exception as e:
        update(job_id,status='failed',error=str(e)); traceback.print_exc()
        raise
