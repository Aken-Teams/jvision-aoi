"use client";
import { useState } from "react";
import { ArrowLeft, FolderOpen, Play, X } from "lucide-react";
import { api } from "./lib/api";
import type { Project } from "./lib/api";

type Choice = {
  adapter: string;
  title: string;
  use: string;
  specs: string[];
  note?: string;
};

const TASKS: Record<string, { title: string; description: string; dialog: string; choices: Choice[] }> = {
  classification: {
    title: "影像分類專案",
    description: "判斷整張影像屬於哪個類別（例如 OK / NG），以現有檔案或網路攝影機拍攝的影像訓練模型。",
    dialog: "新增影像分類專案",
    choices: [
      {
        adapter: "transfer",
        title: "標準影像模型",
        use: "適用於大多數用途",
        specs: ["224 × 224 像素的彩色影像", "MobileNetV3 遷移學習，少量樣本即可訓練", "可匯出原生權重與 ONNX", "模型大小：約 6 MB"],
        note: "伺服器須預先放置 MobileNetV3 權重。",
      },
      {
        adapter: "baseline",
        title: "輕量影像模型",
        use: "適用於無 GPU 主機與流程驗證",
        specs: ["24 × 24 像素的彩色影像", "CPU 邏輯迴歸，免下載深度學習權重", "可匯出原生權重", "模型大小：小於 50 KB"],
        note: "精度有限，不建議直接用於產線判定。",
      },
    ],
  },
  detection: {
    title: "物件偵測專案",
    description: "框選瑕疵位置並辨識類別，以現有檔案或網路攝影機拍攝的影像訓練模型。",
    dialog: "新增物件偵測專案",
    choices: [
      {
        adapter: "yolo",
        title: "標準偵測模型",
        use: "適用於定位刮傷、異物等瑕疵",
        specs: ["640 × 640 像素的彩色影像", "YOLO11n，需要逐張框選瑕疵", "可匯出原生權重、ONNX 與 TensorRT", "模型大小：約 6 MB"],
        note: "建議使用 GPU；伺服器須預先放置 YOLO 初始權重。",
      },
    ],
  },
};

const DETECTION_BOXES = [
  ["ng-003", 0.105, 0.38, 0.79, 0.12],
  ["ng-004", 0.105, 0.26, 0.79, 0.17],
  ["ng-005", 0.105, 0.32, 0.79, 0.1],
] as const;

export default function NewProject({
  busy,
  run,
  onOpen,
  onBack,
}: {
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onOpen: (project: Project) => void;
  onBack?: () => void;
}) {
  const [task, setTask] = useState("");
  const dialog = task ? TASKS[task] : null;

  const create = (adapter: string) =>
    run(async () => {
      const p = await api<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({ name: "未命名專案", task, labels: ["OK", "NG"], adapter }),
      });
      setTask("");
      onOpen(p);
    });

  return (
    <div className="newProject">
      {onBack && (
        <button className="linkButton" onClick={onBack}>
          <ArrowLeft size={16} />
          我的專案
        </button>
      )}
      <h1 className="newProjectTitle">新增專案</h1>
      <div className="row openRow">
        <label className="button raised">
          <FolderOpen size={20} />
          從檔案開啟現有專案
          <input
            hidden
            type="file"
            accept=".zip,application/zip"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              run(async () => {
                const form = new FormData();
                form.append("file", f);
                onOpen(await api<Project>("/projects/import", { method: "POST", body: form }));
              });
            }}
          />
        </label>
        <button
          className="raised"
          disabled={busy}
          onClick={() => run(async () => onOpen(await api<Project>("/demo", { method: "POST" })))}
        >
          <Play size={18} />
          開啟示範專案
        </button>
      </div>

      <div className="taskCards">
        <button className="taskCard" onClick={() => setTask("classification")}>
          <div className="taskThumbs">
            {["ok-001", "ng-006", "ok-002", "ng-004"].map((f) => (
              <img key={f} src={`/samples/${f}.png`} alt="" />
            ))}
          </div>
          <h2>{TASKS.classification.title}</h2>
          <p>{TASKS.classification.description}</p>
        </button>
        <button className="taskCard" onClick={() => setTask("detection")}>
          <div className="taskThumbs">
            {DETECTION_BOXES.map(([f, x, y, w, h]) => (
              <span key={f}>
                <img src={`/samples/${f}.png`} alt="" />
                <i style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
              </span>
            ))}
          </div>
          <h2>{TASKS.detection.title}</h2>
          <p>{TASKS.detection.description}</p>
        </button>
      </div>

      {dialog && (
        <div className="overlay" onClick={() => setTask("")}>
          <div className="modal wideModal" role="dialog" aria-label={dialog.dialog} onClick={(e) => e.stopPropagation()}>
            <div className="sectionTitle">
              <h2 className="dialogTitle">{dialog.dialog}</h2>
              <button className="iconButton" onClick={() => setTask("")} aria-label="關閉">
                <X size={26} />
              </button>
            </div>
            <div className="choiceCards">
              {dialog.choices.map((c) => (
                <button key={c.adapter} className="choiceCard" disabled={busy} onClick={() => create(c.adapter)}>
                  <h3>{c.title}</h3>
                  <b>{c.use}</b>
                  {c.specs.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                  {c.note && <small>{c.note}</small>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
