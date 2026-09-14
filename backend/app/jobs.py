import json, hashlib, random, traceback, os
from pathlib import Path
from .core import ROOT, get, update, new, blob, put_blob
from .adapters import ADAPTERS

MIN_UNITS=5
def split_snapshot(images,warnings=None):
    # Group by user supplied lot; repeated bytes cannot cross boundaries.
    # A class with too few lots but enough images falls back to per-image splitting, with a warning.
    groups={}
    for x in images:
        groups.setdefault(x['group'] or x['sha256'],[]).append(x)
    by_class={}
    for gid,items in groups.items():
        signature='|'.join(sorted({x['label'] for x in items}))
        by_class.setdefault(signature,[]).append((gid,items))
    out={'train':[],'val':[],'test':[]}; rng=random.Random(42)
    for signature,units in sorted(by_class.items()):
        if len(units)<MIN_UNITS:
            items=[x for _,group in units for x in group]
            if len(items)<MIN_UNITS: raise ValueError(f'{signature} 至少需要 {MIN_UNITS} 張影像；建議分 {MIN_UNITS} 次以上錄製、30 張以上')
            if warnings is not None: warnings.append(f'「{signature}」只有 {len(units)} 組批次，已改為逐張分割；測試集含同批次近似影像，準確率可能偏高')
            units=[(x['id'],[x]) for x in sorted(items,key=lambda x:x['sha256'])]
        rng.shuffle(units); n=max(1,round(len(units)*0.15))
        for i,(_,items) in enumerate(units): out['test' if i<n else 'val' if i<2*n else 'train'].extend(items)
    return out

def train_job(job_id):
    j=get(job_id,'job'); folder=ROOT/'models'/job_id; folder.mkdir(parents=True,exist_ok=True)
    def progress(p,message,point=None):
        current=get(job_id); logs=current.get('logs',[]); changes={}
        if point: changes['history']=current.get('history',[])+[point]
        update(job_id,progress=p,logs=(logs+[message])[-200:],**changes)
    try:
        update(job_id,status='running',progress=1)
        split=j['snapshot']; hydrated={k:[{**x,'raw':blob(x['key'])} for x in v] for k,v in split.items()}
        adapter=ADAPTERS[j['adapter']]()
        report=adapter.train(hydrated,folder,j['parameters'],progress)
        manifest={**j,'metrics':report,'counts':{k:len(v) for k,v in split.items()}}
        (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
        for f in folder.iterdir():
            if f.is_file(): put_blob(f'models/{job_id}/{f.name}',f.read_bytes())
        model=new('model',{'warnings':j.get('warnings',[]),'name':j['name'],'adapter':j['adapter'],'job_id':job_id,'path':str(folder),'metrics':report,'counts':manifest['counts'],'parameters':j['parameters'],'snapshot_hash':j['snapshot_hash'],'history':get(job_id).get('history',[])},j['project_id'])
        update(job_id,status='completed',progress=100,model_id=model['id']); progress(100,'模型已登錄')
    except Exception as e:
        update(job_id,status='failed',error=str(e)); traceback.print_exc()
        raise
