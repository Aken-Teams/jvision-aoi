"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, KeyRound, Plus, Rocket, Trash2 } from "lucide-react";
import { api, modelVersion } from "../lib/api";
import type { Ctx } from "../lib/api";

type InspectApp = { id: string; name: string; slug: string; url: string; alert_sound: boolean; created_at: number };

const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});

/** Standalone operator apps for this project: create, share the address, rotate access codes, disable. */
export default function AppsPanel({ ctx }: { ctx: Ctx }) {
  const { pid, data, busy, run, reload, notify } = ctx;
  const deployment = data.deployment.find((d) => d.id === data.project.active_deployment);
  const latest = data.model[data.model.length - 1];
  const deployedVersion = deployment ? modelVersion(data.model, deployment.model_id) : 0;
  const outdated = !!latest && latest.id !== deployment?.model_id;
  const [apps, setApps] = useState<InspectApp[]>([]),
    [name, setName] = useState(""),
    [slug, setSlug] = useState(""),
    [shown, setShown] = useState<{ app: InspectApp; code: string } | null>(null);

  const load = useCallback(() => api<InspectApp[]>(`/projects/${pid}/apps`).then(setApps), [pid]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  // Absolute runtime URL when RUNTIME_PUBLIC_URL is configured; the Studio host always serves /inspect/<slug>.
  const addresses = (a: InspectApp) => {
    const studio = `${location.origin}/inspect/${encodeURIComponent(a.slug)}`;
    return a.url.startsWith("http") ? [a.url, studio] : [studio];
  };

  return (
    <div className="twoCols">
      <section className="panel">
        <h2>建立檢測 App</h2>
        <p className="muted">給產線操作員使用的獨立畫面：只能檢測與複判，不能訓練或修改專案。App 永遠使用此專案「目前部署」的模型與門檻。</p>
        <div className={"callout" + (deployment ? "" : " warnCallout")}>
          <span>
            {deployment
              ? `目前部署：V${deployedVersion} · 門檻 ${deployment.threshold}` + (outdated ? `；有較新的 V${data.model.length}` : "")
              : latest
                ? "此專案尚未部署模型，App 要部署後才能檢測。"
                : "此專案還沒有訓練好的模型，請先在建模畫面訓練。"}
          </span>
          {outdated && (
            <button
              className={deployment ? "" : "primary"}
              disabled={busy}
              onClick={() => {
                if (deployment && !confirm(`將 V${data.model.length} 部署為目前模型？所有檢測 App 會在 30 秒內改用新模型，門檻沿用 ${deployment.threshold}。`)) return;
                run(async () => {
                  await api(`/projects/${pid}/deploy`, {
                    method: "POST",
                    body: JSON.stringify({ model_id: latest.id, threshold: deployment?.threshold ?? 0.85 }),
                  });
                  await reload();
                  notify(`已部署 V${data.model.length}，檢測 App 可以開始檢測`);
                });
              }}
            >
              <Rocket size={15} />
              部署最新模型 V{data.model.length}
            </button>
          )}
        </div>
        <label>
          App 名稱
          <input
            value={name}
            maxLength={80}
            placeholder="例如：產線 A 外觀檢測"
            onChange={(e) => {
              setName(e.target.value);
              if (!slug || slug === name.replace(/\s+/g, "")) setSlug(e.target.value.replace(/\s+/g, "").slice(0, 40));
            }}
          />
        </label>
        <label>
          網址名稱
          <input value={slug} maxLength={40} placeholder="例如：產線A 或 line-a" onChange={(e) => setSlug(e.target.value.replace(/[^\p{L}\p{N}_-]/gu, ""))} />
        </label>
        <button
          className="primary full"
          disabled={busy || !name.trim() || !slug}
          onClick={() =>
            run(async () => {
              const r = await api<InspectApp & { access_code: string }>(`/projects/${pid}/apps`, {
                method: "POST",
                body: JSON.stringify({ name, slug }),
              });
              setShown({ app: r, code: r.access_code });
              setName("");
              setSlug("");
              await load();
            })
          }
        >
          <Plus size={16} />
          建立 App 並產生存取碼
        </button>
      </section>

      <section className="panel">
        <h2>此專案的檢測 App</h2>
        {!apps.length && <div className="empty">尚未建立檢測 App</div>}
        {apps.map((a) => (
          <article className="job appRow" key={a.id}>
            <div className="sectionTitle">
              <b>{a.name}</b>
              <span className="badge">{deployment ? "使用目前部署" : "尚未部署"}</span>
            </div>
            {addresses(a).map((url, i) => (
              <div className="appUrl" key={url}>
                <small>{i === 0 && addresses(a).length > 1 ? "獨立網址" : "Studio 網址"}</small>
                <code>{url}</code>
                <button className="iconButton" aria-label="複製網址" onClick={() => (copy(url), notify("已複製網址"))}>
                  <Copy size={15} />
                </button>
                <a className="iconButton" href={url} target="_blank" rel="noreferrer" aria-label="開啟">
                  <ExternalLink size={15} />
                </a>
              </div>
            ))}
            <div className="row">
              <button
                disabled={busy}
                onClick={() => {
                  if (!confirm(`重新產生「${a.name}」的存取碼？使用中的檢測站會被登出。`)) return;
                  run(async () => {
                    const r = await api<InspectApp & { access_code: string }>(`/apps/${a.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ regenerate_code: true }),
                    });
                    setShown({ app: r, code: r.access_code });
                  });
                }}
              >
                <KeyRound size={15} />
                重新產生存取碼
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (!confirm(`停用「${a.name}」？網址將無法使用，檢測履歷會保留。`)) return;
                  run(async () => {
                    await api(`/apps/${a.id}`, { method: "DELETE" });
                    await load();
                    notify("已停用檢測 App");
                  });
                }}
              >
                <Trash2 size={15} />
                停用
              </button>
            </div>
          </article>
        ))}
      </section>

      {shown && (
        <div className="overlay">
          <div className="modal" role="dialog" aria-label="存取碼">
            <h2>{shown.app.name} 的存取碼</h2>
            <p className="muted">存取碼只會顯示這一次，請交給操作員或記錄在安全的地方。忘記時可以重新產生。</p>
            <div className="accessCode">{shown.code.replace(/(\d{4})(\d{4})/, "$1 $2")}</div>
            {addresses(shown.app).map((url) => (
              <div className="appUrl" key={url}>
                <code>{url}</code>
                <button className="iconButton" aria-label="複製網址" onClick={() => copy(url)}>
                  <Copy size={15} />
                </button>
              </div>
            ))}
            <div className="row">
              <button onClick={() => copy(shown.code)}>
                <Copy size={15} />
                複製存取碼
              </button>
              <button className="primary" onClick={() => setShown(null)}>
                我已記下
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
