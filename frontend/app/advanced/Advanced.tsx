"use client";
import { useEffect, useState } from "react";
import { Download, History, Layers3, Play, Rocket, Ruler, Upload } from "lucide-react";
import { adapterName, api, modelVersion } from "../lib/api";
import type { Ctx } from "../lib/api";
import MeasurementPanel from "../MeasurementPanel";
import NetworkCamera from "../NetworkCamera";

export const ADVANCED_TABS = [
  { key: "models", title: "模型版本", icon: Layers3 },
  { key: "deploy", title: "部署管理", icon: Rocket },
  { key: "history", title: "檢測履歷", icon: History },
  { key: "measure", title: "量測與相機", icon: Ruler },
];

export default function Advanced({
  ctx,
  tab,
  setTab,
  modelId,
  onTest,
}: {
  ctx: Ctx;
  tab: string;
  setTab: (tab: string) => void;
  modelId: string;
  onTest: (modelId: string) => void;
}) {
  return (
    <>
      <div className="segmented advancedTabs" role="tablist">
        {ADVANCED_TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            <t.icon size={16} />
            {t.title}
          </button>
        ))}
      </div>
      {tab === "models" && <Models ctx={ctx} onTest={onTest} onDeploy={() => setTab("deploy")} />}
      {tab === "deploy" && <Deploy ctx={ctx} initialModel={modelId} />}
      {tab === "history" && <Inspections ctx={ctx} />}
      {tab === "measure" && <Measure ctx={ctx} />}
    </>
  );
}

function Models({ ctx, onTest, onDeploy }: { ctx: Ctx; onTest: (id: string) => void; onDeploy: () => void }) {
  const { data } = ctx;
  return (
    <section className="panel">
      <h2>模型版本庫</h2>
      <p className="muted">每個版本綁定訓練參數與不可變的資料快照。以下指標來自保留資料。</p>
      {!data.model.length && <div className="empty">完成訓練後，模型會出現在這裡。</div>}
      {[...data.model].reverse().map((m) => (
        <article className="model" key={m.id}>
          <div className="sectionTitle">
            <div>
              <span className="badge">
                V{modelVersion(data.model, m.id)} · {adapterName[m.adapter] || m.adapter}
              </span>
              <h3>{m.name}</h3>
            </div>
            <div className="row">
              <button onClick={() => onTest(m.id)}>
                <Play size={16} />
                預覽
              </button>
              <button className="primary" onClick={onDeploy}>
                <Rocket size={16} />
                部署
              </button>
            </div>
          </div>
          <p>
            Train {m.counts.train} / Validation {m.counts.val} / Test {m.counts.test}
          </p>
          {m.warnings?.map((w) => (
            <div className="callout warnCallout" key={w}>
              {w}
            </div>
          ))}
          <pre>{JSON.stringify(m.metrics, null, 2)}</pre>
          <a className="button" href={`/api/v1/models/${m.id}/export?format=native`}>
            <Download size={16} />
            原生權重
          </a>
          {m.adapter !== "baseline" && (
            <a className="button" href={`/api/v1/models/${m.id}/export?format=onnx`}>
              匯出 ONNX
            </a>
          )}
        </article>
      ))}
    </section>
  );
}

