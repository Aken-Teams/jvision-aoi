"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { api } from "../lib/api";
import type { Box, Ctx, Pic } from "../lib/api";

/** Side drawer for confirming a detection sample: image label plus defect boxes. */
export default function BoxDrawer({ ctx, pic, onClose, onNext }: {
  ctx: Ctx;
  pic: Pic;
  onClose: () => void;
  onNext: (current: Pic) => void;
}) {
  const { pid, data, run, reload, notify, busy } = ctx;
  const p = data.project;
  const defects = p.labels.filter((l) => l !== "OK");
  const [label, setLabel] = useState(pic.label),
    [boxes, setBoxes] = useState<Box[]>(pic.boxes),
    [boxLabel, setBoxLabel] = useState(pic.label !== "OK" ? pic.label : defects[0] || "NG");
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setLabel(pic.label);
    setBoxes(pic.boxes);
    setBoxLabel(pic.label !== "OK" ? pic.label : defects[0] || "NG");
  }, [pic.id]); // keep unsaved boxes while polling refreshes the overview

  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };
  const save = (next: boolean) =>
    run(async () => {
      await api(`/images/${pic.id}/annotation`, {
        method: "PUT",
        body: JSON.stringify({ label, boxes, reviewed: true }),
      });
      await reload();
      notify("標註已確認");
      if (next) onNext(pic);
      else onClose();
    });

  return (
    <div className="overlay drawerOverlay" onClick={onClose}>
      <div className="drawer" role="dialog" aria-label="框選標註" onClick={(e) => e.stopPropagation()}>
        <div className="sectionTitle">
          <h2>框選與確認</h2>
          <button className="iconButton" onClick={onClose} aria-label="關閉">
            <X />
          </button>
        </div>
        <p className="muted">
          {pic.width} × {pic.height} px · 在影像上拖曳建立瑕疵框；OK 影像不可含框。
        </p>
        <div
          className="annotator"
          onPointerDown={(e) => {
            if (label === "OK") return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = at(e);
          }}
          onPointerUp={(e) => {
            if (!drag.current) return;
            const start = drag.current,
              end = at(e);
            drag.current = null;
            const b = {
              label: boxLabel,
              x: Math.min(start.x, end.x),
              y: Math.min(start.y, end.y),
              w: Math.abs(start.x - end.x),
              h: Math.abs(start.y - end.y),
            };
            if (b.w > 0.005 && b.h > 0.005) setBoxes([...boxes, b]);
          }}
        >
          <img draggable={false} src={`/api/v1/images/${pic.id}/content`} alt="標註影像" />
          {boxes.map((b, i) => (
            <div
              className="bbox"
              key={i}
              style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
            >
              <span>{b.label}</span>
            </div>
          ))}
        </div>
        <div className="row">
          <label>
            影像分類
            <select
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (e.target.value === "OK") setBoxes([]);
                else setBoxLabel(e.target.value);
              }}
            >
              {p.labels.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            框選類別
            <select value={boxLabel} disabled={label === "OK"} onChange={(e) => setBoxLabel(e.target.value)}>
              {defects.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button onClick={() => setBoxes(boxes.slice(0, -1))} disabled={!boxes.length}>
            復原上一框
          </button>
          <button onClick={() => setBoxes([])} disabled={!boxes.length}>
            清除框選
          </button>
          <button
            disabled={busy || !p.active_deployment}
            title={p.active_deployment ? "" : "先部署初始模型才能使用"}
            onClick={() =>
              run(async () => {
                const r = await api<{ suggestion: { label: string; boxes?: { xyxy: number[]; label: string }[] } }>(
                  `/projects/${pid}/images/${pic.id}/suggest`,
                  { method: "POST" },
                );
                if (p.labels.includes(r.suggestion.label)) setLabel(r.suggestion.label);
                setBoxes(
                  (r.suggestion.boxes || []).map((b) => ({
                    label: b.label,
                    x: b.xyxy[0] / pic.width,
                    y: b.xyxy[1] / pic.height,
                    w: (b.xyxy[2] - b.xyxy[0]) / pic.width,
                    h: (b.xyxy[3] - b.xyxy[1]) / pic.height,
                  })),
                );
                notify("已填入模型建議，請人工確認後儲存");
              })
            }
          >
            模型輔助標註
          </button>
        </div>
        <div className="row drawerActions">
          <button className="primary" disabled={busy} onClick={() => save(false)}>
            <Check size={16} />
            確認儲存
          </button>
          <button disabled={busy} onClick={() => save(true)}>
            儲存並下一張待框選
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
