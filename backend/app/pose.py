"""Human pose keypoints with a local YOLO11 pose model, plus keypoint features and skeleton thumbnails."""
import io, os, threading
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

# COCO-17 order: nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles.
SKELETON = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 6), (5, 11), (6, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16)]
SEQUENCE_FRAMES = 8
MIN_CONF = .3
_model = None
_lock = threading.Lock()


def estimator():
    global _model
    with _lock:
        if _model is None:
            weight = Path(os.getenv('POSE_WEIGHTS', '/weights/yolo11n-pose.pt'))
            if not weight.is_file(): raise ValueError('請先將 YOLO11 姿勢模型權重 yolo11n-pose.pt 放入 /weights；Local Only 禁止自動下載')
            from ultralytics import YOLO
            _model = YOLO(str(weight))
        return _model


def detect(raw):
    """Keypoints of the most prominent person as (17, 3) [x, y, conf] normalized to the image, or None."""
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    model = estimator()
    device = 'cpu' if os.getenv('TRAIN_DEVICE', '0') == 'cpu' else None
    with _lock:
        r = model.predict(im, verbose=False, conf=.25, device=device)[0]
    if r.keypoints is None or not len(r.boxes): return None
    boxes = r.boxes.xyxy.cpu().numpy()
    best = int(np.argmax((boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1]) * r.boxes.conf.cpu().numpy()))
    xy = r.keypoints.xyn.cpu().numpy()[best]
    conf = r.keypoints.conf.cpu().numpy()[best] if r.keypoints.conf is not None else np.ones(17)
    return np.concatenate([xy, conf[:, None]], axis=1).astype(np.float32)


def frame_features(kp):
    """Translation/scale invariant (51,) vector: hip-centered, body-size normalized coordinates plus confidence."""
    kp = np.asarray(kp, np.float32)
    visible = kp[:, 2] >= MIN_CONF
    if visible.sum() < 3: return np.zeros(51, np.float32)
    hips = kp[[11, 12]][visible[[11, 12]]]
    center = hips[:, :2].mean(0) if len(hips) else kp[visible, :2].mean(0)
    pts = kp[visible, :2]
    scale = max(float(np.linalg.norm(pts.max(0) - pts.min(0))), 1e-3)
    xy = np.where(visible[:, None], (kp[:, :2] - center) / scale, 0)
    return np.concatenate([xy, np.where(visible, kp[:, 2], 0)[:, None]], axis=1).reshape(-1).astype(np.float32)


def features(keypoints):
    """Static (17,3) -> (51,); sequence (T,17,3) -> per-frame features plus frame-to-frame motion."""
    kp = np.asarray(keypoints, np.float32)
    if kp.ndim == 2: return frame_features(kp)
    frames = np.stack([frame_features(f) for f in kp])
    return np.concatenate([frames.reshape(-1), np.diff(frames, axis=0).reshape(-1)])


def draw_skeleton(im, kp, width=3):
    d = ImageDraw.Draw(im)
    w, h = im.size
    pt = lambda i: (kp[i][0] * w, kp[i][1] * h)
    for a, b in SKELETON:
        if kp[a][2] >= MIN_CONF and kp[b][2] >= MIN_CONF: d.line([pt(a), pt(b)], fill=(91, 141, 239), width=width)
    for i in range(17):
        if kp[i][2] >= MIN_CONF:
            x, y = pt(i); d.ellipse((x - width, y - width, x + width, y + width), fill=(91, 141, 239))
    return im


def montage(frames, keypoints, height=160):
    """Horizontal strip of up to four evenly spaced frames with skeletons, used as a sequence thumbnail."""
    picks = np.linspace(0, len(frames) - 1, min(4, len(frames))).round().astype(int)
    tiles = []
    for i in picks:
        im = Image.open(io.BytesIO(frames[i])).convert('RGB')
        im = im.resize((max(1, im.width * height // im.height), height))
        tiles.append(draw_skeleton(im, keypoints[i], 2))
    sheet = Image.new('RGB', (sum(t.width for t in tiles) + 4 * (len(tiles) - 1), height), (16, 43, 50))
    x = 0
    for t in tiles: sheet.paste(t, (x, 0)); x += t.width + 4
    out = io.BytesIO(); sheet.save(out, format='PNG', compress_level=3); return out.getvalue()


def synthetic_pose(rng, arms_up):
    """Plausible standing figure (17,3) with jitter; arms_up raises both wrists above the head."""
    cx, s = rng.uniform(.4, .6), rng.uniform(.8, 1.05)
    y = lambda v: .08 + v * .8 * s
    kp = np.array([
        [cx, y(.05)], [cx - .02, y(.03)], [cx + .02, y(.03)], [cx - .04, y(.05)], [cx + .04, y(.05)],
        [cx - .1, y(.2)], [cx + .1, y(.2)], [cx - .13, y(.36)], [cx + .13, y(.36)], [cx - .14, y(.5)], [cx + .14, y(.5)],
        [cx - .07, y(.55)], [cx + .07, y(.55)], [cx - .08, y(.75)], [cx + .08, y(.75)], [cx - .08, y(.95)], [cx + .08, y(.95)],
    ], np.float32)
    if arms_up:
        kp[7:9, 1] = y(.08); kp[9:11, 1] = y(-.08); kp[7, 0] = cx - .14; kp[8, 0] = cx + .14; kp[9, 0] = cx - .12; kp[10, 0] = cx + .12
    kp += rng.normal(0, .012, kp.shape).astype(np.float32)
    return np.concatenate([np.clip(kp, 0, 1), rng.uniform(.7, 1, (17, 1)).astype(np.float32)], axis=1)
