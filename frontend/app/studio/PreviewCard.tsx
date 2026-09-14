"use client";
import { useEffect, useState } from "react";
import { Download, Play, Rocket, Upload, X } from "lucide-react";
import { adapterName, api, captureNetworkCamera, classColor, modelVersion } from "../lib/api";
import type { Camera, Ctx, Inspection, Primary } from "../lib/api";
import { useWebcam, WebcamPicker } from "./useWebcam";

type Preview = { primary: Primary; latency_ms: number; model_id: string };
const INTERVAL_MS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function PreviewCard({
  ctx,
  modelId: chosen,
  setModelId,
  cameras,
  webcamOpen,
  onWebcam,
  onAdvanced,
  previewRef,
}: {
  ctx: Ctx;
  modelId: string;
  setModelId: (id: string) => void;
  cameras: Camera[];
  webcamOpen: boolean;
  onWebcam: (open: boolean) => void;
  onAdvanced: (tab: string) => void;
  previewRef?: React.Ref<HTMLElement>;
}) {
  const { pid, data, busy, run, reload, notify } = ctx;
  const p = data.project;
  const detection = p.task === "detection";
  const models = data.model;
  const model = models.find((m) => m.id === chosen) || models[models.length - 1];
  const modelId = model?.id || "";
  const deployment = data.deployment.find((d) => d.id === p.active_deployment);

  const cam = useWebcam();
  const [source, setSource] = useState<"webcam" | "file" | "network">("webcam"),
    [cid, setCid] = useState(""),
    [still, setStill] = useState<{ file: File; url: string } | null>(null),
    [size, setSize] = useState({ w: 1, h: 1 }),
    [result, setResult] = useState<Preview | null>(null),
    [verdict, setVerdict] = useState<Inspection | null>(null),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false);

  const predict = async (file: Blob) => {
    const form = new FormData();
    form.append("file", file, "preview.jpg");
    if (modelId) form.append("model_id", modelId);
    return api<Preview>(`/projects/${pid}/preview`, { method: "POST", body: form });
  };

  const { stop, grab, on } = cam;
  useEffect(() => {
    if (!webcamOpen) stop();
  }, [webcamOpen, stop]);
  useEffect(() => () => void (still && URL.revokeObjectURL(still.url)), [still]);

  // Sequential loop: the next frame is sent only after the previous answer, capped at 5 per second.
  useEffect(() => {
    if (source !== "webcam" || !webcamOpen || !on || !modelId) return;
    let alive = true;
    (async () => {
      while (alive) {
        const started = performance.now();
        if (document.visibilityState === "visible") {
          const frame = await grab(detection ? 640 : 320, "image/jpeg");
          if (frame && alive) {
            try {
              const r = await predict(frame.blob);
              if (!alive) break;
              setSize({ w: frame.width, h: frame.height });
              setResult(r);
              setError("");
            } catch (e) {
              if (!alive) break;
              setError((e as Error).message);
              await sleep(1000);
            }
          }
        }
        await sleep(Math.max(0, INTERVAL_MS - (performance.now() - started)));
      }
    })();
    return () => {
      alive = false;
    };
  }, [source, webcamOpen, on, modelId, detection, grab]);

  // A still image is re-scored whenever it or the chosen model changes.
  useEffect(() => {
    if (source === "webcam" || !still || !modelId) return;
    let alive = true;
    predict(still.file).then(
      (r) => alive && (setResult(r), setError("")),
      (e) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [source, still, modelId]);

  const pickStill = (file: File) => {
    setVerdict(null);
    setStill({ file, url: URL.createObjectURL(file) });
  };
  const switchSource = (s: typeof source) => {
    setSource(s);
    setResult(null);
    setVerdict(null);
    if (s !== "webcam" && webcamOpen) onWebcam(false);
  };
  const toggleInput = () => {
    if (webcamOpen) onWebcam(false);
    else {
      onWebcam(true);
      cam.start();
    }
  };

  const deployed = !!deployment && deployment.model_id === modelId;
  const inspect = () =>
    run(async () => {
      const file = source === "webcam" ? (await grab())?.blob : still?.file;
      if (!file) throw Error("沒有可檢測的影像");
      const form = new FormData();
      form.append("project_id", pid);
      form.append("file", file, "inspection.png");
      if (!deployed) form.append("model_id", modelId);
      setVerdict(await api<Inspection>("/inference", { method: "POST", body: form }));
      await reload();
    });

  if (!model)
    return (
      <section className="previewCard" ref={previewRef}>
        <div className="cardHead">
          <h2>預覽</h2>
          <button disabled>
            <Download size={16} />
            匯出模型
          </button>
        </div>
        <p className="muted cardNote">必須先在左側訓練模型，才能在這裡預覽。</p>
      </section>
    );

  const scores = bars(result?.primary, p.labels, detection);
  const showing = source === "webcam" ? webcamOpen : !!still;

  return (
    <section className="previewCard" ref={previewRef}>
      <div className="cardHead">
        <h2>預覽</h2>
        <button onClick={() => setExporting(true)}>
          <Download size={16} />
          匯出模型
        </button>
      </div>
      <label>
        模型
        <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
          {[...models].reverse().map((m) => (
            <option key={m.id} value={m.id}>
              V{modelVersion(models, m.id)} · {adapterName[m.adapter] || m.adapter}
              {deployment?.model_id === m.id ? " · 部署中" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="segmented" role="tablist">
        {(
          [
            ["webcam", "網路攝影機"],
            ["file", "檔案"],
            ...(cameras.length ? [["network", "IP 相機"]] : []),
          ] as [typeof source, string][]
        ).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={source === k} className={source === k ? "on" : ""} onClick={() => switchSource(k)}>
            {t}
          </button>
        ))}
      </div>

      {source === "webcam" && (
        <div className="row">
          <label className="switch">
            <input type="checkbox" checked={webcamOpen} onChange={toggleInput} />
            <span />
            輸入 {webcamOpen ? "開啟" : "關閉"}
          </label>
          <WebcamPicker cam={cam} />
        </div>
      )}
      {source === "file" && (
        <label className="button">
          <Upload size={16} />
          選擇影像
          <input hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && pickStill(e.target.files[0])} />
        </label>
      )}
      {source === "network" && (
        <div className="row">
          <select aria-label="選擇網路相機" value={cid} onChange={(e) => setCid(e.target.value)}>
            <option value="">請選擇相機</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            disabled={!cid || busy}
            onClick={() => run(async () => pickStill(await captureNetworkCamera(cid)))}
          >
            擷取
          </button>
        </div>
      )}
      {(cam.error || error) && <div className="error">{cam.error || error}</div>}

      <div className="stage">
        {source === "webcam" && webcamOpen && <video ref={cam.video} autoPlay playsInline muted />}
        {source !== "webcam" && still && (
          <img src={still.url} alt="預覽影像" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        )}
        {showing &&
          result?.primary.boxes?.map((b, i) => (
            <div
              key={i}
              className="bbox"
              style={{
                left: `${(b.xyxy[0] / size.w) * 100}%`,
                top: `${(b.xyxy[1] / size.h) * 100}%`,
                width: `${((b.xyxy[2] - b.xyxy[0]) / size.w) * 100}%`,
                height: `${((b.xyxy[3] - b.xyxy[1]) / size.h) * 100}%`,
              }}
            >
              <span>
                {b.label} {(b.confidence * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        {!showing && <div className="empty small">{source === "webcam" ? "開啟輸入以即時預覽" : "選擇或擷取一張影像"}</div>}
      </div>

      <h3 className="outputTitle">輸出</h3>
      <div className="bars">
        {scores.map((s) => (
          <div className="bar" key={s.label}>
            <span className="barLabel">{s.label}</span>
            <div className="barTrack">
              <div className="barFill" style={{ width: `${Math.max(s.value * 100, 0)}%`, background: s.color }} />
            </div>
            <span className="barValue">{showing && result ? `${Math.round(s.value * 100)}%` : "—"}</span>
          </div>
        ))}
      </div>
      {showing && result?.primary.reason && <p className="muted">{result.primary.reason}</p>}
      {showing && result && <small>預覽 {result.latency_ms} ms · 不寫入履歷</small>}

      <button className="primary full" disabled={busy || !showing} onClick={inspect}>
        <Play size={16} />
        正式檢測
      </button>
      <small>
        {deployed
          ? `套用目前部署規則 · 門檻 ${deployment!.threshold}${deployment!.vlm_enabled ? " · VLM 複判" : ""}`
          : "此版本未部署 · 以預設門檻 0.85 判定"}
        ，結果寫入檢測履歷。
      </small>
      {verdict && (
        <div className={"verdict compactVerdict " + verdict.result}>
          <strong>{verdict.result}</strong>
          <span>
            {verdict.result === "REVIEW" ? "需要人工複判" : verdict.result === "PASS" ? "符合目前判定規則" : "檢出疑似瑕疵"} ·{" "}
            {verdict.primary.label} {(verdict.primary.confidence * 100).toFixed(1)}%
          </span>
          {verdict.secondary && <small>VLM：{verdict.secondary.reason}</small>}
          <button className="linkButton" onClick={() => onAdvanced("history")}>
            查看檢測履歷
          </button>
        </div>
      )}

      {exporting && (
        <ExportModal
          ctx={ctx}
          modelId={modelId}
          onClose={() => setExporting(false)}
          onAdvanced={onAdvanced}
          notify={notify}
        />
      )}
    </section>
  );
}

function bars(primary: Primary | undefined, labels: string[], detection: boolean) {
  const order = (keys: string[]) => [...labels.filter((l) => keys.includes(l)), ...keys.filter((k) => !labels.includes(k))];
  if (detection) {
    const defects = labels.filter((l) => l !== "OK");
    return order(defects).map((l) => ({
      label: l,
      color: classColor(labels, l),
      value: Math.max(0, ...(primary?.boxes || []).filter((b) => b.label === l).map((b) => b.confidence)),
    }));
  }
  const scores = primary?.scores || {};
  const keys = Object.keys(scores).length ? Object.keys(scores) : labels;
  return order(keys).map((l) => ({ label: l, color: classColor(labels, l), value: scores[l] ?? 0 }));
}

function ExportModal({
  ctx,
  modelId,
  onClose,
  onAdvanced,
  notify,
}: {
  ctx: Ctx;
  modelId: string;
  onClose: () => void;
  onAdvanced: (tab: string) => void;
  notify: (m: string) => void;
}) {
  const { pid, data, busy, run, reload } = ctx;
  const m = data.model.find((x) => x.id === modelId)!;
  const [threshold, setThreshold] = useState(0.85),
    [vlm, setVlm] = useState(false);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="sectionTitle">
          <h2>匯出與部署</h2>
          <button className="iconButton" onClick={onClose} aria-label="關閉">
            <X />
          </button>
        </div>
        <p>
          <span className="badge">
            V{modelVersion(data.model, m.id)} · {adapterName[m.adapter] || m.adapter}
          </span>{" "}
          {m.name}
        </p>
        <h3>下載</h3>
        <div className="row">
          <a className="button" href={`/api/v1/models/${m.id}/export?format=native`}>
            <Download size={16} />
            原生權重（zip）
          </a>
          {m.adapter !== "baseline" && (
            <a className="button" href={`/api/v1/models/${m.id}/export?format=onnx`}>
              <Download size={16} />
              ONNX
            </a>
          )}
        </div>
        <h3>部署至本地 Runtime</h3>
        <label>
          第一層判定門檻 · {threshold.toFixed(2)}
          <input type="range" min="0.5" max="1" step="0.01" value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={vlm} onChange={(e) => setVlm(e.target.checked)} />
          低信心結果送本地 VLM 複判
        </label>
        <button
          className="primary full"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api(`/projects/${pid}/deploy`, {
                method: "POST",
                body: JSON.stringify({ model_id: m.id, threshold, vlm_enabled: vlm }),
              });
              await reload();
              notify("本地 Runtime 已切換版本");
              onClose();
            })
          }
        >
          <Rocket size={16} />
          部署此模型
        </button>
        <h3>REST 推論</h3>
        <pre>{`POST /api/v1/inference\nAuthorization: Bearer <token>\nContent-Type: multipart/form-data\n\nproject_id=${pid}\nfile=@inspection.png`}</pre>
        <button
          className="linkButton"
          onClick={() => {
            onClose();
            onAdvanced("deploy");
          }}
        >
          查看部署歷程與回滾
        </button>
      </div>
    </div>
  );
}
