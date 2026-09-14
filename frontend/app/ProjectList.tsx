"use client";
import { useCallback, useEffect, useState } from "react";
import { AudioLines, ChevronDown, ChevronRight, MoreVertical, PersonStanding, Pencil, RotateCcw, ScanLine, SquareDashed, Trash2 } from "lucide-react";
import { api } from "./lib/api";
import type { Project } from "./lib/api";

const TASKS: Record<string, { name: string; icon: typeof ScanLine }> = {
  classification: { name: "影像分類", icon: ScanLine },
  detection: { name: "物件偵測", icon: SquareDashed },
  audio: { name: "音訊", icon: AudioLines },
  pose: { name: "姿勢", icon: PersonStanding },
};

/** Workspace project cards with rename and delete, plus the restorable trash. */
export default function ProjectList({
  projects,
  busy,
  run,
  reload,
  notify,
  onOpen,
}: {
  projects: Project[];
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  reload: () => Promise<void>;
  notify: (message: string) => void;
  onOpen: (id: string) => void;
}) {
  const [trash, setTrash] = useState<(Project & { deleted_at?: number })[]>([]),
    [showTrash, setShowTrash] = useState(false);
  const loadTrash = useCallback(() => api<(Project & { deleted_at?: number })[]>("/projects/trash").then(setTrash, () => {}), []);
  useEffect(() => {
    loadTrash();
  }, [loadTrash, projects.length]);

  return (
    <>
      <div className="projectGrid">
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            busy={busy}
            onOpen={() => onOpen(p.id)}
            onRename={(name) =>
              run(async () => {
                await api(`/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
                await reload();
              })
            }
            onDelete={() => {
              if (!confirm(`刪除專案「${p.name}」？\n\n專案會移到「已刪除專案」，其檢測 App 網址會暫停使用。影像、模型與檢測履歷都會保留，可隨時還原。`)) return;
              run(async () => {
                await api(`/projects/${p.id}`, { method: "DELETE" });
                await reload();
                await loadTrash();
                notify(`已刪除「${p.name}」，可在下方「已刪除專案」還原`);
              });
            }}
          />
        ))}
      </div>

      {trash.length > 0 && (
        <section className="trash">
          <button className="trashToggle" onClick={() => setShowTrash(!showTrash)} aria-expanded={showTrash}>
            {showTrash ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            已刪除專案（{trash.length}）
          </button>
          {showTrash && (
            <div className="trashList">
              {trash.map((p) => (
                <div className="trashItem" key={p.id}>
                  <div>
                    <b>{p.name}</b>
                    <small>
                      {TASKS[p.task]?.name || p.task}
                      {p.deleted_at ? ` · 刪除於 ${new Date(p.deleted_at * 1000).toLocaleString("zh-TW")}` : ""}
                    </small>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(`/projects/${p.id}/restore`, { method: "POST" });
                        await reload();
                        await loadTrash();
                        notify(`已還原「${p.name}」`);
                      })
                    }
                  >
                    <RotateCcw size={15} />
                    還原
                  </button>
                </div>
              ))}
              <small className="muted">已刪除的專案保留所有資料以供追溯；還原後部署與檢測 App 立即恢復。</small>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ProjectCard({
  project: p,
  busy,
  onOpen,
  onRename,
  onDelete,
}: {
  project: Project;
  busy: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(p.name);
  const task = TASKS[p.task] || TASKS.classification;
  const finish = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== p.name) onRename(name);
    else setDraft(p.name);
  };

  return (
    <div className="projectCard" role="group" aria-label={p.name}>
      <div className="projectCardTop">
        <div className="projectIcon">
          <task.icon size={30} />
        </div>
        <div className="menuWrap">
          <button className="iconButton" aria-label={`${p.name} 選項`} disabled={busy} onClick={() => setMenu(!menu)}>
            <MoreVertical size={18} />
          </button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button
                onClick={() => {
                  setMenu(false);
                  setDraft(p.name);
                  setEditing(true);
                }}
              >
                <Pencil size={15} />
                改名
              </button>
              <button
                className="dangerItem"
                onClick={() => {
                  setMenu(false);
                  onDelete();
                }}
              >
                <Trash2 size={15} />
                刪除
              </button>
            </div>
          )}
        </div>
      </div>
      <span className="badge">{task.name}</span>
      {editing ? (
        <input
          autoFocus
          className="projectNameInput"
          aria-label="專案名稱"
          maxLength={120}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(p.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <h2>
          <button className="projectOpen" onClick={onOpen}>
            {p.name}
          </button>
        </h2>
      )}
      <p>{p.labels.join(" / ")}</p>
      <button className="projectFooter" onClick={onOpen} disabled={editing}>
        {p.synthetic ? "合成資料 · 僅供流程驗證" : "自訂檢測專案"}
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
