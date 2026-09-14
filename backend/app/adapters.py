"""Real adapters: CPU baseline, small CNN and optional Ultralytics detector."""
import io, json, random, shutil
from pathlib import Path
from abc import ABC, abstractmethod
import numpy as np
from PIL import Image
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix

def pixels(raw, size=48):
    return np.asarray(Image.open(io.BytesIO(raw)).convert('RGB').resize((size,size)),dtype=np.float32)/255

def metrics(truth,pred,labels):
    p,r,f,_=precision_recall_fscore_support(truth,pred,labels=labels,average='macro',zero_division=0)
    return {'accuracy':float(accuracy_score(truth,pred)),'precision':float(p),'recall':float(r),'f1':float(f),'labels':labels,'confusion_matrix':confusion_matrix(truth,pred,labels=labels).tolist()}

class ModelAdapter(ABC):
    @abstractmethod
    def load(self,path): ...
    @abstractmethod
    def train(self,split,path,params,progress): ...
    @abstractmethod
    def predict(self,raw): ...
    def evaluate(self,items):
        return metrics([x['label'] for x in items],[self.predict(x['raw'])['label'] for x in items],self.labels)
    def export(self,path,format): raise ValueError(f'此模型不支援 {format} 匯出')

class Baseline(ModelAdapter):
    """Transparent CPU logistic regression baseline, not deep learning."""
    def feature(self,raw): return pixels(raw,24).reshape(-1)
    def load(self,path):
        z=np.load(Path(path)/'baseline.npz',allow_pickle=False)
        self.coef=z['coef']; self.intercept=z['intercept']; self.labels=z['labels'].tolist(); return self
    def train(self,split,path,params,progress):
        from sklearn.linear_model import LogisticRegression
        progress(10,'CPU baseline 訓練中')
        m=LogisticRegression(max_iter=300,random_state=42)
        m.fit(np.stack([self.feature(x['raw']) for x in split['train']]),[x['label'] for x in split['train']])
        np.savez(Path(path)/'baseline.npz',coef=m.coef_,intercept=m.intercept_,labels=m.classes_)
        self.load(path); progress(90,'計算獨立測試集指標')
        return {'validation':self.evaluate(split['val']),'test':self.evaluate(split['test'])}
    def predict(self,raw):
        logits=self.coef@self.feature(raw)+self.intercept
        if len(logits)==1:
            p=1/(1+np.exp(-np.clip(logits[0],-30,30))); probs=np.array([1-p,p])
        else:
            probs=np.exp(logits-logits.max()); probs/=probs.sum()
        i=int(probs.argmax())
        return {'label':self.labels[i],'confidence':float(probs[i]),'scores':dict(zip(self.labels,probs.tolist())),'boxes':[]}
    def export(self,path,format):
        if format!='native': return super().export(path,format)
        return Path(path)/'baseline.npz'

class CNN(ModelAdapter):
    def net(self,n):
        import torch.nn as nn
        return nn.Sequential(nn.Conv2d(3,16,3,padding=1),nn.ReLU(),nn.MaxPool2d(2),nn.Conv2d(16,32,3,padding=1),nn.ReLU(),nn.AdaptiveAvgPool2d((4,4)),nn.Flatten(),nn.Linear(512,n))
    def load(self,path):
        import torch
        self.labels=json.loads((Path(path)/'labels.json').read_text()); self.model=self.net(len(self.labels))
        self.model.load_state_dict(torch.load(Path(path)/'cnn.pt',map_location='cpu',weights_only=True)); self.model.eval(); return self
    def train(self,split,path,params,progress):
        import torch
        torch.manual_seed(42); self.labels=sorted({x['label'] for x in split['train']})
        device='cuda' if torch.cuda.is_available() else 'cpu'; m=self.net(len(self.labels)).to(device)
        x=torch.tensor(np.stack([pixels(x['raw']).transpose(2,0,1) for x in split['train']]))
        y=torch.tensor([self.labels.index(x['label']) for x in split['train']])
        loader=torch.utils.data.DataLoader(torch.utils.data.TensorDataset(x,y),batch_size=params['batch_size'],shuffle=True)
        opt=torch.optim.Adam(m.parameters(),lr=params['learning_rate']); lossfn=torch.nn.CrossEntropyLoss()
        best=float('inf')
        vx=torch.tensor(np.stack([pixels(x['raw']).transpose(2,0,1) for x in split['val']])).to(device)
        vy=torch.tensor([self.labels.index(x['label']) for x in split['val']]).to(device)
        for epoch in range(params['epochs']):
            m.train(); total=0
            for bx,by in loader:
                bx,by=bx.to(device),by.to(device)
                # brightness augmentation only; preserve orientation for industrial defects
                bx=torch.clamp(bx*(0.9+torch.rand(len(bx),1,1,1,device=device)*0.2),0,1)
                opt.zero_grad(); loss=lossfn(m(bx),by); loss.backward(); opt.step(); total+=loss.item()
            m.eval()
            with torch.no_grad(): val=float(lossfn(m(vx),vy).item())
            if val<best:
                best=val; torch.save({k:v.cpu().clone() for k,v in m.state_dict().items()},Path(path)/'cnn.pt')
            progress(int((epoch+1)/params['epochs']*85),f'epoch {epoch+1}/{params["epochs"]} · loss {total/len(loader):.4f} · val {val:.4f}')
        (Path(path)/'labels.json').write_text(json.dumps(self.labels)); self.load(path)
        return {'device':device,'validation':self.evaluate(split['val']),'test':self.evaluate(split['test'])}
    def predict(self,raw):
        import torch
        with torch.no_grad(): probs=self.model(torch.tensor(pixels(raw).transpose(2,0,1))[None]).softmax(1)[0].numpy()
        i=int(probs.argmax()); return {'label':self.labels[i],'confidence':float(probs[i]),'scores':dict(zip(self.labels,probs.tolist())),'boxes':[]}
    def export(self,path,format):
        import torch
        if format=='native': return Path(path)/'cnn.pt'
        if format!='onnx': return super().export(path,format)
        out=Path(path)/'cnn.onnx'; torch.onnx.export(self.model,torch.zeros(1,3,48,48),out,input_names=['images'],output_names=['logits'],opset_version=17,dynamo=False); return out

