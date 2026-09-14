"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Aperture,
  FolderOpen,
  ScanLine,
  Play,
  Plus,
  Pencil,
  Download,
  ShieldCheck,
  LogOut,
  RefreshCw,
  X,
  ChevronRight,
  Boxes,
} from "lucide-react";
import { api } from "./lib/api";
import type { Ctx, Overview, Project } from "./lib/api";
import Studio from "./studio/Studio";
import Advanced, { ADVANCED_TABS } from "./advanced/Advanced";
import NewProject from "./NewProject";

export default function Page() {
  const [user, setUser] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]),
    [pid, setPid] = useState(""),
    [data, setData] = useState<Overview | null>(null),
    [view, setView] = useState("studio"), // "studio" or an advanced tab key
    [modelId, setModelId] = useState(""),
    [creating, setCreating] = useState(false),
    [loadingProjects, setLoadingProjects] = useState(true),
    [renaming, setRenaming] = useState(false),
    [draftName, setDraftName] = useState("");
  const [username, setUsername] = useState("admin"),
    [password, setPassword] = useState("");
  const p = data?.project;
  const currentPid = useRef(pid);
  currentPid.current = pid;
  const reload = useCallback(async () => {
    const [ps, overview] = await Promise.all([
      api<Project[]>("/projects"),
      pid ? api<Overview>(`/projects/${pid}/overview`) : Promise.resolve(null),
    ]);
    setProjects(ps);
    setLoadingProjects(false);
    if (currentPid.current === pid && overview) setData(overview);
  }, [pid]);
  const run = useCallback(async (fn: () => Promise<void>) => {
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
  }, []);
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
    setModelId("");
    setView("studio");
    setRenaming(false);
  }, [pid]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
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
  const ctx: Ctx | null = data && { pid, data, busy, reload, run, notify: setNotice };
  const advanced = ADVANCED_TABS.find((t) => t.key === view);
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
            setCreating(false);
          }}
        >
          <FolderOpen size={18} />
          全部專案<span>{projects.length}</span>
        </button>
        <div className="sideLabel">專案</div>
        <nav>
          <button disabled={!pid} onClick={() => setView("studio")} className={view === "studio" && pid ? "active" : ""}>
            <Boxes size={18} />
            建模
          </button>
          {ADVANCED_TABS.map((t) => (
            <button key={t.key} disabled={!pid} onClick={() => setView(t.key)} className={view === t.key && pid ? "active" : ""}>
              <t.icon size={18} />
              {t.title}
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
        <div className={"content" + (pid && view === "studio" ? " wide" : "")}>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="關閉">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="success toast" role="status">
              {notice}
            </div>
          )}
          {!pid && (creating || (!loadingProjects && !projects.length)) ? (
            <NewProject
              busy={busy}
              run={run}
              onBack={projects.length ? () => setCreating(false) : undefined}
              onOpen={(pr) => {
                setCreating(false);
                setPid(pr.id);
                setView("studio");
              }}
            />
          ) : !pid ? (
            <>
              <div className="pageTitle">
                <div>
                  <div className="eyebrow">VISION WORKSPACE</div>
                  <h1>讓每一次檢測，都有依據。</h1>
                  <p>從第一張影像，建立你的 AOI 模型。</p>
                </div>
                <button className="primary" onClick={() => setCreating(true)}>
                  <Plus size={18} />
                  新增專案
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
                      setView("studio");
                    })
                  }
                >
                  <Play size={16} />
                  開啟示範專案
                </button>
              </div>
              <div className="projectGrid">
                {projects.map((pr) => (
                  <button
                    className="projectCard"
                    key={pr.id}
                    onClick={() => {
                      setPid(pr.id);
                      setView("studio");
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
            </>
          ) : !ctx ? (
            <div className="empty">載入專案…</div>
          ) : (
            <>
              <div className="pageTitle compactTitle">
                <div>
                  <div className="eyebrow">
                    {p?.task === "classification" ? "CLASSIFICATION" : "OBJECT DETECTION"} / {advanced ? advanced.title : "建模"}
                  </div>
                  {renaming ? (
                    <form
                      className="renameForm"
                      onSubmit={(e) => {
                        e.preventDefault();
                        setRenaming(false);
                        const name = draftName.trim();
                        if (name && name !== p?.name)
                          run(async () => {
                            await api(`/projects/${pid}`, { method: "PATCH", body: JSON.stringify({ name }) });
                            await reload();
                          });
                      }}
                    >
                      <input
                        autoFocus
                        aria-label="專案名稱"
                        maxLength={120}
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                        onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
                      />
                    </form>
                  ) : (
                    <h1>
                      <button
                        className="titleButton"
                        title="點擊改名"
                        onClick={() => {
                          setDraftName(p?.name || "");
                          setRenaming(true);
                        }}
                      >
                        {p?.name}
                        <Pencil size={18} />
                      </button>
                    </h1>
                  )}
                  <p>
                    {p?.synthetic
                      ? "示範影像為人工合成，結果不代表實際產線準確率。"
                      : view === "studio"
                        ? "收集各類別樣本、訓練模型，並即時預覽結果。"
                        : "版本、部署與履歷追溯。"}
                  </p>
                </div>
                <div className="row">
                  <div className="segmented" role="tablist">
                    <button role="tab" aria-selected={view === "studio"} className={view === "studio" ? "on" : ""} onClick={() => setView("studio")}>
                      建模
                    </button>
                    <button role="tab" aria-selected={!!advanced} className={advanced ? "on" : ""} onClick={() => setView("models")}>
                      進階
                    </button>
                  </div>
                  <a className="button" href={`/api/v1/projects/${pid}/archive`} title="下載類別、樣本與標註，可在「從檔案開啟現有專案」匯入">
                    <Download size={16} />
                    匯出專案檔
                  </a>
                  <button onClick={() => run(reload)} disabled={busy} aria-label="更新">
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>
              {view === "studio" ? (
                <Studio ctx={ctx} modelId={modelId} setModelId={setModelId} onAdvanced={setView} />
              ) : (
                <Advanced
                  ctx={ctx}
                  tab={view}
                  setTab={setView}
                  modelId={modelId}
                  onTest={(id) => {
                    setModelId(id);
                    setView("studio");
                  }}
                />
              )}
            </>
          )}
        </div>
        <footer className="workspaceFooter">
          JVision AOI Studio · v0.1 <span>收集 / 訓練 / 預覽 / 追溯</span>
        </footer>
      </main>
      {busy && (
        <div className="working" role="status">
          <span className="spinner" />
          處理中，請稍候…
        </div>
      )}
    </div>
  );
}
