"""Opt-in MobileNetV3 transfer learning smoke with random backbone weights; not an accuracy test."""
import os,io
import pytest
@pytest.mark.skipif(os.getenv('TEST_TRANSFER')!='1',reason='Set TEST_TRANSFER=1 for actual MobileNetV3 CPU training')
def test_transfer_train_predict_export(tmp_path,monkeypatch):
    import torch
    from torchvision.models import mobilenet_v3_small
    from PIL import Image,ImageDraw
    from app.adapters import Transfer
    weight=tmp_path/'mobilenet.pth';torch.save(mobilenet_v3_small().state_dict(),weight)
    monkeypatch.setenv('TRANSFER_WEIGHTS',str(weight));monkeypatch.setenv('TRAIN_DEVICE','cpu')
    def image(label,i):
        im=Image.new('RGB',(64,64),(150+i,150,150))
        if label=='NG': ImageDraw.Draw(im).line((5,30,60,30+i%5),fill=(20,20,20),width=4)
        b=io.BytesIO();im.save(b,format='PNG');return b.getvalue()
    split={name:[{'label':c,'raw':image(c,i)} for c in ('OK','NG') for i in range(n)] for name,n in (('train',6),('val',2),('test',2))}
    points=[]
    report=Transfer().train(split,tmp_path,{'epochs':3,'batch_size':4,'learning_rate':.001},lambda p,m,point=None:point and points.append(point))
    assert [p['epoch'] for p in points]==[1,2,3] and 'test' in report and len(report['backbone_sha256'])==64
    adapter=Transfer().load(tmp_path);r=adapter.predict(split['test'][0]['raw'])
    assert r['label'] in ('OK','NG') and abs(sum(r['scores'].values())-1)<1e-4
    onnx=pytest.importorskip('onnxruntime')
    assert adapter.export(tmp_path,'onnx').is_file()
    monkeypatch.setenv('TRANSFER_WEIGHTS',str(tmp_path/'missing.pth'))
    with pytest.raises(ValueError): Transfer().train(split,tmp_path,{'epochs':1,'batch_size':4,'learning_rate':.001},lambda *a:None)
