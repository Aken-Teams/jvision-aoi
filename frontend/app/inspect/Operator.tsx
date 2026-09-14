"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Aperture, Bell, BellOff, Camera, Expand, LogOut, Mic, Play, Repeat, Square, Video, X } from "lucide-react";
import { classColor, cropImage } from "../lib/api";
import type { Primary, Roi } from "../lib/api";
import { encodeWav, LevelMeter, SR, useMic } from "../lib/audio";
import { useWebcam, WebcamPicker } from "../studio/useWebcam";
import { captureSequence } from "../studio/SequenceRecorder";
import Skeleton from "../studio/Skeleton";

type Config = {
  app: { id: string; name: string; slug: string; alert_sound: boolean };
  project: { name: string; task: string; labels: string[]; pass_labels: string[]; pose_mode: string | null; roi: Roi | null };
  deployment: { id: string; threshold: number; model_version: number | null; deployed_at: number } | null;
  cameras: { id: string; name: string }[];
};
type Record_ = { id: string; result: string; primary: Primary; latency_ms: number; created_at: number; review?: { decision: string; note: string } | null; trigger?: string };
type Stats = { today: { PASS: number; FAIL: number; REVIEW: number; total: number; pending_review: number }; recent: Record_[] };
type Sample = { files: Blob[]; width: number; height: number };

const INTERVALS = [1, 2, 3, 5, 10];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TEXT: Record<string, string> = { PASS: "合格", FAIL: "不合格", REVIEW: "需複判" };

function beep(result: string) {
  try {
    const ctx = new AudioContext();
    const tones = result === "FAIL" ? [880, 0, 880] : [520];
    tones.forEach((f, i) => {
      if (!f) return;
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

export default function Operator({ slug }: { slug: string }) {
  const base = `/api/runtime/${encodeURIComponent(slug)}`;
  const [authed, setAuthed] = useState<boolean | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [notFound, setNotFound] = useState(false);

  const call = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const r = await fetch(base + path, {
        ...options,
        headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options.headers },
      });
      if (r.status === 401 && path !== "/login") setAuthed(false);
      if (r.status === 404 && path === "/config") setNotFound(true);
      if (!r.ok) {
        let msg = [502, 503, 504].includes(r.status) ? `伺服器暫時無法連線（HTTP ${r.status}）` : `HTTP ${r.status}`;
        try {
          const b = await r.json();
          if (typeof b.detail === "string") msg = b.detail;
        } catch {}
        throw Object.assign(Error(msg), { status: r.status });
      }
      return r.json();
    },
    [base],
  );

  const loadConfig = useCallback(
    () =>
      call<Config>("/config").then(
        (c) => {
          setConfig(c);
          setAuthed(true);
          document.title = `${c.app.name} · JVision 檢測`;
        },
        () => {},
      ),
    [call],
  );
  useEffect(() => {
    loadConfig().finally(() => setAuthed((a) => (a === null ? false : a)));
  }, [loadConfig]);
  // Deployment switches and rollbacks in Studio reach the station without a reload.
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(loadConfig, 30000);
    return () => clearInterval(t);
  }, [authed, loadConfig]);

  if (notFound)
    return (
      <main className="opLogin">
        <div className="opLoginCard">
          <Aperture size={40} />
          <h1>找不到此檢測 App</h1>
          <p>請確認網址是否正確，或聯絡管理員。</p>
        </div>
      </main>
    );
  if (authed === null) return <main className="opLogin">載入中…</main>;
  if (!authed || !config)
    return (
      <main className="opLogin">
        <form
          className="opLoginCard"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await call("/login", { method: "POST", body: JSON.stringify({ code }) });
              setCode("");
              await loadConfig();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <Aperture size={40} />
          <h1>檢測站登入</h1>
          <p>{slug}</p>
          <label>
            存取碼
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="8 位數字"
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary full" disabled={!code.trim()}>
            開始檢測
          </button>
        </form>
      </main>
    );
  return <Station config={config} call={call} onLogout={() => setAuthed(false)} base={base} />;
}

