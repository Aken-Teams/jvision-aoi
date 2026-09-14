import io
import pytest
from PIL import Image,ImageDraw

def fixture_image():
    im=Image.new('RGB',(101,101),'white');ImageDraw.Draw(im).rectangle((20,30,80,50),fill='black')
    b=io.BytesIO();im.save(b,format='PNG');return b.getvalue()
def config(**extra):
    from app.measurement import MeasureIn
    return MeasureIn(**extra)
def test_manual_px_and_mm():
    from app.measurement import measure
    points=[{'x':0,'y':0},{'x':.3,'y':.4}]
    r=measure(fixture_image(),config(mode='manual',points=points));assert r['objects'][0]['length']==pytest.approx(50) and r['unit']=='px'
    r=measure(fixture_image(),config(mode='manual',points=points,reference_points=[{'x':.1,'y':.1},{'x':.3,'y':.1}],reference_mm=10))
    assert r['pixels_per_mm']==pytest.approx(2) and r['objects'][0]['length']==pytest.approx(25) and r['unit']=='mm'
def test_automatic_dimensions():
    from app.measurement import measure
    r=measure(fixture_image(),config(mode='automatic',reference_points=[{'x':.1,'y':.1},{'x':.3,'y':.1}],reference_mm=10))
    o=r['objects'][0];assert o['length']==pytest.approx(30);assert o['width']==pytest.approx(10);assert o['area']==pytest.approx(300)
    assert len(o['points'])==4

def test_invalid_calibration_roi_and_empty():
    from app.measurement import measure
    with pytest.raises(ValueError):measure(fixture_image(),config(mode='manual',points=[]))
    with pytest.raises(ValueError):measure(fixture_image(),config(mode='automatic',reference_mm=1,reference_points=[{'x':0,'y':0},{'x':0,'y':0}]))
    with pytest.raises(ValueError):config(mode='automatic',roi={'x':.9,'y':0,'w':.5,'h':1})
    with pytest.raises(ValueError,match='完整輪廓'):measure(fixture_image(),config(mode='automatic',roi={'x':.2,'y':.3,'w':.3,'h':.2}))

def test_measurement_api_history(monkeypatch):
    from app.main import app
    from fastapi.testclient import TestClient
    monkeypatch.setenv('SECRET_KEY','test-only-secret-key-with-more-than-32-chars');monkeypatch.setenv('ADMIN_PASSWORD','test-password-12345')
    with TestClient(app) as c:
        c.post('/api/v1/login',json={'username':'admin','password':'test-password-12345'})
        pid=c.post('/api/v1/projects',json={'name':'measurement-test'}).json()['id']
        r=c.post(f'/api/v1/projects/{pid}/measure',data={'config':'{"mode":"automatic"}'},files={'file':('rect.png',fixture_image(),'image/png')})
        assert r.status_code==200,r.text
        mid=r.json()['id'];assert r.json()['result']['objects'][0]['length']==60
        assert c.get(f'/api/v1/projects/{pid}/measurements').json()[0]['id']==mid
        assert c.get(f'/api/v1/measurements/{mid}/content').content==fixture_image()
        c.post('/api/v1/logout')
        assert c.get(f'/api/v1/measurements/{mid}/content').status_code==401
