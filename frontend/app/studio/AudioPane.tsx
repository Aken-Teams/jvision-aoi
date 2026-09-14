"use client";
import { useEffect, useState } from "react";
import { Mic, X } from "lucide-react";
import { LevelMeter, splitClips, useMic } from "../lib/audio";
import { MIN_GROUPS } from "../lib/api";

const LENGTHS = [2, 5, 10, 20];

/** Microphone recording for an audio class: each take is split into one-second samples sharing one group. */
export default function AudioPane({
  open,
  groups,
  onClose,
  onTake,
}: {
  open: boolean;
  groups: number;
  onClose: () => void;
  onTake: (clips: Float32Array[]) => void;
}) {
  const mic = useMic();
  const [seconds, setSeconds] = useState(5),
    [progress, setProgress] = useState<number | null>(null);
  const { start, stop } = mic;
  useEffect(() => {
    if (open) start();
    else stop();
  }, [open, start, stop]);

  const record = async () => {
    setProgress(0);
    try {
      onTake(splitClips(await mic.record(seconds, setProgress)));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="capturePane">
      <div className="paneHead">
        <b>麥克風</b>
        <button className="iconButton" aria-label="關閉麥克風" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {mic.error && <div className="error">{mic.error}</div>}
      <LevelMeter level={mic.level} />
      <div className="row">
        <label>
          錄製長度
          <select value={seconds} disabled={progress !== null} onChange={(e) => setSeconds(+e.target.value)}>
            {LENGTHS.map((s) => (
              <option key={s} value={s}>
                {s} 秒 → {s} 個樣本
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="primary full" disabled={!mic.on || progress !== null} onClick={record}>
        <Mic size={16} />
        {progress === null ? `錄製 ${seconds} 秒` : `錄製中… ${Math.ceil(seconds * (1 - progress))} 秒`}
      </button>
      {progress !== null && <progress value={progress} max={1} className="recordProgress" />}
      <small>
        每 1 秒切成一個樣本，同一次錄製算一組。建議在不同時間、位置或負載下分 {MIN_GROUPS} 次以上錄製
        {groups < MIN_GROUPS ? `（目前 ${groups} / ${MIN_GROUPS} 組）` : ""}。
      </small>
    </div>
  );
}
