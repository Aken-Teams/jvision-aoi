"use client";
import { useState } from "react";
import { ArrowLeft, FolderOpen, Play, X } from "lucide-react";
import { api } from "./lib/api";
import type { Project } from "./lib/api";

type Choice = {
  adapter: string;
  extra?: Record<string, string>;
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
  audio: {
    title: "音訊專案",
    description: "以 1 秒長度的聲音訓練模型，例如判斷馬達、軸承或設備運轉聲是否異常；可用麥克風錄音或上傳音訊檔。",
    dialog: "新增音訊專案",
    choices: [
      {
        adapter: "audio",
        title: "標準音訊模型",
        use: "適用於設備聲音異常偵測",
        specs: ["16 kHz、1 秒單聲道片段", "梅爾頻譜 + CNN，從頭訓練免預訓練權重", "可匯出原生權重與 ONNX（輸入梅爾頻譜）", "模型大小：小於 1 MB"],
        note: "類別預設為「正常／異常」，可改名並設定合格或不合格；建議另建「背景雜音」類別。",
      },
    ],
  },
  pose: {
    title: "姿勢專案",
    description: "辨識人體姿勢或短動作，例如作業姿勢是否正確、是否舉手或彎腰；以網路攝影機拍攝，伺服器自動偵測人體關節點。",
    dialog: "新增姿勢專案",
    choices: [
      {
        adapter: "pose",
        extra: { pose_mode: "static" },
        title: "靜態姿勢模型",
        use: "判斷單一畫面中的姿勢",
        specs: ["YOLO11 偵測 17 個人體關節點", "關節點正規化後以 MLP 分類，少量樣本即可訓練", "可按住連拍、定時擷取或上傳照片", "模型大小：小於 100 KB（另需姿勢偵測權重）"],
        note: "伺服器須預先放置 yolo11n-pose.pt。類別預設「正確／錯誤」，可改名並設定合格或不合格。",
      },
      {
        adapter: "pose",
        extra: { pose_mode: "sequence" },
        title: "短動作模型",
        use: "判斷約 1 秒內的動作",
        specs: ["每個樣本連續 8 張畫面（約 1.2 秒）", "關節點序列與動作變化量一起分類", "倒數後錄製，可一次連續錄多次", "即時預覽每約 1.5 秒更新一次"],
        note: "適合揮手、拿取、蹲下等有明顯變化的動作；伺服器須預先放置 yolo11n-pose.pt。",
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

  const create = (adapter: string, extra: Record<string, string> = {}) =>
    run(async () => {
      const p = await api<Project>("/projects", {
        method: "POST",
        // Audio projects get server defaults: 正常 / 異常 with 正常 as the passing class.
        body: JSON.stringify({ name: "未命名專案", task, adapter, ...extra, ...(task === "audio" || task === "pose" ? {} : { labels: ["OK", "NG"] }) }),
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
          影像示範專案
        </button>
        <button
          className="raised"
          disabled={busy}
          onClick={() => run(async () => onOpen(await api<Project>("/demo?kind=audio", { method: "POST" })))}
        >
          <Play size={18} />
          音訊示範專案
        </button>
        <button
          className="raised"
          disabled={busy}
          onClick={() => run(async () => onOpen(await api<Project>("/demo?kind=pose", { method: "POST" })))}
        >
          <Play size={18} />
          姿勢示範專案
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
        <button className="taskCard" onClick={() => setTask("audio")}>
          <div className="taskThumbs">
            {["audio-normal-1", "audio-abnormal-1", "audio-normal-2", "audio-abnormal-2"].map((f) => (
              <img key={f} src={`/samples/${f}.png`} alt="" />
            ))}
          </div>
          <h2>{TASKS.audio.title}</h2>
          <p>{TASKS.audio.description}</p>
        </button>
        <button className="taskCard" onClick={() => setTask("pose")}>
          <div className="taskThumbs">
            {["pose-1", "pose-2", "pose-3", "pose-4"].map((f) => (
              <img key={f} src={`/samples/${f}.png`} alt="" />
            ))}
          </div>
          <h2>{TASKS.pose.title}</h2>
          <p>{TASKS.pose.description}</p>
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
                <button key={c.title} className="choiceCard" disabled={busy} onClick={() => create(c.adapter, c.extra)}>
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
