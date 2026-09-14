"use client";
import NetworkCamera from "./NetworkCamera";
import MeasurementPanel from "./MeasurementPanel";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Aperture,
  FolderOpen,
  Images,
  ScanLine,
  Cpu,
  Layers3,
  Play,
  Rocket,
  History,
  Plus,
  Upload,
  ShieldCheck,
  LogOut,
  Camera,
  Check,
  RefreshCw,
  Download,
  X,
  ChevronRight,
} from "lucide-react";
type Box = { label: string; x: number; y: number; w: number; h: number };
type Project = {
  id: string;
  name: string;
  task: string;
  labels: string[];
  active_deployment?: string;
  synthetic?: boolean;
};
type Pic = {
  id: string;
  label: string;
  reviewed: boolean;
  boxes: Box[];
  width: number;
  height: number;
};
type Job = {
  id: string;
  name: string;
  status: string;
  progress: number;
  logs: string[];
  error?: string;
};
type Model = {
  id: string;
  name: string;
  adapter: string;
  metrics: Record<string, unknown>;
  counts: Record<string, number>;
};
type Deployment = {
  id: string;
  model_id: string;
  threshold: number;
  name: string;
  vlm_enabled: boolean;
};
type Inspection = {
  id: string;
  result: string;
  latency_ms: number;
  primary: {
    label: string;
    confidence: number;
    boxes?: { xyxy: number[]; label: string; confidence: number }[];
  };
  secondary?: { reason: string };
  review?: { decision: string; note: string };
  created_at: number;
};
type Overview = {
  project: Project;
  image: Pic[];
  job: Job[];
  model: Model[];
  deployment: Deployment[];
  inspection: Inspection[];
};
const tabs = [
  { title: "影像資料", icon: Images },
  { title: "標註工作室", icon: ScanLine },
  { title: "模型訓練", icon: Cpu },
  { title: "模型版本", icon: Layers3 },
  { title: "即時測試", icon: Play },
  { title: "部署管理", icon: Rocket },
  { title: "檢測履歷", icon: History },
];
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch("/api/v1" + path, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const b = await r.json();
      msg = typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail);
    } catch {}
    throw Error(msg);
  }
  return r.json();
}
export default function Studio() {
  const [user, setUser] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]),
    [pid, setPid] = useState(""),
    [data, setData] = useState<Overview | null>(null),
    [tab, setTab] = useState(0),
    [create, setCreate] = useState(false);
  const [username, setUsername] = useState("admin"),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [task, setTask] = useState("classification"),
    [labels, setLabels] = useState("OK,NG");
  const [label, setLabel] = useState("OK"),
    [group, setGroup] = useState(""),
    [selected, setSelected] = useState(""),
    [boxes, setBoxes] = useState<Box[]>([]),
    [boxLabel, setBoxLabel] = useState("NG");
  const [adapter, setAdapter] = useState("baseline"),
    [mode, setMode] = useState("fast"),
    [epochs, setEpochs] = useState(10),
    [batch, setBatch] = useState(16),
    [lr, setLr] = useState(0.001);
  const [mid, setMid] = useState(""),
    [threshold, setThreshold] = useState(0.85),
    [useVlm, setUseVlm] = useState(false),
    [result, setResult] = useState<Inspection | null>(null),
    [preview, setPreview] = useState(""),
    [testFile, setTestFile] = useState<File | null>(null),
    [cameraOn, setCameraOn] = useState(false);
  const [reviewId, setReviewId] = useState(""),
    [reviewDecision, setReviewDecision] = useState("FAIL"),
    [reviewNote, setReviewNote] = useState("");
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    drag = useRef<{ x: number; y: number } | null>(null);
  const p = data?.project,
    pic = data?.image.find((i) => i.id === selected);
  const currentPid = useRef(pid);
  currentPid.current = pid;
  const reload = useCallback(async () => {
    const [ps, overview] = await Promise.all([
      api<Project[]>("/projects"),
      pid ? api<Overview>(`/projects/${pid}/overview`) : Promise.resolve(null),
    ]);
    setProjects(ps);
    if (currentPid.current === pid && overview) setData(overview);
  }, [pid]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    api<{ username: string }>("/me")
      .then((x) => setUser(x.username))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user) reload().catch((e) => setError(e.message));
  }, [user, reload]);
  useEffect(() => {
    if (!pid || !user) return;
    const t = setInterval(() => reload().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [pid, user, reload]);
  useEffect(() => {
    setData(null);
    setSelected("");
    setMid("");
    setResult(null);
    setLabel("OK");
    setBoxes([]);
  }, [pid]);
  useEffect(() => {
    if (p) setAdapter(p.task === "detection" ? "yolo" : "baseline");
  }, [p?.id, p?.task]);
  useEffect(() => {
    if (pic) {
      setBoxes(pic.boxes);
      setLabel(pic.label);
      setBoxLabel(p?.labels.find((x) => x !== "OK") || "NG");
    }
  }, [selected]); // keep unsaved labels while polling
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    if (cameraOn && video.current) video.current.srcObject = stream.current;
  }, [cameraOn]);
  useEffect(() => {
    if (tab !== 4) {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      setCameraOn(false);
    }
  }, [tab]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const chooseFile = (f: File) => {
    setTestFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
  };
  const upload = async (files: FileList | File[]) =>
    run(async () => {
      let n = 0;
      for (const f of Array.from(files)) {
        const form = new FormData();
        form.append("file", f);
        form.append("label", label);
        form.append("group", group);
        await api(`/projects/${pid}/images`, { method: "POST", body: form });
        n++;
      }
      setNotice(`已上傳 ${n} 張影像`);
      await reload();
    });
  const startCamera = () =>
    run(async () => {
      if (!navigator.mediaDevices) throw Error("相機需要 HTTPS 或 localhost");
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: true,
      });
      setCameraOn(true);
    });
  const capture = () => {
    if (!video.current) return;
    const c = document.createElement("canvas");
    c.width = video.current.videoWidth;
    c.height = video.current.videoHeight;
    if (!c.width) return;
    c.getContext("2d")!.drawImage(video.current, 0, 0);
    c.toBlob((b) => {
      if (b) chooseFile(new File([b], "camera.png", { type: "image/png" }));
    }, "image/png");
  };
  if (loading)
    return (
      <main className="login">
        <Aperture size={48} />
        <p>開啟工作站…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <form
          className="loginCard"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await api<{ username: string }>("/login", {
                method: "POST",
                body: JSON.stringify({ username, password }),
              });
              setUser(r.username);
              setPassword("");
            });
          }}
        >
          <div className="brand">
            <Aperture size={36} />
            <span>
              JVision <b>AOI Studio</b>
            </span>
          </div>
          <h1>進入視覺檢測工作站</h1>
          <p>影像、模型與檢測資料，留在工廠內。</p>
          <label>
            帳號
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            密碼
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            登入工作站 <ChevronRight size={18} />
          </button>
          <small>請使用安裝時設定的管理員帳號。</small>
        </form>
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <Aperture />
          <span>
            JVision <b>AOI Studio</b>
          </span>
        </div>
        <div className="sideLabel">工作空間</div>
        <button
          className="projectNav"
          onClick={() => {
            setPid("");
            setData(null);
          }}
        >
          <FolderOpen size={18} />
          全部專案<span>{projects.length}</span>
        </button>
        <div className="sideLabel">檢測流程</div>
        <nav>
          {tabs.map((t, i) => (
            <button
              key={t.title}
              disabled={!pid}
              onClick={() => setTab(i)}
              className={tab === i && pid ? "active" : ""}
            >
              <t.icon size={18} />
              {t.title}
              <small>{String(i + 1).padStart(2, "0")}</small>
            </button>
          ))}
        </nav>
        <div className="sideBottom">
          <ShieldCheck size={20} />
          <div>
            Local Only<small>本地資料 · 本地模型</small>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header>
          <div className="breadcrumb">
            工作空間 <ChevronRight size={15} /> {p?.name || "全部專案"}
          </div>
          <div className="headerRight">
            <span>{user}</span>
            <button
              aria-label="登出"
              onClick={() =>
                run(async () => {
                  await api("/logout", { method: "POST" });
                  setUser(null);
                  setData(null);
                  setProjects([]);
                  setPid("");
                })
              }
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="關閉">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="success" role="status">
              {notice}
            </div>
          )}
          {!pid ? (
            <>
              <div className="pageTitle">
                <div>
                  <div className="eyebrow">VISION WORKSPACE</div>
                  <h1>讓每一次檢測，都有依據。</h1>
                  <p>從第一張影像，建立你的 AOI 模型。</p>
                </div>
                <button className="primary" onClick={() => setCreate(true)}>
                  <Plus size={18} />
                  建立專案
                </button>
              </div>
              <div className="stats">
                <div>
                  <small>AOI 專案</small>
                  <strong>{projects.length}</strong>
                </div>
                <div>
                  <small>支援任務</small>
                  <strong>分類 / 偵測</strong>
                </div>
                <div>
                  <small>資料模式</small>
                  <strong>廠內運行</strong>
                </div>
              </div>
              <div className="sectionTitle">
                <h2>我的專案</h2>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const p = await api<Project>("/demo", { method: "POST" });
                      await reload();
                      setPid(p.id);
                      setTab(0);
                    })
                  }
                >
                  <Play size={16} />
                  建立示範資料
                </button>
              </div>
              <div className="projectGrid">
                {projects.map((pr) => (
                  <button
                    className="projectCard"
                    key={pr.id}
                    onClick={() => {
                      setPid(pr.id);
                      setTab(0);
                    }}
                  >
                    <div className="projectIcon">
                      <ScanLine size={30} />
                    </div>
                    <span className="badge">
                      {pr.task === "classification" ? "影像分類" : "物件偵測"}
                    </span>
                    <h2>{pr.name}</h2>
                    <p>{pr.labels.join(" / ")}</p>
                    <footer>
                      {pr.synthetic
                        ? "合成資料 · 僅供流程驗證"
                        : "自訂檢測專案"}
                      <ChevronRight size={18} />
                    </footer>
                  </button>
                ))}
              </div>
              {!projects.length && (
                <div className="empty">
                  <FolderOpen size={40} />
                  <h2>從一個檢測專案開始</h2>
                  <p>建立自己的專案，或使用 60 張合成影像走完訓練流程。</p>
                </div>
              )}
            </>
          ) : !data ? (
            <div className="empty">載入專案…</div>
          ) : (
            <>
              <div className="pageTitle">
                <div>
                  <div className="eyebrow">
                    {p?.task === "classification"
                      ? "CLASSIFICATION"
                      : "OBJECT DETECTION"}{" "}
                    / {tabs[tab].title}
                  </div>
                  <h1>{p?.name}</h1>
                  <p>
                    {p?.synthetic
                      ? "示範影像為人工合成，結果不代表實際產線準確率。"
                      : "建立資料、驗證模型，再交付產線。"}
                  </p>
                </div>
                <button onClick={() => run(reload)} disabled={busy}>
                  <RefreshCw size={16} />
                  更新
                </button>
              </div>
              <div className="stepper">
                {["影像", "標註", "訓練", "版本", "測試", "部署"].map(
                  (s, i) => (
                    <button
                      className={tab === i ? "current" : ""}
                      key={s}
                      onClick={() => setTab(i)}
                    >
                      <span>{i + 1}</span>
                      {s}
                    </button>
                  ),
                )}
              </div>
              {tab === 0 && (
                <>
                  <div className="stats">
                    <div>
                      <small>影像總數</small>
                      <strong>{data.image.length}</strong>
                    </div>
                    <div>
                      <small>已確認</small>
                      <strong>
                        {data.image.filter((x) => x.reviewed).length}
                      </strong>
                    </div>
                    <div>
                      <small>類別數</small>
                      <strong>{p?.labels.length}</strong>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="sectionTitle">
                      <h2>加入影像</h2>
                      <span className="muted">PNG / JPG · 單張上限 20 MB</span>
                    </div>
                    <div className="row">
                      <label>
                        影像類別
                        <select
                          value={label}
                          onChange={(e) => setLabel(e.target.value)}
                        >
                          {p?.labels.map((l) => (
                            <option key={l}>{l}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        批次群組（選填）
                        <input
                          placeholder="同批、連拍影像請填相同群組"
                          value={group}
                          onChange={(e) => setGroup(e.target.value)}
                        />
                      </label>
                    </div>
                    <label
                      className="dropzone"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!busy) upload(e.dataTransfer.files);
                      }}
                    >
                      <Upload size={28} />
                      <b>拖曳影像至此，或點擊選取</b>
                      <span>依目前選取的類別匯入，可一次選擇多張。</span>
                      <input
                        aria-label="上傳影像"
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={busy}
                        onChange={(e) => {
                          if (e.target.files) upload(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </section>
                  <div className="sectionTitle">
                    <h2>影像資料集</h2>
                    <div className="row">
                      {p?.labels.map((l) => (
                        <span className="badge" key={l}>
                          {l} · {data.image.filter((x) => x.label === l).length}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="imageGrid">
                    {data.image.map((im) => (
                      <button
                        className="imageCard"
                        key={im.id}
                        onClick={() => {
                          setSelected(im.id);
                          setTab(1);
                        }}
                      >
                        <img
                          src={`/api/v1/images/${im.id}/content`}
                          alt={`${im.label} 檢測影像`}
                        />
                        <footer>
                          <b>{im.label}</b>
                          <span>{im.reviewed ? "已確認" : "待標註"}</span>
                        </footer>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {tab === 1 && (
                <div className="annotationGrid">
                  <section className="panel">
                    <div className="sectionTitle">
                      <h2>選擇影像</h2>
                      <span>{data.image.length} 張</span>
                    </div>
                    <div className="thumbs">
                      {data.image.map((im) => (
                        <button
                          className={selected === im.id ? "chosen" : ""}
                          key={im.id}
                          onClick={() => setSelected(im.id)}
                        >
                          <img
                            src={`/api/v1/images/${im.id}/content`}
                            alt={im.label}
                          />
                          <span>
                            {im.label} {im.reviewed ? "✓" : "○"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="panel">
                    {pic ? (
                      <>
                        <div className="sectionTitle">
                          <h2>標註與確認</h2>
                          <span>
                            {pic.width} × {pic.height} px
                          </span>
                        </div>
                        <div
                          className="annotator"
                          onPointerDown={(e) => {
                            if (p?.task !== "detection") return;
                            e.currentTarget.setPointerCapture(e.pointerId);
                            const r = e.currentTarget.getBoundingClientRect();
                            drag.current = {
                              x: (e.clientX - r.left) / r.width,
                              y: (e.clientY - r.top) / r.height,
                            };
                          }}
                          onPointerUp={(e) => {
                            if (!drag.current) return;
                            const r = e.currentTarget.getBoundingClientRect(),
                              end = {
                                x: Math.max(
                                  0,
                                  Math.min(1, (e.clientX - r.left) / r.width),
                                ),
                                y: Math.max(
                                  0,
                                  Math.min(1, (e.clientY - r.top) / r.height),
                                ),
                              },
                              start = drag.current;
                            drag.current = null;
                            const b = {
                              label: boxLabel,
                              x: Math.min(start.x, end.x),
                              y: Math.min(start.y, end.y),
                              w: Math.abs(start.x - end.x),
                              h: Math.abs(start.y - end.y),
                            };
                            if (b.w > 0.005 && b.h > 0.005) {
                              setBoxes([...boxes, b]);
                              setLabel(boxLabel);
                            }
                          }}
                        >
                          <img
                            draggable={false}
                            src={`/api/v1/images/${pic.id}/content`}
                            alt="標註影像"
                          />
                          {boxes.map((b, i) => (
                            <div
                              className="bbox"
                              key={i}
                              style={{
                                left: `${b.x * 100}%`,
                                top: `${b.y * 100}%`,
                                width: `${b.w * 100}%`,
                                height: `${b.h * 100}%`,
                              }}
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
                              }}
                            >
                              {p?.labels.map((l) => (
                                <option key={l}>{l}</option>
                              ))}
                            </select>
                          </label>
                          {p?.task === "detection" && (
                            <label>
                              框選類別
                              <select
                                value={boxLabel}
                                onChange={(e) => setBoxLabel(e.target.value)}
                              >
                                {p.labels
                                  .filter((l) => l !== "OK")
                                  .map((l) => (
                                    <option key={l}>{l}</option>
                                  ))}
                              </select>
                            </label>
                          )}
                        </div>
                        <p className="muted">
                          {p?.task === "detection"
                            ? "在影像上拖曳建立瑕疵框；良品選 OK 並保留空框。"
                            : "確認影像分類後儲存。"}
                        </p>
                        <div className="row">
                          <button onClick={() => setBoxes([])}>清除框選</button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                const r = await api<{
                                  suggestion: {
                                    label: string;
                                    boxes?: { xyxy: number[]; label: string }[];
                                  };
                                }>(
                                  `/projects/${pid}/images/${pic.id}/suggest`,
                                  { method: "POST" },
                                );
                                if (p?.labels.includes(r.suggestion.label))
                                  setLabel(r.suggestion.label);
                                if (p?.task === "detection")
                                  setBoxes(
                                    (r.suggestion.boxes || []).map((b) => ({
                                      label: b.label,
                                      x: b.xyxy[0] / pic.width,
                                      y: b.xyxy[1] / pic.height,
                                      w: (b.xyxy[2] - b.xyxy[0]) / pic.width,
                                      h: (b.xyxy[3] - b.xyxy[1]) / pic.height,
                                    })),
                                  );
                                setNotice("已填入模型建議，請人工確認後儲存");
                              })
                            }
                          >
                            模型輔助標註
                          </button>
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await api(`/images/${pic.id}/annotation`, {
                                  method: "PUT",
                                  body: JSON.stringify({
                                    label,
                                    boxes,
                                    reviewed: true,
                                  }),
                                });
                                await reload();
                                setNotice("標註已確認");
                              })
                            }
                          >
                            <Check size={16} />
                            確認儲存
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="empty">請從左側選擇影像</div>
                    )}
                  </section>
                </div>
              )}
              {tab === 2 && (
                <div className="twoCols">
                  <section className="panel">
                    <h2>一鍵訓練</h2>
                    <p className="muted">
                      自動分割資料、排入訓練佇列並登錄模型版本。
                    </p>
                    <label>
                      模型
                      <select
                        value={adapter}
                        onChange={(e) => setAdapter(e.target.value)}
                      >
                        {p?.task === "detection" ? (
                          <option value="yolo">YOLO · GPU 瑕疵偵測</option>
                        ) : (
                          <>
                            <option value="baseline">
                              CPU 基準分類器 · 流程驗證
                            </option>
                            <option value="cnn">PyTorch CNN · 影像分類</option>
                          </>
                        )}
                      </select>
                    </label>
                    <label>
                      訓練模式
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                      >
                        <option value="fast">Fast · 快速試驗</option>
                        <option value="balanced">Balanced · 平衡</option>
                        <option value="accurate">
                          High Accuracy · 較長訓練，不保證精度提升
                        </option>
                        <option value="advanced">Advanced · 自訂參數</option>
                      </select>
                    </label>
                    {mode === "advanced" && (
                      <div className="row">
                        <label>
                          Epoch
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={epochs}
                            onChange={(e) => setEpochs(+e.target.value)}
                          />
                        </label>
                        <label>
                          Batch
                          <input
                            type="number"
                            min={1}
                            max={128}
                            value={batch}
                            onChange={(e) => setBatch(+e.target.value)}
                          />
                        </label>
                        <label>
                          Learning rate
                          <input
                            type="number"
                            step="0.0001"
                            value={lr}
                            onChange={(e) => setLr(+e.target.value)}
                          />
                        </label>
                      </div>
                    )}
                    <div className="callout">
                      每類至少 5
                      個獨立影像或群組。相同批次不跨集合；已確認資料才可訓練。CPU
                      基準分類器不使用 epoch 設定。
                    </div>
                    <button
                      className="primary full"
                      disabled={
                        busy ||
                        data.job.some((j) =>
                          ["queued", "running"].includes(j.status),
                        )
                      }
                      onClick={() =>
                        run(async () => {
                          await api(`/projects/${pid}/train`, {
                            method: "POST",
                            body: JSON.stringify({
                              adapter,
                              mode,
                              epochs,
                              batch_size: batch,
                              learning_rate: lr,
                            }),
                          });
                          await reload();
                          setNotice("訓練工作已建立");
                        })
                      }
                    >
                      <Cpu size={18} />
                      開始訓練
                    </button>
                  </section>
                  <section className="panel">
                    <h2>訓練狀態</h2>
                    {!data.job.length && (
                      <div className="empty">尚未建立訓練工作</div>
                    )}
                    {[...data.job].reverse().map((j) => (
                      <article className="job" key={j.id}>
                        <div className="sectionTitle">
                          <b>{j.name}</b>
                          <span className="badge">{j.status}</span>
                        </div>
                        <progress value={j.progress} max={100} />
                        <span>{j.progress}%</span>
                        <pre>
                          {j.error ||
                            j.logs.slice(-8).join("\n") ||
                            "等待 GPU worker 接手…"}
                        </pre>
                      </article>
                    ))}
                  </section>
                </div>
              )}
              {tab === 3 && (
                <section className="panel">
                  <h2>模型版本庫</h2>
                  <p className="muted">
                    每個版本綁定訓練參數與不可變的資料快照。以下指標來自保留資料。
                  </p>
                  {!data.model.length && (
                    <div className="empty">完成訓練後，模型會出現在這裡。</div>
                  )}
                  {[...data.model].reverse().map((m, i) => (
                    <article className="model" key={m.id}>
                      <div className="sectionTitle">
                        <div>
                          <span className="badge">
                            V{data.model.length - i} · {m.adapter}
                          </span>
                          <h3>{m.name}</h3>
                        </div>
                        <div className="row">
                          <button
                            onClick={() => {
                              setMid(m.id);
                              setTab(4);
                            }}
                          >
                            <Play size={16} />
                            測試
                          </button>
                          <button
                            className="primary"
                            onClick={() => {
                              setMid(m.id);
                              setTab(5);
                            }}
                          >
                            <Rocket size={16} />
                            部署
                          </button>
                        </div>
                      </div>
                      <p>
                        Train {m.counts.train} / Validation {m.counts.val} /
                        Test {m.counts.test}
                      </p>
                      <pre>{JSON.stringify(m.metrics, null, 2)}</pre>
                      <a
                        className="button"
                        href={`/api/v1/models/${m.id}/export?format=native`}
                      >
                        <Download size={16} />
                        原生權重
                      </a>
                      {m.adapter !== "baseline" && (
                        <a
                          className="button"
                          href={`/api/v1/models/${m.id}/export?format=onnx`}
                        >
                          匯出 ONNX
                        </a>
                      )}
                    </article>
                  ))}
                </section>
              )}
              {tab === 4 && (
                <div className="twoCols">
                  <section className="panel">
                    <div className="sectionTitle">
                      <h2>AOI Playground</h2>
                      <span className="badge">單張推論</span>
                    </div>
                    <NetworkCamera
                      key={pid}
                      pid={pid}
                      labels={p?.labels || ["OK", "NG"]}
                      onCapture={chooseFile}
                    />
                    <label>
                      測試模型
                      <select
                        value={mid}
                        onChange={(e) => setMid(e.target.value)}
                      >
                        <option value="">目前部署（含複判規則）</option>
                        {data.model.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="testImage">
                      {preview ? (
                        <img src={preview} alt="待測影像" />
                      ) : (
                        <div className="empty">
                          <ScanLine size={48} />
                          <p>上傳影像或使用相機擷取</p>
                        </div>
                      )}
                    </div>
                    <MeasurementPanel
                      key={preview}
                      pid={pid}
                      file={testFile}
                      preview={preview}
                    />
                    {cameraOn && (
                      <video ref={video} autoPlay playsInline muted />
                    )}
                    <div className="row">
                      <label className="button">
                        <Upload size={16} />
                        選擇影像
                        <input
                          hidden
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            if (e.target.files?.[0])
                              chooseFile(e.target.files[0]);
                          }}
                        />
                      </label>
                      <button onClick={startCamera} disabled={busy || cameraOn}>
                        <Camera size={16} />
                        開啟相機
                      </button>
                      {cameraOn && (
                        <>
                          <button onClick={capture}>擷取</button>
                          <button
                            onClick={() => {
                              stream.current
                                ?.getTracks()
                                .forEach((t) => t.stop());
                              setCameraOn(false);
                            }}
                          >
                            關閉
                          </button>
                        </>
                      )}
                    </div>
                    <button
                      className="primary full"
                      disabled={busy || !testFile}
                      onClick={() =>
                        run(async () => {
                          const f = new FormData();
                          f.append("project_id", pid);
                          f.append("file", testFile!);
                          if (mid) f.append("model_id", mid);
                          setResult(
                            await api<Inspection>("/inference", {
                              method: "POST",
                              body: f,
                            }),
                          );
                          await reload();
                        })
                      }
                    >
                      <Play size={18} />
                      執行檢測
                    </button>
                  </section>
                  <section className="panel">
                    <h2>檢測結果</h2>
                    {result ? (
                      <>
                        <div className={"verdict " + result.result}>
                          <small>INSPECTION RESULT</small>
                          <strong>{result.result}</strong>
                          <span>
                            {result.result === "REVIEW"
                              ? "需要人工複判"
                              : result.result === "PASS"
                                ? "符合目前判定規則"
                                : "檢出疑似瑕疵"}
                          </span>
                        </div>
                        <div className="stats resultStats">
                          <div>
                            <small>模型分數</small>
                            <strong>
                              {(result.primary.confidence * 100).toFixed(1)}%
                            </strong>
                          </div>
                          <div>
                            <small>處理耗時</small>
                            <strong>{result.latency_ms} ms</strong>
                          </div>
                        </div>
                        <p>判定類別：{result.primary.label}</p>
                        {result.secondary && (
                          <div className="callout">
                            VLM：{result.secondary.reason}
                          </div>
                        )}
                        <pre>{JSON.stringify(result.primary, null, 2)}</pre>
                        <p className="muted">
                          模型分數未經產線校準，不代表實際正確機率。耗時包含模型載入與複判。
                        </p>
                      </>
                    ) : (
                      <div className="empty">
                        <Aperture size={48} />
                        <p>完成檢測後顯示真實推論結果</p>
                      </div>
                    )}
                  </section>
                </div>
              )}
              {tab === 5 && (
                <div className="twoCols">
                  <section className="panel">
                    <h2>部署至本地 Runtime</h2>
                    <label>
                      選擇版本
                      <select
                        value={mid}
                        onChange={(e) => setMid(e.target.value)}
                      >
                        <option value="">請選擇模型</option>
                        {data.model.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      第一層判定門檻 · {threshold.toFixed(2)}
                      <input
                        type="range"
                        min="0.5"
                        max="1"
                        step="0.01"
                        value={threshold}
                        onChange={(e) => setThreshold(+e.target.value)}
                      />
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={useVlm}
                        onChange={(e) => setUseVlm(e.target.checked)}
                      />
                      低信心結果送本地 VLM 複判
                    </label>
                    <div className="callout">
                      VLM 回覆 OK 預設仍需人工確認。無回應、格式錯誤或低信心一律
                      REVIEW，不會自動放行。
                    </div>
                    <button
                      className="primary full"
                      disabled={busy || !mid}
                      onClick={() =>
                        run(async () => {
                          await api(`/projects/${pid}/deploy`, {
                            method: "POST",
                            body: JSON.stringify({
                              model_id: mid,
                              threshold,
                              vlm_enabled: useVlm,
                            }),
                          });
                          await reload();
                          setNotice("本地 Runtime 已切換版本");
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
                    {!data.deployment.length && (
                      <div className="empty">尚未部署</div>
                    )}
                    {[...data.deployment].reverse().map((d) => (
                      <article className="job" key={d.id}>
                        <div className="sectionTitle">
                          <b>{d.name}</b>
                          <span className="badge">
                            {p?.active_deployment === d.id
                              ? "目前啟用"
                              : "歷史版本"}
                          </span>
                        </div>
                        <p>
                          門檻 {d.threshold} · VLM{" "}
                          {d.vlm_enabled ? "開啟" : "關閉"}
                        </p>
                        <small>
                          {data.model.find((m) => m.id === d.model_id)?.name}
                        </small>
                        {p?.active_deployment !== d.id && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await api(`/projects/${pid}/rollback/${d.id}`, {
                                  method: "POST",
                                });
                                await reload();
                                setNotice("已回滾至所選部署");
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
              )}
              {tab === 6 && (
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
                          <th>耗時</th>
                          <th>人工複判</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...data.inspection].reverse().map((r) => (
                          <tr key={r.id}>
                            <td>
                              <a
                                href={`/api/v1/inspections/${r.id}/content`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <img
                                  className="historyImage"
                                  src={`/api/v1/inspections/${r.id}/content`}
                                  alt="檢測影像"
                                />
                              </a>
                            </td>
                            <td>
                              {new Date(r.created_at * 1000).toLocaleString(
                                "zh-TW",
                              )}
                            </td>
                            <td>
                              <span className={"badge " + r.result}>
                                {r.result}
                              </span>
                            </td>
                            <td>
                              {r.primary.label} /{" "}
                              {(r.primary.confidence * 100).toFixed(1)}%
                            </td>
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
                                    setReviewNote("");
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
                  {!data.inspection.length && (
                    <div className="empty">尚無檢測紀錄，請先執行測試。</div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
        <footer className="workspaceFooter">
          JVision AOI Studio · v0.1 <span>訓練 / 驗證 / 判定 / 追溯</span>
        </footer>
      </main>
      {create && (
        <div className="overlay">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const p = await api<Project>("/projects", {
                  method: "POST",
                  body: JSON.stringify({
                    name,
                    task,
                    labels: labels.split(",").map((x) => x.trim()),
                  }),
                });
                setCreate(false);
                setPid(p.id);
                setTab(0);
                setName("");
                await reload();
              });
            }}
          >
            <div className="sectionTitle">
              <h2>建立 AOI 專案</h2>
              <button
                type="button"
                onClick={() => setCreate(false)}
                aria-label="關閉"
              >
                <X />
              </button>
            </div>
            <label>
              專案名稱
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：MLCC 外觀瑕疵檢查"
              />
            </label>
            <label>
              檢測任務
              <select value={task} onChange={(e) => setTask(e.target.value)}>
                <option value="classification">影像分類 · OK / NG</option>
                <option value="detection">物件偵測 · 瑕疵位置</option>
              </select>
            </label>
            <label>
              類別（逗號分隔，必須包含 OK）
              <input
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="primary full" disabled={busy}>
              建立專案
            </button>
          </form>
        </div>
      )}
      {reviewId && (
        <div className="overlay">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(`/inspections/${reviewId}/review`, {
                  method: "POST",
                  body: JSON.stringify({
                    decision: reviewDecision,
                    note: reviewNote,
                  }),
                });
                setReviewId("");
                await reload();
              });
            }}
          >
            <h2>人工複判</h2>
            <img
              className="reviewImage"
              src={`/api/v1/inspections/${reviewId}/content`}
              alt="待複判影像"
            />
            <label>
              確認結果
              <select
                value={reviewDecision}
                onChange={(e) => setReviewDecision(e.target.value)}
              >
                <option>FAIL</option>
                <option>PASS</option>
              </select>
            </label>
            <label>
              判定依據
              <textarea
                required
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
            </label>
            {error && <div className="error">{error}</div>}
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
      {busy && (
        <div className="working" role="status">
          <span className="spinner" />
          處理中，請稍候…
        </div>
      )}
    </div>
  );
}