class YOLOAdapter(ModelAdapter):
    def load(self,path):
        from ultralytics import YOLO
        self.model=YOLO(str(Path(path)/'best.pt')); self.labels=list(self.model.names.values()); return self
    def train(self,split,path,params,progress):
        import os, yaml
        from ultralytics import YOLO
        weight=Path(os.getenv('YOLO_WEIGHTS','/weights/yolo11n.pt'))
        if not weight.is_file(): raise ValueError('請先將 YOLO 初始權重放入 /weights；Local Only 禁止自動下載')
        classes=sorted({b['label'] for s in split.values() for x in s for b in x['boxes']})
        if not classes: raise ValueError('至少需要一個已標註瑕疵框')
        for name,items in split.items():
            for folder in ('images','labels'): (Path(path)/'dataset'/name/folder).mkdir(parents=True,exist_ok=True)
            for x in items:
                (Path(path)/'dataset'/name/'images'/f'{x["id"]}.png').write_bytes(x['raw'])
                (Path(path)/'dataset'/name/'labels'/f'{x["id"]}.txt').write_text('\n'.join(f'{classes.index(b["label"])} {b["x"]+b["w"]/2} {b["y"]+b["h"]/2} {b["w"]} {b["h"]}' for b in x['boxes']))
        data=Path(path)/'data.yaml'; data.write_text(yaml.safe_dump({'path':str(Path(path)/'dataset'),'train':'train/images','val':'val/images','test':'test/images','names':classes}))
        m=YOLO(str(weight))
        m.add_callback('on_train_epoch_end',lambda t:progress(int((t.epoch+1)/params['epochs']*85),f'YOLO epoch {t.epoch+1}'))
        m.train(data=str(data),epochs=params['epochs'],batch=params['batch_size'],imgsz=int(os.getenv('YOLO_IMAGE_SIZE','640')),lr0=params['learning_rate'],project=str(path),name='run',exist_ok=True,workers=0,plots=False,device=os.getenv('TRAIN_DEVICE','0'),seed=42,fliplr=0,flipud=0)
        shutil.copy(Path(path)/'run/weights/best.pt',Path(path)/'best.pt'); self.load(path)
        result={}
        for splitname in ('val','test'):
            r=self.model.val(data=str(data),split=splitname,plots=False)
            result['validation' if splitname=='val' else 'test']={k:float(v) for k,v in r.results_dict.items()}
        return result
    def predict(self,raw):
        r=self.model.predict(Image.open(io.BytesIO(raw)),verbose=False,conf=0.1)[0]
        boxes=[{'label':self.model.names[int(c)],'confidence':float(p),'xyxy':xy.tolist()} for xy,c,p in zip(r.boxes.xyxy.cpu(),r.boxes.cls.cpu(),r.boxes.conf.cpu())]
        if not boxes: return {'label':'UNKNOWN','confidence':0.0,'boxes':[],'reason':'未檢出瑕疵不等於確認良品，需複判'}
        b=max(boxes,key=lambda b:b['confidence']); return {**b,'boxes':boxes}
    def export(self,path,format):
        if format=='native': return Path(path)/'best.pt'
        if format not in ('onnx','engine'): return super().export(path,format)
        return Path(self.model.export(format=format))

ADAPTERS={'baseline':Baseline,'cnn':CNN,'yolo':YOLOAdapter}
