"use client";
import { useRef, useState } from "react";
import { Crop } from "lucide-react";
import { api } from "../lib/api";
import type { Ctx, Roi } from "../lib/api";
import type { useWebcam } from "./useWebcam";

const pct = (r: Roi) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
const MIN_SIZE = 0.02;

/**
 * Live camera view with the project ROI: outside the region is dimmed, and "調整 ROI" lets the user drag a new one.
 * Children (e.g. detection boxes) are positioned inside the ROI, matching frames cropped with the same region.
 */
export default function RoiVideo({
  ctx,
  cam,
  recording = false,
  children,
}: {
  ctx: Ctx;
  cam: ReturnType<typeof useWebcam>;
  recording?: boolean;
  children?: React.ReactNode;
}) {
  const { pid, data, busy, run, reload, notify } = ctx;
  const roi = data.project.roi || null;
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<Roi | null>(roi);
  const start = useRef<{ x: number; y: number } | null>(null);

  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };
  const rect = (a: { x: number; y: number }, b: { x: number; y: number }): Roi => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });
  const save = (next: Roi | null) => {
    if (data.image.length && JSON.stringify(next) !== JSON.stringify(roi))
      if (!confirm("變更 ROI 後，新擷取的樣本範圍會與既有樣本不同，建議重新收集樣本後再訓練。確定變更？")) return;
    run(async () => {
      await api(`/projects/${pid}`, { method: "PATCH", body: JSON.stringify({ roi: next }) });
      await reload();
      setEditing(false);
      notify(next ? "ROI 已儲存，擷取與檢測只使用框內影像" : "已改回整張畫面");
    });
  };
  const shown = editing ? draft : roi;

  return (
    <>
      <div className={"roiStage" + (editing ? " editing" : "")}>
        <video ref={cam.video} autoPlay playsInline muted className={recording ? "recording" : ""} />
        {shown && <div className="roiBox" style={pct(shown)} />}
        {!editing && children && (roi ? <div className="roiInner" style={pct(roi)}>{children}</div> : children)}
        {editing && (
          <div
            className="roiDraw"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              start.current = at(e);
            }}
            onPointerMove={(e) => {
              if (start.current) setDraft(rect(start.current, at(e)));
            }}
            onPointerUp={(e) => {
              if (!start.current) return;
              const r = rect(start.current, at(e));
              start.current = null;
              setDraft(r.w >= MIN_SIZE && r.h >= MIN_SIZE ? r : draft);
            }}
          />
        )}
      </div>
      <div className="roiBar">
        {editing ? (
          <>
            <small>在畫面上拖曳框選工件區域</small>
            <div className="row">
              <button className="primary" disabled={busy || !draft} onClick={() => save(draft)}>
                儲存 ROI
              </button>
              <button disabled={busy} onClick={() => save(null)}>
                整張畫面
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setDraft(roi);
                  setEditing(false);
                }}
              >
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <small>ROI：{roi ? `已設定 · 寬 ${Math.round(roi.w * 100)}% × 高 ${Math.round(roi.h * 100)}%` : "整張畫面"}</small>
            <button
              className="linkButton"
              disabled={!cam.on || recording}
              onClick={() => {
                setDraft(roi);
                setEditing(true);
              }}
            >
              <Crop size={14} />
              調整 ROI
            </button>
          </>
        )}
      </div>
    </>
  );
}
