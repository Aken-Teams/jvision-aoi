"""Audio samples: WAV parsing, 16 kHz mono clips, log-mel features and spectrogram thumbnails (numpy only)."""
import io, struct
import numpy as np
from PIL import Image

SR = 16000
CLIP = SR  # every sample and inference window is one second
N_FFT, HOP, N_MELS = 512, 160, 64
MAX_BYTES = 20 * 1024 * 1024


def decode_wav(raw):
    """Returns (mono float32 in [-1, 1], sample_rate). Supports PCM 8/16/24/32-bit and 32/64-bit float WAV."""
    if len(raw) > MAX_BYTES: raise ValueError('音訊上限 20 MB')
    if raw[:4] != b'RIFF' or raw[8:12] != b'WAVE': raise ValueError('請上傳 WAV 音訊')
    pos, fmt, data = 12, None, None
    while pos + 8 <= len(raw):
        cid, size = raw[pos:pos + 4], struct.unpack('<I', raw[pos + 4:pos + 8])[0]
        body = raw[pos + 8:pos + 8 + size]
        if cid == b'fmt ': fmt = body
        elif cid == b'data': data = body
        pos += 8 + size + (size & 1)
    if fmt is None or data is None or len(fmt) < 16: raise ValueError('WAV 格式不完整')
    code, channels, rate = struct.unpack('<HHI', fmt[:8])
    bits = struct.unpack('<H', fmt[14:16])[0]
    if code == 0xFFFE and len(fmt) >= 26: code = struct.unpack('<H', fmt[24:26])[0]  # WAVE_FORMAT_EXTENSIBLE
    if not channels or not 4000 <= rate <= 192000: raise ValueError('不支援的取樣率或聲道')
    width = bits // 8
    if not width: raise ValueError('不支援的位元深度')
    data = data[:len(data) // (width * channels) * width * channels]
    if code == 1 and bits == 8: x = (np.frombuffer(data, np.uint8).astype(np.float32) - 128) / 128
    elif code == 1 and bits == 16: x = np.frombuffer(data, '<i2').astype(np.float32) / 32768
    elif code == 1 and bits == 24:
        b = np.frombuffer(data, np.uint8).reshape(-1, 3).astype(np.int32)
        x = ((b[:, 0] | b[:, 1] << 8 | b[:, 2] << 16) << 8 >> 8).astype(np.float32) / 8388608
    elif code == 1 and bits == 32: x = np.frombuffer(data, '<i4').astype(np.float32) / 2147483648
    elif code == 3 and bits == 32: x = np.frombuffer(data, '<f4').astype(np.float32)
    elif code == 3 and bits == 64: x = np.frombuffer(data, '<f8').astype(np.float32)
    else: raise ValueError('不支援的 WAV 編碼')
    x = x.reshape(-1, channels).mean(axis=1)
    return np.clip(np.nan_to_num(x), -1, 1), rate


def resample(x, rate):
    if rate == SR or not len(x): return x.astype(np.float32)
    n = int(round(len(x) * SR / rate))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def encode_wav(x):
    pcm = np.clip(np.round(np.asarray(x, np.float64) * 32768), -32768, 32767).astype('<i2').tobytes()
    return b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, SR, SR * 2, 2, 16) + b'data' + struct.pack('<I', len(pcm)) + pcm


def normalize_audio(raw, window='first'):
    """Decode, mix to mono, resample to 16 kHz and fix length to one second. Returns canonical WAV bytes."""
    x, rate = decode_wav(raw)
    x = resample(x, rate)
    if len(x) < SR // 4: raise ValueError('音訊太短，至少需要 0.25 秒')
    x = x[-CLIP:] if window == 'last' else x[:CLIP]
    if len(x) < CLIP: x = np.pad(x, (0, CLIP - len(x)))
    return encode_wav(x)


def samples(raw):
    x, rate = decode_wav(raw)
    x = resample(x, rate)[:CLIP]
    return np.pad(x, (0, CLIP - len(x))) if len(x) < CLIP else x


_filters = None
def mel_filters():
    global _filters
    if _filters is None:
        hz_to_mel = lambda f: 2595 * np.log10(1 + f / 700)
        mel_to_hz = lambda m: 700 * (10 ** (m / 2595) - 1)
        points = mel_to_hz(np.linspace(hz_to_mel(20), hz_to_mel(SR / 2), N_MELS + 2))
        bins = np.floor((N_FFT + 1) * points / SR).astype(int)
        fb = np.zeros((N_MELS, N_FFT // 2 + 1), np.float32)
        for m in range(1, N_MELS + 1):
            lo, center, hi = bins[m - 1], bins[m], bins[m + 1]
            if center > lo: fb[m - 1, lo:center] = (np.arange(lo, center) - lo) / (center - lo)
            if hi > center: fb[m - 1, center:hi] = (hi - np.arange(center, hi)) / (hi - center)
        _filters = fb
    return _filters


def logmel(x):
    """One-second waveform -> (N_MELS, frames) log-mel energies."""
    x = np.pad(x.astype(np.float32), (N_FFT // 2, N_FFT // 2), mode='reflect')
    frames = np.lib.stride_tricks.sliding_window_view(x, N_FFT)[::HOP] * np.hanning(N_FFT).astype(np.float32)
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    return np.log(mel_filters() @ power.T + 1e-6).astype(np.float32)


def features(x):
    """Per-clip standardized log-mel, shape (1, N_MELS, frames), used for training and inference alike."""
    m = logmel(x)
    return ((m - m.mean()) / (m.std() + 1e-5))[None]


# Dark navy -> violet -> orange -> pale yellow, similar to Teachable Machine audio thumbnails.
_STOPS = np.array([[8, 12, 38], [58, 38, 120], [170, 60, 120], [240, 130, 70], [252, 230, 160]], np.float32)
def spectrogram_png(raw, height=128):
    m = logmel(samples(raw))
    m = (m - np.percentile(m, 5)) / (np.percentile(m, 99.5) - np.percentile(m, 5) + 1e-6)
    t = np.clip(m[::-1], 0, 1) * (len(_STOPS) - 1)
    i = np.minimum(t.astype(int), len(_STOPS) - 2)
    rgb = _STOPS[i] + (_STOPS[i + 1] - _STOPS[i]) * (t - i)[..., None]
    im = Image.fromarray(rgb.astype(np.uint8)).resize((height * 101 // 64, height), Image.BILINEAR)
    out = io.BytesIO(); im.save(out, format='PNG'); return out.getvalue()


def synth_motor(rng, abnormal):
    """Synthetic one-second motor recording for the demo project: hum + harmonics + noise, abnormal adds bearing clicks and whine."""
    t = np.arange(CLIP) / SR
    base = rng.uniform(45, 62)
    x = sum(a * np.sin(2 * np.pi * base * k * t + rng.uniform(0, 6.28)) for k, a in ((1, .5), (2, .25), (3, .12), (5, .06)))
    x = x + rng.normal(0, .05, CLIP)
    if abnormal:
        x = x + .18 * np.sin(2 * np.pi * rng.uniform(2600, 3400) * t) * (1 + .5 * np.sin(2 * np.pi * rng.uniform(3, 7) * t))
        for start in rng.integers(0, CLIP - 200, int(rng.integers(6, 14))):
            x[start:start + 200] += rng.normal(0, .6, 200) * np.exp(-np.arange(200) / 40)
    x = x * rng.uniform(.5, 1.0) / (np.abs(x).max() + 1e-6)
    return encode_wav(x)