function Station({
  config,
  call,
  onLogout,
  base,
}: {
  config: Config;
  call: <T>(path: string, options?: RequestInit) => Promise<T>;
  onLogout: () => void;
  base: string;
}) {
  const { project, deployment } = config;
  const isAudio = project.task === "audio",
    isPose = project.task === "pose",
    isSequence = isPose && project.pose_mode === "sequence",
    detection = project.task === "detection";
  const roi = project.roi;
  const cam = useWebcam(),
    mic = useMic();
  const [source, setSource] = useState<"webcam" | "network" | "mic">(isAudio ? "mic" : "webcam"),
    [cid, setCid] = useState(config.cameras[0]?.id || ""),
    [inputOn, setInputOn] = useState(false),
    [live, setLive] = useState<{ primary: Primary; size: { w: number; h: number } } | null>(null),
    [last, setLast] = useState<(Record_ & { size?: { w: number; h: number } }) | null>(null),
    [busy, setBusy] = useState(false),
    [continuous, setContinuous] = useState(false),
    [interval, setIntervalSec] = useState(2),
    [stats, setStats] = useState<Stats | null>(null),
    [error, setError] = useState(""),
    [sound, setSound] = useState(config.app.alert_sound),
    [reviewing, setReviewing] = useState<Record_ | null>(null),
    [clock, setClock] = useState(() => new Date());
  const busyRef = useRef(false);

  const refreshStats = useCallback(() => call<Stats>("/inspections?limit=24").then(setStats, () => {}), [call]);
  useEffect(() => {
    refreshStats();
    const t = setInterval(refreshStats, 10000);
    const c = setInterval(() => setClock(new Date()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [refreshStats]);

  // Keep the screen awake on a dedicated inspection station.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
    if (inputOn) nav.wakeLock?.request("screen").then((l) => (lock = l), () => {});
    return () => void lock?.release().catch(() => {});
  }, [inputOn]);

  const { start: camStart, stop: camStop } = cam,
    { start: micStart, stop: micStop } = mic;
  useEffect(() => {
    if (inputOn && source === "webcam") camStart();
    else camStop();
    if (inputOn && source === "mic") micStart();
    else micStop();
    if (!inputOn) setContinuous(false);
  }, [inputOn, source, camStart, camStop, micStart, micStop]);

  /** Captures one inspection sample from the active source. */
  const capture = async (forPreview: boolean): Promise<Sample | null> => {
    if (source === "mic") {
      const clip = mic.last(SR);
      return clip ? { files: [encodeWav(clip)], width: 1, height: 1 } : null;
    }
    if (source === "network") {
      if (!cid) return null;
      const r = await fetch(`${base}/cameras/${cid}/capture`, { method: "POST" });
      if (!r.ok) throw Error("IP 相機擷取失敗");
      const blob = await cropImage(await r.blob(), roi, "image/jpeg", 0.95);
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return { files: [blob], ...size };
    }
    if (isSequence) {
      const files = await captureSequence(cam, roi, forPreview ? 480 : 640);
      return { files, width: 1, height: 1 };
    }
    const frame = forPreview
      ? await cam.grab(detection || isPose ? 640 : 320, "image/jpeg", 0.85, roi)
      : await cam.grab(0, "image/png", 1, roi);
    return frame ? { files: [frame.blob], width: frame.width, height: frame.height } : null;
  };

  const form = (sample: Sample, mode?: string) => {
    const f = new FormData();
    sample.files.forEach((b, i) => f.append("file", b, `sample-${i}.${b.type === "audio/wav" ? "wav" : "jpg"}`));
    if (mode) f.append("mode", mode);
    return f;
  };

  const inspect = useCallback(
    async (mode: "single" | "continuous") => {
      if (busyRef.current || !deployment) return;
      busyRef.current = true;
      setBusy(true);
      setError("");
      try {
        const sample = await capture(false);
        if (!sample) throw Error(source === "mic" ? "麥克風尚未收到足夠的聲音" : "畫面尚未就緒");
        const r = await call<Record_>("/inspect", { method: "POST", body: form(sample, mode) });
        setLast({ ...r, size: { w: sample.width, h: sample.height } });
        if (sound && r.result !== "PASS") beep(r.result);
        refreshStats();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    // capture reads the latest source/camera state through refs and closures on each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deployment, source, cid, sound, isSequence, roi],
  );

  // Live preview while idle; continuous inspection replaces it with recorded inspections.
  useEffect(() => {
    if (!inputOn || continuous || !deployment) return;
    let alive = true;
    (async () => {
      await sleep(800);
      while (alive) {
        const started = performance.now();
        if (!busyRef.current && document.visibilityState === "visible" && source !== "network") {
          try {
            const sample = await capture(true);
            if (sample && alive) {
              const r = await call<{ primary: Primary }>("/preview", { method: "POST", body: form(sample) });
              if (alive) setLive({ primary: r.primary, size: { w: sample.width, h: sample.height } });
            }
          } catch {
            await sleep(1000);
          }
        }
        await sleep(Math.max(0, (isAudio ? 500 : 300) - (performance.now() - started)));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputOn, continuous, deployment?.id, source, cid, cam.on, mic.on]);

  useEffect(() => {
    if (!continuous) return;
    let alive = true;
    (async () => {
      while (alive) {
        const started = performance.now();
        await inspect("continuous");
        await sleep(Math.max(200, interval * 1000 - (performance.now() - started)));
      }
    })();
    return () => {
      alive = false;
    };
  }, [continuous, interval, inspect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || reviewing) return;
      if ((e.code === "Space" || e.key === "Enter") && inputOn && !continuous) {
        e.preventDefault();
        inspect("single");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputOn, continuous, inspect, reviewing]);

  const shown = last && Date.now() / 1000 - last.created_at < 30 ? last : null;
  const overlay = continuous || shown ? (shown ? { primary: shown.primary, size: shown.size || { w: 1, h: 1 } } : live) : live;
  const scores = overlay?.primary.scores || {};
  const boxes = overlay?.primary.boxes || [];
  const passRate = stats && stats.today.total ? Math.round((stats.today.PASS / stats.today.total) * 100) : null;

  return (
    <div className="op">
      <header className="opHeader">
        <div className="opTitle">
          <Aperture size={26} />
          <div>
            <b>{config.app.name}</b>
            <small>
              {project.name} · {deployment ? `模型 V${deployment.model_version ?? "?"} · 門檻 ${deployment.threshold}` : "尚未部署"}
            </small>
          </div>
        </div>
        <div className="opHeaderRight">
          <time>{clock.toLocaleTimeString("zh-TW", { hour12: false })}</time>
          <button className="opIcon" onClick={() => setSound(!sound)} aria-label={sound ? "關閉提示音" : "開啟提示音"} title="不合格／需複判提示音">
            {sound ? <Bell size={20} /> : <BellOff size={20} />}
          </button>
          <button className="opIcon" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} aria-label="全螢幕">
            <Expand size={20} />
          </button>
          <button
            className="opIcon"
            aria-label="登出"
            onClick={async () => {
              setInputOn(false);
              await call("/logout", { method: "POST" }).catch(() => {});
              onLogout();
            }}
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {!deployment && <div className="opBanner">此專案尚未部署模型，無法檢測。請聯絡管理員在 Studio 部署模型。</div>}
      {error && (
        <div className="opBanner error">
          {error}
          <button onClick={() => setError("")} aria-label="關閉">
            <X size={16} />
          </button>
        </div>
      )}

      <main className="opMain">
        <section className="opStage">
          <div className="opSources">
            {isAudio ? (
              <span className="opSourceLabel">
                <Mic size={16} /> 麥克風
              </span>
            ) : (
              <>
                <button className={source === "webcam" ? "on" : ""} onClick={() => setSource("webcam")}>
                  <Video size={16} /> 網路攝影機
                </button>
                {config.cameras.length > 0 && !isSequence && (
                  <button className={source === "network" ? "on" : ""} onClick={() => setSource("network")}>
                    <Camera size={16} /> IP 相機
                  </button>
                )}
              </>
            )}
            {source === "webcam" && <WebcamPicker cam={cam} />}
            {source === "network" && (
              <select aria-label="IP 相機" value={cid} onChange={(e) => setCid(e.target.value)}>
                {config.cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <label className="switch opSwitch">
              <input type="checkbox" checked={inputOn} onChange={(e) => setInputOn(e.target.checked)} />
              <span />
              {inputOn ? "輸入開啟" : "輸入關閉"}
            </label>
          </div>
          <div className="opView">
            {source === "webcam" && inputOn ? (
              <div className="roiStage opVideo">
                <video ref={cam.video} autoPlay playsInline muted />
                {roi && <div className="roiBox" style={{ left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` }} />}
                <div className="roiInner" style={roi ? { left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` } : { inset: 0 }}>
                  {!isSequence && boxes.map((b, i) => (
                    <div
                      key={i}
                      className="bbox"
                      style={{
                        left: `${(b.xyxy[0] / (overlay?.size.w || 1)) * 100}%`,
                        top: `${(b.xyxy[1] / (overlay?.size.h || 1)) * 100}%`,
                        width: `${((b.xyxy[2] - b.xyxy[0]) / (overlay?.size.w || 1)) * 100}%`,
                        height: `${((b.xyxy[3] - b.xyxy[1]) / (overlay?.size.h || 1)) * 100}%`,
                      }}
                    >
                      <span>
                        {b.label} {(b.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                  {isPose && <Skeleton keypoints={overlay?.primary.keypoints} />}
                </div>
              </div>
            ) : source === "mic" && inputOn ? (
              <div className="opAudio">
                <Mic size={56} />
                <LevelMeter level={mic.level} />
                <small>判斷最近 1 秒的聲音</small>
              </div>
            ) : source === "network" && inputOn ? (
              <div className="opAudio">
                <Camera size={56} />
                <small>IP 相機於每次檢測時擷取畫面</small>
              </div>
            ) : (
              <div className="opIdle">
                <p>開啟輸入後開始檢測</p>
                <button className="primary" disabled={!deployment} onClick={() => setInputOn(true)}>
                  開啟{isAudio ? "麥克風" : source === "network" ? "IP 相機" : "網路攝影機"}
                </button>
              </div>
            )}
            {(cam.error || mic.error) && <div className="opBanner error">{cam.error || mic.error}</div>}
          </div>
        </section>

        <div className="opPanel">
          <div className={"opVerdict " + (shown ? shown.result : "IDLE")}>
            <small>{shown ? new Date(shown.created_at * 1000).toLocaleTimeString("zh-TW", { hour12: false }) : "等待檢測"}</small>
            <strong>{shown ? shown.result : "—"}</strong>
            <span>{shown ? `${TEXT[shown.result]} · ${shown.primary.label === "UNKNOWN" ? shown.primary.reason || "無法判斷" : shown.primary.label} ${(shown.primary.confidence * 100).toFixed(1)}%` : "按下「檢測」或空白鍵"}</span>
          </div>

          <div className="opActions">
            <button className="primary opInspect" disabled={!inputOn || busy || continuous || !deployment} onClick={() => inspect("single")}>
              <Play size={22} />
              {busy && !continuous ? "檢測中…" : "檢測"}
            </button>
            <div className="opContinuous">
              <button className={continuous ? "opStop" : ""} disabled={!inputOn || !deployment} onClick={() => setContinuous(!continuous)}>
                {continuous ? <Square size={18} /> : <Repeat size={18} />}
                {continuous ? "停止連續檢測" : "連續檢測"}
              </button>
              <select aria-label="連續檢測間隔" value={interval} disabled={continuous} onChange={(e) => setIntervalSec(+e.target.value)}>
                {INTERVALS.map((s) => (
                  <option key={s} value={s}>
                    每 {s} 秒
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bars opBars">
            {project.labels.map((l) => (
              <div className="bar" key={l}>
                <span className="barLabel">
                  {l}
                  <i className={"passDot " + (project.pass_labels.includes(l) ? "pass" : "fail")} />
                </span>
                <div className="barTrack">
                  <div className="barFill" style={{ width: `${Math.round((scores[l] ?? 0) * 100)}%`, background: classColor(project.labels, l) }} />
                </div>
                <span className="barValue">{overlay ? `${Math.round((scores[l] ?? 0) * 100)}%` : "—"}</span>
              </div>
            ))}
          </div>

          <div className="opStats">
            <div>
              <small>今日檢測</small>
              <strong>{stats?.today.total ?? 0}</strong>
            </div>
            <div className="PASS">
              <small>合格</small>
              <strong>{stats?.today.PASS ?? 0}</strong>
            </div>
            <div className="FAIL">
              <small>不合格</small>
              <strong>{stats?.today.FAIL ?? 0}</strong>
            </div>
            <div className="REVIEW">
              <small>需複判</small>
              <strong>{stats?.today.REVIEW ?? 0}</strong>
            </div>
            <div>
              <small>合格率</small>
              <strong>{passRate === null ? "—" : `${passRate}%`}</strong>
            </div>
          </div>
        </div>
      </main>

      <footer className="opRecent">
        <b>最近結果{stats?.today.pending_review ? ` · ${stats.today.pending_review} 筆待複判` : ""}</b>
        <div className="opRecentList">
          {stats?.recent.map((r) => (
            <button
              key={r.id}
              className={"opRecentItem " + r.result}
              title={r.result === "REVIEW" && !r.review ? "點擊進行人工複判" : r.review ? `已複判：${r.review.decision}` : ""}
              onClick={() => r.result === "REVIEW" && !r.review && setReviewing(r)}
            >
              <img src={`${base}/inspections/${r.id}/thumbnail`} alt="" loading="lazy" />
              <span>
                {r.review ? `✓ ${r.review.decision}` : r.result} · {new Date(r.created_at * 1000).toLocaleTimeString("zh-TW", { hour12: false })}
              </span>
            </button>
          ))}
          {!stats?.recent.length && <small>尚無檢測紀錄</small>}
        </div>
      </footer>

      {reviewing && (
        <ReviewDialog
          record={reviewing}
          base={base}
          isAudio={isAudio}
          onClose={() => setReviewing(null)}
          onSave={async (decision, note) => {
            await call(`/inspections/${reviewing.id}/review`, { method: "POST", body: JSON.stringify({ decision, note }) });
            setReviewing(null);
            refreshStats();
          }}
        />
      )}
    </div>
  );
}

function ReviewDialog({
  record,
  base,
  isAudio,
  onClose,
  onSave,
}: {
  record: Record_;
  base: string;
  isAudio: boolean;
  onClose: () => void;
  onSave: (decision: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(""),
    [error, setError] = useState("");
  const save = (decision: string) =>
    onSave(decision, note.trim() || (decision === "PASS" ? "人工確認合格" : "人工確認不合格")).catch((e) => setError(e.message));
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal opReview" role="dialog" aria-label="人工複判" onClick={(e) => e.stopPropagation()}>
        <h2>人工複判</h2>
        <img className="reviewImage" src={`${base}/inspections/${record.id}/thumbnail`} alt="待複判樣本" />
        {isAudio && <audio controls src={`${base}/inspections/${record.id}/content`} className="audioPlayer" />}
        <p className="muted">
          AI：{record.primary.label === "UNKNOWN" ? record.primary.reason || "無法判斷" : record.primary.label} {(record.primary.confidence * 100).toFixed(1)}%
        </p>
        <label>
          備註（選填）
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：刮痕位於右上角" />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="opReviewButtons">
          <button className="opPass" onClick={() => save("PASS")}>
            合格 PASS
          </button>
          <button className="opFail" onClick={() => save("FAIL")}>
            不合格 FAIL
          </button>
        </div>
        <button className="linkButton" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}
