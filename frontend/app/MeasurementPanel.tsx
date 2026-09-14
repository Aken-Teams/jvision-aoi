"use client";
import { useEffect, useRef, useState } from "react";
type Point = { x: number; y: number };
type Result = {
  unit: string;
  pixels_per_mm: number | null;
  image_width: number;
  image_height: number;
  objects: {
    length: number;
    width?: number;
    area?: number;
    points: number[][];
  }[];
};
type Entry = { id: string; created_at: number; result: Result };
export default function MeasurementPanel({
  pid,
  file,
  preview,
}: {
  pid: string;
  file: File | null;
  preview: string;
}) {
  const [tool, setTool] = useState("manual"),
    [points, setPoints] = useState<Point[]>([]),
    [reference, setReference] = useState<Point[]>([]),
    [referenceMM, setReferenceMM] = useState(10),
    [roi, setRoi] = useState({ x: 0, y: 0, w: 1, h: 1 }),
    [threshold, setThreshold] = useState(100),
    [polarity, setPolarity] = useState("dark"),
    [result, setResult] = useState<Result | null>(null),
    [history, setHistory] = useState<Entry[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [size, setSize] = useState({ w: 1, h: 1 });
  const start = useRef<Point | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/v1/projects/${pid}/measurements`)
      .then((r) => (r.ok ? r.json() : []))
      .then((x) => {
        if (active) setHistory(x);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pid]);
  function pos(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }
  async function perform(mode: string) {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append(
        "config",
        JSON.stringify({
          mode,
          points,
          reference_points: reference,
          reference_mm: reference.length === 2 ? referenceMM : null,
          roi,
          threshold,
          polarity,
        }),
      );
      const r = await fetch(`/api/v1/projects/${pid}/measure`, {
        method: "POST",
        body: form,
      });
      const body = await r.json();
      if (!r.ok)
        throw Error(
          typeof body.detail === "string" ? body.detail : "量測參數無效",
        );
      setResult(body.result);
      setHistory((h) => [...h, body]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const line = (pts: Point[], color: string) =>
    pts.length > 0 && (
      <g>
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x * (size.w - 1)}
            cy={p.y * (size.h - 1)}
            r={Math.max(size.w / 180, 1)}
            fill={color}
          />
        ))}
        {pts.length === 2 && (
          <line
            x1={pts[0].x * (size.w - 1)}
            y1={pts[0].y * (size.h - 1)}
            x2={pts[1].x * (size.w - 1)}
            y2={pts[1].y * (size.h - 1)}
            stroke={color}
            strokeWidth={Math.max(size.w / 350, 1)}
          />
        )}
      </g>
    );
  return (
    <details className="networkCamera">
      <summary>簡易尺寸量測 · 手動 / 自動</summary>
      {!file ? (
        <p className="muted">先上傳影像或擷取相機畫面，即可量測。</p>
      ) : (
        <fieldset disabled={busy} className="measurementFields">
          <p className="muted">
            校正：選「校正線」點兩端，輸入已知長度。手動：點兩點。自動：選 ROI
            拖曳，再調整明暗與閾值。
          </p>
          <div className="row">
            <label>
              影像工具
              <select value={tool} onChange={(e) => setTool(e.target.value)}>
                <option value="manual">手動量測線（橘色）</option>
                <option value="reference">校正線（藍色）</option>
                <option value="roi">自動量測 ROI（綠色）</option>
              </select>
            </label>
            <label>
              校正線實際長度（mm）
              <input
                type="number"
                min="0.001"
                step="0.01"
                value={referenceMM}
                onChange={(e) => {
                  setReferenceMM(+e.target.value);
                  setResult(null);
                }}
              />
            </label>
          </div>
          <div
            className="annotator"
            onPointerDown={(e) => {
              if (busy) return;
              start.current = pos(e);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={(e) => {
              if (!start.current || busy) return;
              const p = pos(e),
                a = start.current;
              start.current = null;
              setResult(null);
              if (tool === "roi") {
                const w = Math.abs(p.x - a.x),
                  h = Math.abs(p.y - a.y);
                if (w > 0.01 && h > 0.01)
                  setRoi({
                    x: Math.min(a.x, p.x),
                    y: Math.min(a.y, p.y),
                    w,
                    h,
                  });
              } else if (tool === "reference")
                setReference((v) => (v.length === 2 ? [p] : [...v, p]));
              else setPoints((v) => (v.length === 2 ? [p] : [...v, p]));
            }}
          >
            <img
              draggable={false}
              src={preview}
              alt="尺寸量測影像"
              onLoad={(e) =>
                setSize({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
            />
            <svg className="measureOverlay" viewBox={`0 0 ${size.w} ${size.h}`}>
              <rect
                x={roi.x * size.w}
                y={roi.y * size.h}
                width={roi.w * size.w}
                height={roi.h * size.h}
                fill="none"
                stroke="#36da9b"
                strokeWidth={Math.max(size.w / 350, 1)}
              />
              {line(reference, "#3cb6ff")}
              {line(points, "#ff893e")}
              {result?.objects.map((o, i) => (
                <polygon
                  key={i}
                  points={o.points.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke="#e9ff36"
                  strokeWidth={Math.max(size.w / 350, 1)}
                />
              ))}
            </svg>
          </div>
          <p className="muted">
            {reference.length === 2
              ? "校正已選取；僅適用此影像、同一平面。"
              : "尚未完成校正：結果只顯示 px。"}{" "}
            換圖後重新校正。
          </p>
          <div className="row">
            <button
              onClick={() => {
                setPoints([]);
                setReference([]);
                setRoi({ x: 0, y: 0, w: 1, h: 1 });
                setResult(null);
              }}
            >
              清除線與 ROI
            </button>
            <button
              className="primary"
              disabled={points.length !== 2}
              onClick={() => perform("manual")}
            >
              手動量距離
            </button>
          </div>
          <div className="row">
            <label>
              物件明暗
              <select
                value={polarity}
                onChange={(e) => {
                  setPolarity(e.target.value);
                  setResult(null);
                }}
              >
                <option value="dark">深色物件／淺色背景</option>
                <option value="bright">淺色物件／深色背景</option>
              </select>
            </label>
            <label>
              分割閾值 · {threshold}
              <input
                type="range"
                min={0}
                max={255}
                value={threshold}
                onChange={(e) => {
                  setThreshold(+e.target.value);
                  setResult(null);
                }}
              />
            </label>
          </div>
          <button className="primary full" onClick={() => perform("automatic")}>
            自動量測長、寬、面積
          </button>
        </fieldset>
      )}
      {busy && <p role="status">正在量測…</p>}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>物件</th>
                <th>距離／長</th>
                <th>寬</th>
                <th>面積</th>
              </tr>
            </thead>
            <tbody>
              {result.objects.map((o, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    {o.length.toFixed(3)} {result.unit}
                  </td>
                  <td>
                    {o.width === undefined
                      ? "—"
                      : `${o.width.toFixed(3)} ${result.unit}`}
                  </td>
                  <td>
                    {o.area === undefined
                      ? "—"
                      : `${o.area.toFixed(3)} ${result.unit}²`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        影像平面估算；透視、鏡頭畸變與離焦會影響結果。自動量測取外輪廓與旋轉外接矩形，非
        3D／精密量具。
      </p>
      <details>
        <summary>量測紀錄（{history.length}）</summary>
        {[...history]
          .reverse()
          .slice(0, 30)
          .map((h) => (
            <p key={h.id}>
              <a
                href={`/api/v1/measurements/${h.id}/content`}
                target="_blank"
                rel="noreferrer"
              >
                {new Date(h.created_at * 1000).toLocaleString("zh-TW")}
              </a>{" "}
              ·{" "}
              {h.result.objects
                .map(
                  (o) =>
                    `${o.length.toFixed(3)}${o.width !== undefined ? " × " + o.width.toFixed(3) : ""} ${h.result.unit}`,
                )
                .join("；")}
            </p>
          ))}
      </details>
    </details>
  );
}
