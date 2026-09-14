"""Planar, fixed-view 2D image metrology. Not a calibrated industrial gauge."""
import io,math
from typing import Literal
import numpy as np
from PIL import Image
from pydantic import BaseModel,Field,model_validator
class Point(BaseModel):
    x:float=Field(ge=0,le=1)
    y:float=Field(ge=0,le=1)
class ROI(BaseModel):
    x:float=Field(default=0,ge=0,lt=1);y:float=Field(default=0,ge=0,lt=1)
    w:float=Field(default=1,gt=0,le=1);h:float=Field(default=1,gt=0,le=1)
    @model_validator(mode='after')
    def fit(self):
        if self.x+self.w>1.000001 or self.y+self.h>1.000001:raise ValueError('ROI 超出影像')
        return self
class MeasureIn(BaseModel):
    mode:Literal['manual','automatic']
    points:list[Point]=Field(default=[],max_length=2)
    reference_points:list[Point]=Field(default=[],max_length=2)
    reference_mm:float|None=Field(default=None,gt=0,le=100000)
    roi:ROI=Field(default_factory=ROI)
    threshold:int=Field(default=100,ge=0,le=255)
    polarity:Literal['dark','bright']='dark'
    min_area_px:float=Field(default=25,gt=0)

def measure(raw,config:MeasureIn):
    im=Image.open(io.BytesIO(raw)).convert('RGB');w,h=im.size
    def xy(p):return (p.x*(w-1),p.y*(h-1))
    scale=None
    if config.reference_mm is not None:
        if len(config.reference_points)!=2:raise ValueError('請選取兩個校正點')
        distance=math.dist(xy(config.reference_points[0]),xy(config.reference_points[1]))
        if distance<5:raise ValueError('校正線至少需跨越 5 像素')
        scale=distance/config.reference_mm
    base={'mode':config.mode,'image_width':w,'image_height':h,'pixels_per_mm':scale,'unit':'mm' if scale else 'px','calibration_scope':'current_image','objects':[]}
    if config.mode=='manual':
        if len(config.points)!=2:raise ValueError('手動量測需要兩個點')
        length=math.dist(xy(config.points[0]),xy(config.points[1]))
        if length==0:raise ValueError('兩個量測點不可重疊')
        base['objects']=[{'length_px':length,'length':length/(scale or 1),'points':[xy(p) for p in config.points]}]
    else:
        import cv2
        r=config.roi;x0,y0=int(r.x*w),int(r.y*h);x1,y1=min(w,round((r.x+r.w)*w)),min(h,round((r.y+r.h)*h))
        if x1-x0<3 or y1-y0<3:raise ValueError('ROI 太小')
        gray=cv2.cvtColor(np.asarray(im)[y0:y1,x0:x1],cv2.COLOR_RGB2GRAY)
        _,mask=cv2.threshold(gray,config.threshold,255,cv2.THRESH_BINARY_INV if config.polarity=='dark' else cv2.THRESH_BINARY)
        contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        for c in sorted(contours,key=cv2.contourArea,reverse=True):
            area=float(cv2.contourArea(c))
            if area<config.min_area_px:continue
            bx,by,bw,bh=cv2.boundingRect(c)
            if bx==0 or by==0 or bx+bw>=gray.shape[1] or by+bh>=gray.shape[0]:continue
            rect=cv2.minAreaRect(c);length,width=sorted(rect[1],reverse=True)
            if width<=0:continue
            points=cv2.boxPoints(rect)+np.array([x0,y0]);factor=scale or 1
            base['objects'].append({'length_px':float(length),'width_px':float(width),'area_px2':area,'length':float(length/factor),'width':float(width/factor),'area':area/factor**2,'points':points.tolist()})
            if len(base['objects'])>=20:break
        if not base['objects']:raise ValueError('沒有找到完整輪廓：請調整 ROI、明暗極性或閾值，且物件不可接觸 ROI 邊界')
    return base
