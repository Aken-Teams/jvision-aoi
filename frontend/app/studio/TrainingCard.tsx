"use client";
import { useEffect, useState } from "react";
import { ChevronDown, Cpu, RotateCcw } from "lucide-react";
import { adapterName, api, readiness } from "../lib/api";
import type { Ctx, Model, Point, SplitMetrics } from "../lib/api";
import LineChart from "./LineChart";

const DEFAULTS: Record<string, { epochs: number; batch: number; lr: number }> = {
  transfer: { epochs: 50, batch: 16, lr: 0.001 },
  baseline: { epochs: 1, batch: 16, lr: 0.001 },
  cnn: { epochs: 20, batch: 16, lr: 0.001 },
  yolo: { epochs: 50, batch: 16, lr: 0.01 },
};
const TRAIN = "#2a78d6",
  VAL = "#eb6834";

export default function TrainingCard({ ctx, trainingRef }: { ctx: Ctx; trainingRef?: React.Ref<HTMLElement> }) {
  const { pid, data, busy, run, reload, notify } = ctx;
  const p = data.project;
  const detection = p.task === "detection";
  const preferred = p.adapter || (detection ? "yolo" : "transfer");
  const [adapter, setAdapter] = useState(preferred),
    [epochs, setEpochs] = useState(DEFAULTS[preferred].epochs),
    [batch, setBatch] = useState(DEFAULTS[preferred].batch),
    [lr, setLr] = useState(DEFAULTS[preferred].lr),
    [details, setDetails] = useState(false);

  const reset = (a = adapter) => {
    setEpochs(DEFAULTS[a].epochs);
    setBatch(DEFAULTS[a].batch);
    setLr(DEFAULTS[a].lr);
  };
  useEffect(() => {
    setAdapter(preferred);
    reset(preferred);
  }, [pid, preferred]);

  const { issues, warnings } = readiness(p, data.image);
  const job = data.job[data.job.length - 1];
  const active = job && ["queued", "running"].includes(job.status);
  const latest: Model | undefined = data.model[data.model.length - 1];
  const history: Point[] = (active ? job.history : latest?.history) || [];

  return (
    <section className="trainCard" ref={trainingRef}>
      <h2>訓練</h2>
      <button
        className="primary full trainButton"
        disabled={busy || active || issues.length > 0}
        onClick={() =>
          run(async () => {
            await api(`/projects/${pid}/train`, {
              method: "POST",
              body: JSON.stringify({ adapter, mode: "advanced", epochs, batch_size: batch, learning_rate: lr }),
            });
            await reload();
            notify("訓練工作已建立");
          })
        }
      >
        <Cpu size={18} />
        {active ? "訓練中…" : latest ? "重新訓練" : "訓練模型"}
      </button>
      {issues.length > 0 && !active && (
        <ul className="issues">
          {issues.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && issues.length === 0 && !active && (
        <ul className="issues warnings">
          {warnings.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}

      {job && (active || job.status === "failed") && (
        <div className="jobState">
          <div className="sectionTitle">
            <small>{job.status === "queued" ? "排隊中" : job.status === "running" ? "執行中" : "失敗"}</small>
            <small>{job.progress}%</small>
          </div>
          <progress value={job.progress} max={100} />
          <p className={job.status === "failed" ? "error" : "muted"}>
            {job.error || job.logs[job.logs.length - 1] || "等待 worker 接手…"}
          </p>
          {active && <small>在伺服器上訓練，可離開此頁。</small>}
        </div>
      )}
      {!active && latest && (
        <p className="muted trainedNote">
          最新：V{data.model.length} · {adapterName[latest.adapter] || latest.adapter} · 測試集{" "}
          {typeof latest.metrics.test?.accuracy === "number"
            ? `準確率 ${(latest.metrics.test.accuracy * 100).toFixed(1)}%`
            : "指標見底層細節"}
          {latest.warnings?.length ? <span className="warnTag" title={latest.warnings.join("\n")}>準確率可能偏高</span> : null}
        </p>
      )}

      <details className="fold">
        <summary>
          進階
          <ChevronDown size={16} />
        </summary>
        <label>
          模型
          <select
            value={adapter}
            disabled={detection}
            onChange={(e) => {
              setAdapter(e.target.value);
              reset(e.target.value);
            }}
          >
            {detection ? (
              <option value="yolo">YOLO · 瑕疵偵測</option>
            ) : (
              <>
                <option value="transfer">標準影像模型 · MobileNetV3 遷移學習</option>
                <option value="baseline">輕量影像模型 · CPU 邏輯迴歸</option>
                <option value="cnn">CNN · 從頭訓練</option>
              </>
            )}
          </select>
        </label>
        {adapter !== "baseline" && (
          <>
            <label>
              Epochs
              <input type="number" min={1} max={500} value={epochs} onChange={(e) => setEpochs(+e.target.value)} />
            </label>
            <label>
              Batch size
              <select value={batch} onChange={(e) => setBatch(+e.target.value)}>
                {[8, 16, 32, 64, 128].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <label>
              Learning rate
              <input type="number" step="0.0001" min={0.000001} max={0.1} value={lr} onChange={(e) => setLr(+e.target.value)} />
            </label>
          </>
        )}
        <button onClick={() => reset()}>
          <RotateCcw size={14} />
          重設預設值
        </button>
        <button className="linkButton" onClick={() => setDetails(!details)}>
          {details ? "隱藏" : "顯示"}底層細節
        </button>
      </details>

      {details && (
        <div className="underHood">
          {history.length > 0 ? (
            detection ? (
              <>
                <LineChart title="Loss" series={[{ name: "訓練", color: TRAIN, values: history.map((h) => h.loss) }]} />
                <LineChart
                  title="mAP50（驗證）"
                  percent
                  series={[{ name: "驗證", color: VAL, values: history.map((h) => h.map50) }]}
                />
              </>
            ) : (
              <>
                <LineChart
                  title="準確率"
                  percent
                  series={[
                    { name: "訓練", color: TRAIN, values: history.map((h) => h.acc) },
                    { name: "驗證", color: VAL, values: history.map((h) => h.val_acc) },
                  ]}
                />
                <LineChart
                  title="Loss"
                  series={[
                    { name: "訓練", color: TRAIN, values: history.map((h) => h.loss) },
                    { name: "驗證", color: VAL, values: history.map((h) => h.val_loss) },
                  ]}
                />
              </>
            )
          ) : (
            <p className="muted">
              {latest?.adapter === "baseline" ? "CPU 基準分類器沒有逐 epoch 曲線。" : "訓練開始後顯示每個 epoch 的曲線。"}
            </p>
          )}
          {!active && latest && <Evaluation metrics={latest.metrics.test} counts={latest.counts} />}
        </div>
      )}
    </section>
  );
}

function Evaluation({ metrics, counts }: { metrics?: SplitMetrics; counts: Record<string, number> }) {
  if (!metrics) return null;
  const labels = metrics.labels,
    cm = metrics.confusion_matrix;
  if (!labels || !cm)
    return (
      <div>
        <h3>測試集指標</h3>
        <table className="compact">
          <tbody>
            {Object.entries(metrics)
              .filter(([, v]) => typeof v === "number")
              .map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{(v as number).toFixed(3)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  const peak = Math.max(1, ...cm.flat());
  return (
    <div>
      <h3>各類別準確率 · 測試集 {counts.test} 張</h3>
      <table className="compact">
        <thead>
          <tr>
            <th>類別</th>
            <th>準確率</th>
            <th>樣本</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => {
            const total = cm[i].reduce((a, b) => a + b, 0);
            return (
              <tr key={l}>
                <td>{l}</td>
                <td>{total ? `${((cm[i][i] / total) * 100).toFixed(1)}%` : "—"}</td>
                <td>{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>混淆矩陣</h3>
      <div className="tableWrap">
        <table className="confusion">
          <thead>
            <tr>
              <th>實際 ＼ 預測</th>
              {labels.map((l) => (
                <th key={l}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l}>
                <th>{l}</th>
                {cm[i].map((v, j) => (
                  <td
                    key={j}
                    title={`實際 ${l} → 預測 ${labels[j]}：${v} 張`}
                    style={{ background: `rgba(0,124,121,${(v / peak) * 0.85})`, color: v / peak > 0.5 ? "#fff" : "var(--ink)" }}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        準確率 {((metrics.accuracy ?? 0) * 100).toFixed(1)}% · F1 {(metrics.f1 ?? 0).toFixed(3)}。測試集未參與訓練；小樣本指標波動大。
      </p>
    </div>
  );
}
