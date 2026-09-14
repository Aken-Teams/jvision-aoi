"""Download the MobileNetV3 backbone for transfer learning; run only in a controlled build environment."""
from pathlib import Path
import hashlib
root=Path(__file__).resolve().parents[1]
out=root/'weights'/'mobilenet_v3_small.pth'
if out.exists(): raise SystemExit(f'{out} 已存在，未覆寫。')
import torch
from torchvision.models import mobilenet_v3_small, MobileNet_V3_Small_Weights
state=mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.IMAGENET1K_V1).state_dict()
torch.save(state,out)
print(f'已儲存 {out}\nsha256 {hashlib.sha256(out.read_bytes()).hexdigest()}\n請將 weights/ 移入工廠主機；訓練時此雜湊會寫入模型指標。')