function Deploy({ ctx, initialModel }: { ctx: Ctx; initialModel: string }) {
  const { pid, data, busy, run, reload, notify } = ctx;
  const p = data.project;
  const [mid, setMid] = useState(initialModel),
    [threshold, setThreshold] = useState(0.85),
    [useVlm, setUseVlm] = useState(false);
  return (
    <div className="twoCols">
      <section className="panel">
        <h2>部署至本地 Runtime</h2>
        <label>
          選擇版本
          <select value={mid} onChange={(e) => setMid(e.target.value)}>
            <option value="">請選擇模型</option>
            {data.model.map((m) => (
              <option key={m.id} value={m.id}>
                V{modelVersion(data.model, m.id)} · {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          第一層判定門檻 · {threshold.toFixed(2)}
          <input type="range" min="0.5" max="1" step="0.01" value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={useVlm} onChange={(e) => setUseVlm(e.target.checked)} />
          低信心結果送本地 VLM 複判
        </label>
        <div className="callout">VLM 回覆 OK 預設仍需人工確認。無回應、格式錯誤或低信心一律 REVIEW，不會自動放行。</div>
        <button
          className="primary full"
          disabled={busy || !mid}
          onClick={() =>
            run(async () => {
              await api(`/projects/${pid}/deploy`, {
                method: "POST",
                body: JSON.stringify({ model_id: mid, threshold, vlm_enabled: useVlm }),
              });
              await reload();
              notify("本地 Runtime 已切換版本");
            })
          }
        >
          <Rocket size={18} />
          啟用部署
        </button>
        <h3>REST 推論</h3>
        <pre>{`POST /api/v1/inference\nAuthorization: Bearer <token>\nContent-Type: multipart/form-data\n\nproject_id=${pid}\nfile=@inspection.png`}</pre>
      </section>
      <section className="panel">
        <h2>部署歷程與回滾</h2>
        {!data.deployment.length && <div className="empty">尚未部署</div>}
        {[...data.deployment].reverse().map((d) => (
          <article className="job" key={d.id}>
            <div className="sectionTitle">
              <b>{d.name}</b>
              <span className="badge">{p.active_deployment === d.id ? "目前啟用" : "歷史版本"}</span>
            </div>
            <p>
              門檻 {d.threshold} · VLM {d.vlm_enabled ? "開啟" : "關閉"}
            </p>
            <small>
              V{modelVersion(data.model, d.model_id)} · {data.model.find((m) => m.id === d.model_id)?.name}
            </small>
            {p.active_deployment !== d.id && (
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`/projects/${pid}/rollback/${d.id}`, { method: "POST" });
                    await reload();
                    notify("已回滾至所選部署");
                  })
                }
              >
                回滾至此版本
              </button>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

function Inspections({ ctx }: { ctx: Ctx }) {
  const { data, busy, run, reload } = ctx;
  const [reviewId, setReviewId] = useState(""),
    [decision, setDecision] = useState("FAIL"),
    [note, setNote] = useState("");
  return (
    <section className="panel">
      <h2>檢測履歷</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>影像</th>
              <th>時間</th>
              <th>AI 判定</th>
              <th>類別 / 分數</th>
              <th>模型</th>
              <th>耗時</th>
              <th>人工複判</th>
            </tr>
          </thead>
          <tbody>
            {[...data.inspection].reverse().map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/api/v1/inspections/${r.id}/content`} target="_blank" rel="noreferrer">
                    <img className="historyImage" src={`/api/v1/inspections/${r.id}/content`} alt="檢測影像" />
                  </a>
                </td>
                <td>{new Date(r.created_at * 1000).toLocaleString("zh-TW")}</td>
                <td>
                  <span className={"badge " + r.result}>{r.result}</span>
                </td>
                <td>
                  {r.primary.label} / {(r.primary.confidence * 100).toFixed(1)}%
                </td>
                <td>V{modelVersion(data.model, r.model_id)}</td>
                <td>{r.latency_ms} ms</td>
                <td>
                  {r.review ? (
                    <span title={r.review.note}>
                      {r.review.decision} · {r.review.note}
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setReviewId(r.id);
                        setNote("");
                      }}
                    >
                      人工確認
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.inspection.length && <div className="empty">尚無檢測紀錄，請在建模畫面的預覽區按「正式檢測」。</div>}
      {reviewId && (
        <div className="overlay">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(`/inspections/${reviewId}/review`, {
                  method: "POST",
                  body: JSON.stringify({ decision, note }),
                });
                setReviewId("");
                await reload();
              });
            }}
          >
            <h2>人工複判</h2>
            <img className="reviewImage" src={`/api/v1/inspections/${reviewId}/content`} alt="待複判影像" />
            <label>
              確認結果
              <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option>FAIL</option>
                <option>PASS</option>
              </select>
            </label>
            <label>
              判定依據
              <textarea required value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="row">
              <button type="button" onClick={() => setReviewId("")}>
                取消
              </button>
              <button className="primary" disabled={busy}>
                儲存複判紀錄
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function Measure({ ctx }: { ctx: Ctx }) {
  const { pid, data } = ctx;
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState("");
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const choose = (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };
  return (
    <div className="twoCols">
      <section className="panel">
        <h2>影像來源</h2>
        <NetworkCamera key={pid} pid={pid} labels={data.project.labels} onCapture={choose} />
        <label className="button">
          <Upload size={16} />
          選擇影像
          <input hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
        </label>
      </section>
      <section className="panel">
        <h2>尺寸量測</h2>
        {preview ? (
          <MeasurementPanel key={preview} pid={pid} file={file} preview={preview} />
        ) : (
          <div className="empty">從左側上傳影像或擷取網路相機畫面。</div>
        )}
      </section>
    </div>
  );
}
