"use client";
import { useEffect, useState } from "react";
type Camera = { id: string; name: string; protocol: string; host: string };
export default function NetworkCamera({
  pid,
  labels,
  onCapture,
}: {
  pid: string;
  labels: string[];
  onCapture: (file: File) => void;
}) {
  const [cameras, setCameras] = useState<Camera[]>([]),
    [cid, setCid] = useState(""),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [shot, setShot] = useState<File | null>(null),
    [label, setLabel] = useState("OK");
  async function request(path: string, options: RequestInit = {}) {
    const r = await fetch("/api/v1" + path, options);
    if (!r.ok) {
      let message = "操作失敗";
      try {
        const b = await r.json();
        message = typeof b.detail === "string" ? b.detail : "請檢查輸入資料";
      } catch {}
      throw Error(message);
    }
    return r;
  }
  async function reload() {
    const r = await request(`/projects/${pid}/cameras`);
    setCameras(await r.json());
  }
  async function run(fn: () => Promise<void>) {
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
  }
  useEffect(() => {
    let active = true;
    request(`/projects/${pid}/cameras`)
      .then((r) => r.json())
      .then((data) => {
        if (active) setCameras(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [pid]);
  return (
    <details className="networkCamera">
      <summary>網路攝影機 · RTSP / HTTP 快照</summary>
      <p className="muted">由廠內伺服器擷取單張影像，載入後按「執行檢測」。</p>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="success">
          {notice}
        </div>
      )}
      <label>
        已設定相機
        <select
          value={cid}
          onChange={(e) => {
            setCid(e.target.value);
            setShot(null);
          }}
        >
          <option value="">請選擇相機</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.protocol} · {c.host}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button
          disabled={busy || !cid}
          onClick={() =>
            run(async () => {
              const r = await request(`/cameras/${cid}/capture`, {
                method: "POST",
              });
              const file = new File([await r.blob()], "network-camera.png", {
                type: "image/png",
              });
              setShot(file);
              onCapture(file);
              setNotice("已擷取，請查看下方影像並執行檢測");
            })
          }
        >
          擷取相機畫面
        </button>
        <button
          disabled={busy || !cid}
          onClick={() =>
            run(async () => {
              await request(`/cameras/${cid}`, { method: "DELETE" });
              setCid("");
              setShot(null);
              await reload();
            })
          }
        >
          停用此相機
        </button>
      </div>
      {shot && (
        <div className="row">
          <label>
            存入類別
            <select value={label} onChange={(e) => setLabel(e.target.value)}>
              {labels.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const f = new FormData();
                f.append("file", shot);
                f.append("label", label);
                await request(`/projects/${pid}/images`, {
                  method: "POST",
                  body: f,
                });
                setNotice("已存入資料集；偵測專案仍須完成框選標註");
              })
            }
          >
            將擷取影像加入資料集
          </button>
        </div>
      )}
      <details>
        <summary>新增相機</summary>
        <label>
          相機名稱
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="產線 A · 相機 01"
          />
        </label>
        <label>
          RTSP 串流或 HTTP 快照網址
          <input
            type="password"
            autoComplete="new-password"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="rtsp://帳號:密碼@192.168.1.50:554/串流路徑"
          />
        </label>
        <small>
          相機 IP 必須先由管理員加入允許清單。網址與帳密加密儲存，不回傳瀏覽器。
        </small>
        <button
          className="full"
          disabled={busy || !name.trim() || !url}
          onClick={() =>
            run(async () => {
              const r = await request(`/projects/${pid}/cameras`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, url }),
              });
              const c = await r.json();
              setCid(c.id);
              setShot(null);
              setUrl("");
              setName("");
              await reload();
              setNotice("相機設定已保存，請擷取畫面測試");
            })
          }
        >
          儲存相機設定
        </button>
      </details>
    </details>
  );
}
