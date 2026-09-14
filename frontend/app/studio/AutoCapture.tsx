"use client";
import { useEffect, useRef, useState } from "react";
import { Square, Timer } from "lucide-react";
import { newGroup } from "../lib/api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_FAILURES = 3;

/**
 * Timed capture into a class. Frames are taken one after another: the next capture starts only
 * after the previous frame is grabbed and uploaded, so slow RTSP connections never pile up.
 */
export default function AutoCapture({
  grab,
  save,
  minInterval,
  defaultInterval,
  disabled,
  onDone,
}: {
  grab: () => Promise<Blob | null>;
  save: (blob: Blob, group: string) => Promise<void>;
  minInterval: number;
  defaultInterval: number;
  disabled?: boolean;
  onDone: () => void;
}) {
  const [interval, setInterval_] = useState(defaultInterval),
    [limit, setLimit] = useState(30),
    [independent, setIndependent] = useState(false),
    [running, setRunning] = useState(false),
    [taken, setTaken] = useState(0),
    [error, setError] = useState("");
  const alive = useRef(false);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const start = async () => {
    alive.current = true;
    setRunning(true);
    setTaken(0);
    setError("");
    const group = newGroup();
    let failures = 0;
    for (let n = 0; alive.current && n < limit; ) {
      const started = performance.now();
      try {
        const blob = await grab();
        if (!blob) throw Error("沒有取得畫面");
        if (!alive.current) break;
        await save(blob, independent ? "" : group);
        setTaken(++n);
        failures = 0;
      } catch (e) {
        setError((e as Error).message);
        if (++failures >= MAX_FAILURES) break;
      }
      if (n < limit) await sleep(Math.max(0, interval * 1000 - (performance.now() - started)));
    }
    if (failures >= MAX_FAILURES) setError((m) => `連續 ${MAX_FAILURES} 次失敗，已停止：${m}`);
    alive.current = false;
    setRunning(false);
    onDone();
  };

  return (
    <details className="autoCapture" open={running || undefined}>
      <summary>
        <Timer size={15} />
        定時自動擷取
      </summary>
      <div className="row">
        <label>
          間隔（秒）
          <input
            type="number"
            min={minInterval}
            step={minInterval < 1 ? 0.1 : 1}
            value={interval}
            disabled={running}
            onChange={(e) => setInterval_(Math.max(minInterval, +e.target.value || minInterval))}
          />
        </label>
        <label>
          張數上限
          <input
            type="number"
            min={1}
            max={500}
            value={limit}
            disabled={running}
            onChange={(e) => setLimit(Math.min(500, Math.max(1, Math.round(+e.target.value) || 1)))}
          />
        </label>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={independent} disabled={running} onChange={(e) => setIndependent(e.target.checked)} />
        每張視為獨立樣本
      </label>
      <small>
        {independent
          ? "適合輸送帶上每次都是不同工件；靜止同一工件請勿勾選，否則近似影像可能同時進入訓練與測試集。"
          : "整次擷取視為同一批次，不會同時分到訓練與測試集。"}
      </small>
      {running ? (
        <button
          className="full"
          onClick={() => {
            alive.current = false;
          }}
        >
          <Square size={14} />
          停止（已擷取 {taken} / {limit}）
        </button>
      ) : (
        <button className="primary full" disabled={disabled} onClick={start}>
          <Timer size={16} />
          開始自動擷取
        </button>
      )}
      {!running && taken > 0 && <small>上次擷取 {taken} 張。</small>}
      {error && <div className="error">{error}</div>}
    </details>
  );
}
