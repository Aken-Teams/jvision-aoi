"""Opt-in real YOLO smoke with random initialization; not an accuracy test."""
import os,io
import pytest
from pathlib import Path
@pytest.mark.skipif(os.getenv('TEST_YOLO')!='1',reason='Set TEST_YOLO=1 for actual YOLO CPU training')
def test_yolo_train_predict_export(tmp_path,monkeypatch):
    from ultralytics import YOLO
    from PIL import Image,ImageDraw
    from app.adapters import YOLOAdapter
    weight=tmp_path/'initial.pt';YOLO('yolo11n.yaml').save(weight)
    monkeypatch.setenv('YOLO_WEIGHTS',str(weight));monkeypatch.setenv('TRAIN_DEVICE','cpu');monkeypatch.setenv('YOLO_IMAGE_SIZE','64')
    split={}
    for name in ('train','val','test'):
        split[name]=[]
        for i in range(4):
            im=Image.new('RGB',(64,64),(150+i,150,150));ImageDraw.Draw(im).rectangle((16,20,40,24),fill='black')
            out=io.BytesIO();im.save(out,format='PNG')
            split[name].append({'id':f'{name}-{i}','raw':out.getvalue(),'label':'NG','boxes':[{'label':'scratch','x':.25,'y':.3125,'w':.375,'h':.0625}]})
    folder=tmp_path/'model';folder.mkdir();adapter=YOLOAdapter()
    result=adapter.train(split,folder,{'epochs':1,'batch_size':4,'learning_rate':.001},lambda *args:None)
    assert 'test' in result and (folder/'best.pt').exists()
    pred=adapter.predict(split['test'][0]['raw']);assert 'confidence' in pred and 'boxes' in pred
    assert adapter.export(folder,'onnx').is_file()
