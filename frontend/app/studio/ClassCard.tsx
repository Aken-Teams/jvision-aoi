"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, Lock, MoreVertical, Pencil, Upload, Video, X } from "lucide-react";
import { api, captureNetworkCamera, classColor, groupCount, MIN_GROUPS, newGroup, uploadImage } from "../lib/api";
import type { Camera as NetCamera, Ctx, Pic } from "../lib/api";
import { useWebcam, WebcamPicker } from "./useWebcam";
import AutoCapture from "./AutoCapture";

const BURST_MS = 200;

export default function ClassCard({
  ctx,
  label,
  cameras,
  webcamOpen,
  onWebcam,
  onAnnotate,
  onAdvanced,
}: {
  ctx: Ctx;
  label: string;
  cameras: NetCamera[];
  webcamOpen: boolean;
  onWebcam: (open: boolean) => void;
  onAnnotate: (pic: Pic) => void;
  onAdvanced: (tab: string) => void;
}) {
  const { pid, data, run, reload, notify } = ctx;
  const p = data.project;
  const images = data.image.filter((x) => x.label === label);
  const groups = groupCount(images);
  const color = classColor(p.labels, label);
  const locked = label === "OK";

  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(label),
    [menu, setMenu] = useState(false),
    [source, setSource] = useState<"" | "upload" | "network">(""),
    [cid, setCid] = useState(""),
    [recording, setRecording] = useState(false),
    [pending, setPending] = useState(0),
    [error, setError] = useState("");
  const cam = useWebcam();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null),
    queue = useRef<Promise<void>>(Promise.resolve()),
    stats = useRef({ saved: 0, skipped: 0 });

  // Uploads run one at a time so a long burst never floods the API.
  const enqueue = (blob: Blob, group: string) => {
    setPending((n) => n + 1);
    queue.current = queue.current
      .then(() => uploadImage(pid, blob, label, group))
      .then(
        () => void stats.current.saved++,
        (e: Error & { status?: number }) => {
          if (e.status === 409) stats.current.skipped++;
          else setError(e.message);
        },
      )
      .finally(() => setPending((n) => n - 1));
    return queue.current;
  };
  const finish = async () => {
    await queue.current;
    const { saved, skipped } = stats.current;
    stats.current = { saved: 0, skipped: 0 };
    await reload();
    if (saved || skipped) notify(`「${label}」新增 ${saved} 張${skipped ? `，略過 ${skipped} 張重複影像` : ""}`);
  };

  const startBurst = () => {
    if (!cam.on || timer.current) return;
    const group = newGroup();
    setRecording(true);
    const shoot = () =>
      cam.grab(1280).then((frame) => {
        if (frame) enqueue(frame.blob, group);
      });
    shoot();
    timer.current = setInterval(shoot, BURST_MS);
  };
  const stopBurst = () => {
    if (!timer.current) return;
    clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
    // Let the last in-flight frame grab enqueue before waiting on the queue.
    setTimeout(finish, BURST_MS);
  };

  const uploadFiles = (files: FileList | File[]) => {
    setError("");
    // Each file is its own independent unit for the train/val/test split.
    Array.from(files).forEach((f) => enqueue(f, ""));
    finish();
  };

  const rename = () =>
    run(async () => {
      setEditing(false);
      const name = draft.trim();
      if (!name || name === label) return setDraft(label);
      await api(`/projects/${pid}/classes/${encodeURIComponent(label)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await reload();
    });

  const toggleWebcam = () => {
    if (webcamOpen) {
      cam.stop();
      onWebcam(false);
    } else {
      setSource("");
      onWebcam(true);
      cam.start();
    }
  };
  const { stop } = cam;
  useEffect(() => {
    if (!webcamOpen) stop();
  }, [webcamOpen, stop]);

  return (
    <section className="classCard" style={{ "--class": color } as React.CSSProperties}>
      <div className="classHead">
        <span className="classDot" />
        {editing ? (
          <input
            autoFocus
            aria-label="類別名稱"
            value={draft}
            maxLength={60}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(label);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className="className"
            disabled={locked}
            title={locked ? "OK 為判定基準類別，不可改名" : "點擊改名"}
            onClick={() => {
              setDraft(label);
              setEditing(true);
            }}
          >
            {label}
            {locked ? <Lock size={14} /> : <Pencil size={14} />}
          </button>
        )}
        <div className="menuWrap">
          <button className="iconButton" aria-label={`${label} 選項`} onClick={() => setMenu(!menu)}>
            <MoreVertical size={18} />
          </button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button
                disabled={!images.length}
                onClick={() => {
                  setMenu(false);
                  if (!confirm(`移除「${label}」的 ${images.length} 張樣本？已訓練的模型版本不受影響。`)) return;
                  run(async () => {
                    for (const im of images) await api(`/images/${im.id}`, { method: "DELETE" });
                    await reload();
                  });
                }}
              >
                清除所有樣本
              </button>
              <button
                disabled={locked || p.labels.length <= 2}
                onClick={() => {
                  setMenu(false);
                  if (images.length && !confirm(`刪除類別「${label}」及其 ${images.length} 張樣本？`)) return;
                  run(async () => {
                    await api(
                      `/projects/${pid}/classes/${encodeURIComponent(label)}${images.length ? "?with_images=true" : ""}`,
                      { method: "DELETE" },
                    );
                    await reload();
                  });
                }}
              >
                刪除類別
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="classBody">
      <p className="classCount">
        {images.length ? (
          <>
            {images.length} 個圖片樣本 ·{" "}
            <span className={groups < MIN_GROUPS ? "groupShort" : "groupDone"} title="同一次錄製算一組；每類建議至少 5 組">
              {groups < MIN_GROUPS ? `${groups} / ${MIN_GROUPS} 組` : `${groups} 組`}
            </span>
          </>
        ) : pending ? (
          ""
        ) : (
          "新增圖片樣本："
        )}
        {pending > 0 && `${images.length ? " · " : ""}上傳中 ${pending}`}
      </p>

      {webcamOpen ? (
        <div className="capturePane">
          <div className="paneHead">
            <b>網路攝影機</b>
            <button className="iconButton" aria-label="關閉網路攝影機" onClick={toggleWebcam}>
              <X size={16} />
            </button>
          </div>
          {cam.error && <div className="error">{cam.error}</div>}
          <video ref={cam.video} autoPlay playsInline muted className={recording ? "recording" : ""} />
          <WebcamPicker cam={cam} />
          <button
            className="primary full holdButton"
            disabled={!cam.on}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              startBurst();
            }}
            onPointerUp={stopBurst}
            onPointerCancel={stopBurst}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                startBurst();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") stopBurst();
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {recording ? "錄製中…" : "按住錄製"}
          </button>
          <small>
            每秒約 5 張。放開再按一次＝新的一組；建議換角度、位置或換一個工件，分 {MIN_GROUPS} 次以上錄製
            {groups < MIN_GROUPS ? `（目前 ${groups} / ${MIN_GROUPS} 組）` : ""}。
          </small>
          <AutoCapture
            key="webcam"
            grab={async () => (await cam.grab(1280))?.blob ?? null}
            save={(blob, group) => enqueue(blob, group)}
            minInterval={0.2}
            defaultInterval={1}
            disabled={!cam.on || recording}
            onDone={finish}
          />
        </div>
      ) : source === "upload" ? (
        <div className="capturePane">
          <div className="paneHead">
            <b>上傳影像</b>
            <button className="iconButton" aria-label="關閉上傳" onClick={() => setSource("")}>
              <X size={16} />
            </button>
          </div>
          <label
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              uploadFiles(e.dataTransfer.files);
            }}
          >
            <Upload size={24} />
            <b>拖曳影像至此，或點擊選取</b>
            <span>PNG / JPG · 單張上限 20 MB · 可多選</span>
            <input
              aria-label={`上傳 ${label} 影像`}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                if (e.target.files) uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      ) : source === "network" ? (
        <div className="capturePane">
          <div className="paneHead">
            <b>IP 相機</b>
            <button className="iconButton" aria-label="關閉 IP 相機" onClick={() => setSource("")}>
              <X size={16} />
            </button>
          </div>
          {cameras.length ? (
            <>
              <select aria-label="選擇網路相機" value={cid} onChange={(e) => setCid(e.target.value)}>
                <option value="">請選擇相機</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                className="full"
                disabled={!cid || pending > 0}
                onClick={() => {
                  setError("");
                  captureNetworkCamera(cid).then(
                    (f) => {
                      enqueue(f, "");
                      finish();
                    },
                    (e) => setError(e.message),
                  );
                }}
              >
                擷取一張
              </button>
              <AutoCapture
                key={`network-${cid}`}
                grab={() => captureNetworkCamera(cid)}
                save={(blob, group) => enqueue(blob, group)}
                minInterval={1}
                defaultInterval={3}
                disabled={!cid}
                onDone={finish}
              />
            </>
          ) : (
            <div className="callout">
              尚未設定 RTSP / HTTP IP 相機。
              <button className="linkButton" onClick={() => onAdvanced("measure")}>
                前往「量測與相機」新增相機
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="sourceButtons">
          <button onClick={toggleWebcam}>
            <Video size={22} />
            網路攝影機
          </button>
          <button onClick={() => setSource("upload")}>
            <Upload size={22} />
            上傳
          </button>
          <button onClick={() => setSource("network")}>
            <Camera size={22} />
            IP 相機
          </button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="關閉">
            <X size={14} />
          </button>
        </div>
      )}

      {images.length > 0 && (
        <div className="samples">
          {[...images].reverse().map((im) => (
            <div className="sample" key={im.id}>
              <button
                className="sampleImage"
                title={p.task === "detection" ? "開啟框選" : im.group ? `批次 ${im.group}` : "獨立樣本"}
                onClick={() => p.task === "detection" && onAnnotate(im)}
              >
                <img src={`/api/v1/images/${im.id}/content`} alt={`${label} 樣本`} loading="lazy" />
                {!im.reviewed && <span className="pendingTag">待框選</span>}
                {p.task === "detection" && im.reviewed && im.boxes.length > 0 && (
                  <span className="boxTag">
                    <Check size={10} />
                    {im.boxes.length}
                  </span>
                )}
              </button>
              <button
                className="sampleDelete"
                aria-label="刪除樣本"
                onClick={() =>
                  run(async () => {
                    await api(`/images/${im.id}`, { method: "DELETE" });
                    await reload();
                  })
                }
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}
