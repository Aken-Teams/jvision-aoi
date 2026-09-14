"""Download pretrained weights for transfer learning and pose projects; run only in a controlled build environment."""
from pathlib import Path
import hashlib, urllib.request
root=Path(__file__).resolve().parents[1]
weights=root/'weights'

def report(path): print(f'已儲存 {path}\nsha256 {hashlib.sha256(path.read_bytes()).hexdigest()}')

mobilenet=weights/'mobilenet_v3_small.pth'
if mobilenet.exists(): print(f'{mobilenet} 已存在，未覆寫。')
else:
    import torch
    from torchvision.models import mobilenet_v3_small, MobileNet_V3_Small_Weights
    torch.save(mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.IMAGENET1K_V1).state_dict(),mobilenet); report(mobilenet)

pose=weights/'yolo11n-pose.pt'
if pose.exists(): print(f'{pose} 已存在，未覆寫。')
else:
    urllib.request.urlretrieve('https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-pose.pt',pose); report(pose)
print('請將 weights/ 移入工廠主機；訓練時雜湊會寫入模型指標。')
