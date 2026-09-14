"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Play, Upload } from "lucide-react";
import { adapterName, api, modelVersion } from "../lib/api";
import type { Ctx, Inspection, Primary } from "../lib/api";
import { encodeWav, fileToClips, LevelMeter, SR, useMic } from "../lib/audio";
import { bars, ExportModal } from "./PreviewCard";

type Preview = { primary: Primary; latency_ms: number; model_id: string };
const LIVE_MS = 500;
const MAX_FILE_CLIPS = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Live microphone or audio-file preview: scores one-second windows and averages clips for a file. */
export default function AudioPreviewCard({
  ctx,
  modelId: chosen,
  setModelId,
  micOpen,
  onMic,
  onAdvanced,
  previewRef,
}: {
  ctx: Ctx;
  modelId: string;
  setModelId: (id: string) => void;
  micOpen: boolean;
  onMic: (open: boolean) => void;
  onAdvanced: (tab: string) => void;
  previewRef?: React.Ref<HTMLElement>;
}) {
  const { pid, data, busy, run, reload, notify } = ctx;
  const p = data.project;
  const models = data.model;
  const model = models.find((m) => m.id === chosen) || models[models.length - 1];
  const modelId = model?.id || "";
  const deployment = data.deployment.find((d) => d.id === p.active_deployment);
  const passLabels = p.pass_labels || [];

  const mic = useMic();
  const [source, setSource] = useState<"mic" | "file">("mic"),
    [file, setFile] = useState<{ name: string; url: string; clips: Float32Array[] } | null>(null),
    [clipResults, setClipResults] = useState<Preview[]>([]),
    [result, setResult] = useState<Preview | null>(null),
    [verdict, setVerdict] = useState<Inspection | null>(null),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false);
  const fileRun = useRef(0);

  const predict = (clip: Float32Array) => {
    const form = new FormData();
    form.append("file", encodeWav(clip), "preview.wav");
    if (modelId) form.append("model_id", modelId);
    return api<Preview>(`/projects/${pid}/preview`, { method: "POST", body: form });
  };

  const { start, stop, last, on } = mic;
  useEffect(() => {
    if (micOpen && source === "mic") start();
    else stop();
  }, [micOpen, source, start, stop]);
  useEffect(() => () => void (file && URL.revokeObjectURL(file.url)), [file]);

  // Live: score the latest second every LIVE_MS, waiting for each answer before the next request.
  useEffect(() => {
    if (source !== "mic" || !micOpen || !on || !modelId) return;
    let alive = true;
    (async () => {
      while (alive) {
        const started = performance.now();
        const clip = last(SR);
        if (clip && document.visibilityState === "visible") {
          try {
            const r = await predict(clip);
            if (!alive) break;
            setResult(r);
            setError("");
          } catch (e) {
            if (!alive) break;
            setError((e as Error).message);
            await sleep(1000);
          }
        }
        await sleep(Math.max(0, LIVE_MS - (performance.now() - started)));
      }
    })();
    return () => {
      alive = false;
    };
  }, [source, micOpen, on, modelId, last]);

  // File: score every clip, then show the average scores.
  useEffect(() => {
    if (source !== "file" || !file || !modelId) return;
    const token = ++fileRun.current;
    setClipResults([]);
    setResult(null);
    (async () => {
      const out: Preview[] = [];
      try {
        for (const clip of file.clips) {
          const r = await predict(clip);
          if (fileRun.current !== token) return;
          out.push(r);
          setClipResults([...out]);
        }
        const labels = Object.keys(out[0]?.primary.scores || {});
        const scores = Object.fromEntries(labels.map((l) => [l, out.reduce((a, r) => a + (r.primary.scores?.[l] ?? 0), 0) / out.length]));
        const top = labels.reduce((a, b) => (scores[b] > scores[a] ? b : a), labels[0]);
        setResult({ primary: { label: top, confidence: scores[top], scores }, latency_ms: out.reduce((a, r) => a + r.latency_ms, 0), model_id: modelId });
      } catch (e) {
        if (fileRun.current === token) setError((e as Error).message);
      }
    })();
  }, [source, file, modelId]);

  const pickFile = (f: File) =>
    run(async () => {
      setVerdict(null);
      const clips = await fileToClips(f, MAX_FILE_CLIPS);
      if (!clips.length) throw Error("音訊太短，至少需要 0.5 秒");
      setFile({ name: f.name, url: URL.createObjectURL(f), clips });
    });

  // The clip least likely to pass is the one sent for a formal decision.
  const worstClip = () => {
    if (!file) return null;
    let worst = 0,
      worstPass = Infinity;
    clipResults.forEach((r, i) => {
      const pass = passLabels.reduce((a, l) => a + (r.primary.scores?.[l] ?? 0), 0);
      if (pass < worstPass) [worst, worstPass] = [i, pass];
    });
    return file.clips[worst];
  };

  const deployed = !!deployment && deployment.model_id === modelId;
  const inspect = () =>
    run(async () => {
      const clip = source === "mic" ? last(SR) : worstClip();
      if (!clip) throw Error("沒有可檢測的音訊");
      const form = new FormData();
      form.append("project_id", pid);
      form.append("file", encodeWav(clip), "inspection.wav");
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

  const showing = source === "mic" ? micOpen : !!file;
  const scores = bars(result?.primary, p.labels, false);

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
            ["mic", "麥克風"],
            ["file", "音訊檔"],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            role="tab"
            aria-selected={source === k}
            className={source === k ? "on" : ""}
            onClick={() => {
              setSource(k);
              setResult(null);
              setVerdict(null);
              if (k === "file" && micOpen) onMic(false);
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {source === "mic" ? (
        <>
          <label className="switch">
            <input type="checkbox" checked={micOpen} onChange={() => onMic(!micOpen)} />
            <span />
            輸入 {micOpen ? "開啟" : "關閉"}
          </label>
          <LevelMeter level={mic.level} />
          <small>{micOpen ? "每 0.5 秒判斷最近 1 秒的聲音" : "開啟輸入以即時預覽"}</small>
        </>
      ) : (
        <>
          <label className="button">
            <Upload size={16} />
            選擇音訊檔
            <input hidden type="file" accept="audio/*,.wav" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
          </label>
          {file && (
            <>
              <audio controls src={file.url} className="audioPlayer" />
              <small>
                {file.name} · {file.clips.length} 個 1 秒片段 · 已判斷 {clipResults.length}
              </small>
            </>
          )}
        </>
      )}
      {(mic.error || error) && <div className="error">{mic.error || error}</div>}

      <h3 className="outputTitle">輸出{source === "file" && result ? "（片段平均）" : ""}</h3>
      <div className="bars">
        {scores.map((s) => (
          <div className="bar" key={s.label}>
            <span className="barLabel">
              {s.label}
              {p.labels.includes(s.label) && <i className={"passDot " + (passLabels.includes(s.label) ? "pass" : "fail")} />}
            </span>
            <div className="barTrack">
              <div className="barFill" style={{ width: `${Math.max(s.value * 100, 0)}%`, background: s.color }} />
            </div>
            <span className="barValue">{showing && result ? `${Math.round(s.value * 100)}%` : "—"}</span>
          </div>
        ))}
      </div>
      {showing && result && <small>預覽 {result.latency_ms} ms · 不寫入履歷</small>}

      <button className="primary full" disabled={busy || !showing || (source === "file" && !clipResults.length)} onClick={inspect}>
        <Play size={16} />
        正式檢測
      </button>
      <small>
        {deployed ? `套用目前部署規則 · 門檻 ${deployment!.threshold}` : "此版本未部署 · 以預設門檻 0.85 判定"}
        {source === "file" ? "；音訊檔以最不像合格的片段判定" : "；以最近 1 秒判定"}，結果寫入檢測履歷。
      </small>
      {verdict && (
        <div className={"verdict compactVerdict " + verdict.result}>
          <strong>{verdict.result}</strong>
          <span>
            {verdict.result === "REVIEW" ? "需要人工複判" : verdict.result === "PASS" ? "判定為合格類別" : "判定為不合格類別"} ·{" "}
            {verdict.primary.label} {(verdict.primary.confidence * 100).toFixed(1)}%
          </span>
          <button className="linkButton" onClick={() => onAdvanced("history")}>
            查看檢測履歷
          </button>
        </div>
      )}

      {exporting && <ExportModal ctx={ctx} modelId={modelId} onClose={() => setExporting(false)} onAdvanced={onAdvanced} notify={notify} />}
    </section>
  );
}
