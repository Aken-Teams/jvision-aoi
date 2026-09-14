"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import type { Camera, Ctx, Pic } from "../lib/api";
import BoxDrawer from "./BoxDrawer";
import ClassCard from "./ClassCard";
import PreviewCard from "./PreviewCard";
import AudioPreviewCard from "./AudioPreviewCard";
import TrainingCard from "./TrainingCard";

/** Teachable Machine style canvas: class cards → training → live preview. */
export default function Studio({
  ctx,
  modelId,
  setModelId,
  onAdvanced,
}: {
  ctx: Ctx;
  modelId: string;
  setModelId: (id: string) => void;
  onAdvanced: (tab: string) => void;
}) {
  const { pid, data, run, reload } = ctx;
  const p = data.project;
  const [cameras, setCameras] = useState<Camera[]>([]),
    [webcam, setWebcam] = useState(""), // owner of the single open webcam: class label or "preview"
    [annotating, setAnnotating] = useState<string>(""),
    [adding, setAdding] = useState(false),
    [newName, setNewName] = useState("");

  useEffect(() => {
    if (p.task === "audio" || p.pose_mode === "sequence") return setCameras([]);
    api<Camera[]>(`/projects/${pid}/cameras`).then(setCameras, () => setCameras([]));
  }, [pid, p.task, p.pose_mode]);

  const pic = data.image.find((x) => x.id === annotating);
  const nextPending = (current: Pic) => {
    const next = data.image.find((x) => !x.reviewed && x.id !== current.id);
    setAnnotating(next ? next.id : "");
  };
  const webcamFor = (owner: string) => ({
    webcamOpen: webcam === owner,
    onWebcam: (open: boolean) => setWebcam(open ? owner : ""),
  });

  // Connector curves between columns, recomputed on layout changes.
  const canvas = useRef<HTMLDivElement>(null),
    train = useRef<HTMLElement>(null),
    preview = useRef<HTMLElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const layout = useCallback(() => {
    const root = canvas.current;
    if (!root || !train.current || !preview.current || getComputedStyle(root).display !== "grid") return setPaths([]);
    const base = root.getBoundingClientRect();
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top };
    };
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const mid = (x1 + x2) / 2;
      return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
    };
    const t = box(train.current),
      v = box(preview.current);
    const ty = t.t + 40,
      vy = v.t + 40;
    const cards = Array.from(root.querySelectorAll(".classCard"));
    setPaths([
      ...cards.map((c) => {
        const b = box(c);
        return curve(b.r, b.t + 40, t.l, ty);
      }),
      curve(t.r, ty, v.l, vy),
    ]);
  }, []);
  useLayoutEffect(layout, [layout, data, webcam, adding]);
  useEffect(() => {
    const observer = new ResizeObserver(layout);
    if (canvas.current) {
      observer.observe(canvas.current);
      canvas.current.querySelectorAll("section").forEach((s) => observer.observe(s));
    }
    window.addEventListener("scroll", layout, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", layout, true);
    };
  }, [layout, data]);

  const addClass = () =>
    run(async () => {
      const name = newName.trim();
      if (!name) return;
      await api(`/projects/${pid}/classes`, { method: "POST", body: JSON.stringify({ name }) });
      setNewName("");
      setAdding(false);
      await reload();
    });

  return (
    <div className="tmCanvas" ref={canvas}>
      <svg className="connectors" aria-hidden="true">
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
      <div className="classColumn">
        {p.labels.map((l) => (
          <ClassCard
            key={l}
            ctx={ctx}
            label={l}
            cameras={cameras}
            {...webcamFor(`class:${l}`)}
            onAnnotate={(x) => setAnnotating(x.id)}
            onAdvanced={onAdvanced}
          />
        ))}
        {adding ? (
          <form
            className="addClass open"
            onSubmit={(e) => {
              e.preventDefault();
              addClass();
            }}
          >
            <input autoFocus maxLength={60} placeholder="類別名稱，例如：刮傷" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <div className="row">
              <button type="button" onClick={() => setAdding(false)}>
                取消
              </button>
              <button className="primary" disabled={!newName.trim() || p.labels.length >= 30}>
                新增
              </button>
            </div>
          </form>
        ) : (
          <button className="addClass" onClick={() => setAdding(true)} disabled={p.labels.length >= 30}>
            <Plus size={18} />
            新增類別
          </button>
        )}
      </div>
      <div className="stickyColumn">
        <TrainingCard ctx={ctx} trainingRef={train} />
      </div>
      <div className="stickyColumn">
        {p.task === "audio" ? (
          <AudioPreviewCard
            ctx={ctx}
            modelId={modelId}
            setModelId={setModelId}
            onAdvanced={onAdvanced}
            previewRef={preview}
            micOpen={webcam === "preview"}
            onMic={(open) => setWebcam(open ? "preview" : "")}
          />
        ) : (
          <PreviewCard
            ctx={ctx}
            modelId={modelId}
            setModelId={setModelId}
            cameras={cameras}
            onAdvanced={onAdvanced}
            previewRef={preview}
            {...webcamFor("preview")}
          />
        )}
      </div>
      {pic && <BoxDrawer ctx={ctx} pic={pic} onClose={() => setAnnotating("")} onNext={nextPending} />}
    </div>
  );
}
