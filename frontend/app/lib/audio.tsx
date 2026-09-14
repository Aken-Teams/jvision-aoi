"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Audio samples are one-second, 16 kHz mono clips, matching backend app/audio.py. */
export const SR = 16000;
const RING_SECONDS = 3;

export function resample(input: Float32Array, rate: number): Float32Array {
  if (rate === SR) return input.slice();
  const out = new Float32Array(Math.round((input.length * SR) / rate));
  const step = (input.length - 1) / Math.max(1, out.length - 1);
  for (let i = 0; i < out.length; i++) {
    const pos = i * step,
      j = Math.floor(pos),
      t = pos - j;
    out[i] = input[j] * (1 - t) + (input[Math.min(j + 1, input.length - 1)] ?? 0) * t;
  }
  return out;
}

export function encodeWav(x: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + x.length * 2),
    v = new DataView(buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + x.length * 2, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(x[i] * 32768))), true);
  return new Blob([buffer], { type: "audio/wav" });
}

/** Splits a waveform into one-second clips; a trailing piece of at least half a second is zero-padded. */
export function splitClips(x: Float32Array, max = Infinity): Float32Array[] {
  const clips: Float32Array[] = [];
  for (let i = 0; i < x.length && clips.length < max; i += SR) {
    const piece = x.subarray(i, i + SR);
    if (piece.length < SR / 2) break;
    const clip = new Float32Array(SR);
    clip.set(piece);
    clips.push(clip);
  }
  return clips;
}

/** Decodes any browser-supported audio file (wav, mp3, m4a, ogg…) into 16 kHz mono one-second clips. */
export async function fileToClips(file: File, max = Infinity): Promise<Float32Array[]> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / buf.numberOfChannels;
    }
    return splitClips(resample(mono, buf.sampleRate), max);
  } catch {
    throw Error(`無法解碼音訊檔：${file.name}`);
  } finally {
    ctx.close();
  }
}

/**
 * Microphone input resampled to 16 kHz. Keeps the last few seconds in a ring buffer for live preview,
 * and records fixed-length takes for samples. Voice processing is disabled so machine sounds stay intact.
 */
export function useMic() {
  const stream = useRef<MediaStream | null>(null),
    ctx = useRef<AudioContext | null>(null),
    ring = useRef({ data: new Float32Array(SR * RING_SECONDS), write: 0, filled: 0 }),
    takes = useRef(new Set<(chunk: Float32Array) => void>());
  const [on, setOn] = useState(false),
    [level, setLevel] = useState(0),
    [error, setError] = useState("");

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    ctx.current?.close().catch(() => {});
    stream.current = null;
    ctx.current = null;
    ring.current.filled = 0;
    setOn(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (!navigator.mediaDevices) return setError("麥克風需要 HTTPS 或 localhost");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      return setError(`無法開啟麥克風：${(e as Error).message}`);
    }
    const audioCtx = new AudioContext();
    ctx.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream.current);
    // ScriptProcessor is deprecated but universally available and needs no separately served worklet module.
    const node = audioCtx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      const chunk = resample(e.inputBuffer.getChannelData(0), audioCtx.sampleRate);
      const r = ring.current;
      for (let i = 0; i < chunk.length; i++) {
        r.data[r.write] = chunk[i];
        r.write = (r.write + 1) % r.data.length;
      }
      r.filled = Math.min(r.data.length, r.filled + chunk.length);
      takes.current.forEach((take) => take(chunk));
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      setLevel(Math.min(1, Math.sqrt(sum / chunk.length) * 4));
    };
    source.connect(node);
    node.connect(audioCtx.destination); // output buffer is left silent
    setOn(true);
  }, []);

  useEffect(() => stop, [stop]);

  /** The most recent n samples, or null until enough audio has arrived. */
  const last = useCallback((n = SR) => {
    const r = ring.current;
    if (r.filled < n) return null;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = r.data[(r.write - n + i + r.data.length) % r.data.length];
    return out;
  }, []);

  /** Records `seconds` of audio from now; onProgress receives 0..1. */
  const record = useCallback(
    (seconds: number, onProgress?: (p: number) => void) =>
      new Promise<Float32Array>((resolve, reject) => {
        if (!ctx.current) return reject(Error("麥克風尚未開啟"));
        const total = seconds * SR,
          out = new Float32Array(total);
        let got = 0;
        const take = (chunk: Float32Array) => {
          const n = Math.min(chunk.length, total - got);
          out.set(chunk.subarray(0, n), got);
          got += n;
          onProgress?.(got / total);
          if (got >= total) {
            takes.current.delete(take);
            resolve(out);
          }
        };
        takes.current.add(take);
      }),
    [],
  );

  return { on, level, error, start, stop, last, record };
}

export function LevelMeter({ level }: { level: number }) {
  return (
    <div className="levelMeter" role="meter" aria-label="音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <div style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}
