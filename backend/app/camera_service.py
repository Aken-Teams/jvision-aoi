"""Dedicated LAN gateway; never publish its port to clients."""
import os,hmac
from fastapi import FastAPI,Header,HTTPException,Response
from pydantic import BaseModel,Field
from .cameras import capture
app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
class CaptureIn(BaseModel):
    url:str=Field(max_length=2048)
@app.post('/capture')
def read(b:CaptureIn,x_camera_token:str=Header('')):
    token=os.getenv('CAMERA_GATEWAY_TOKEN','')
    if len(token)<32 or not hmac.compare_digest(token,x_camera_token): raise HTTPException(401,'Unauthorized')
    try:return Response(capture(b.url),media_type='image/png')
    except ValueError as e:raise HTTPException(502,str(e))
