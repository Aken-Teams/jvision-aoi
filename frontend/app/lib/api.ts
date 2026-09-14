export type Box = { label: string; x: number; y: number; w: number; h: number };
/** Normalized crop region applied to camera frames before upload and inference. */
export type Roi = { x: number; y: number; w: number; h: number };
export type Project = {
  id: string;
  name: string;
  task: string;
  labels: string[];
  active_deployment?: string;
  synthetic?: boolean;
  adapter?: string;
  roi?: Roi | null;
  pass_labels?: string[] | null;
  pose_mode?: "static" | "sequence" | null;
};
export type Pic = {
  id: string;
  media?: "image" | "audio" | "pose" | "pose-sequence";
  keypoints?: number[][] | number[][][];
  label: string;
  group: string;
  sha256: string;
  reviewed: boolean;
  boxes: Box[];
  width: number;
  height: number;
};
export type Point = {
  epoch: number;
  loss?: number;
  val_loss?: number;
  acc?: number;
  val_acc?: number;
  map50?: number;
};
export type Job = {
  id: string;
  name: string;
  adapter: string;
  status: string;
  progress: number;
  logs: string[];
  history?: Point[];
  warnings?: string[];
  model_id?: string;
  error?: string;
};
export type SplitMetrics = {
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  labels?: string[];
  confusion_matrix?: number[][];
  [key: string]: unknown;
};
export type Model = {
  id: string;
  name: string;
  adapter: string;
  metrics: { validation?: SplitMetrics; test?: SplitMetrics; [key: string]: unknown };
  counts: Record<string, number>;
  history?: Point[];
  warnings?: string[];
  created_at: number;
};
export type Deployment = {
  id: string;
  model_id: string;
  threshold: number;
  name: string;
  vlm_enabled: boolean;
};
export type Primary = {
  label: string;
  confidence: number;
  scores?: Record<string, number>;
  boxes?: { xyxy: number[]; label: string; confidence: number }[];
  reason?: string;
  keypoints?: number[][];
};
export type Inspection = {
  id: string;
  result: string;
  latency_ms: number;
  model_id: string;
  primary: Primary;
  secondary?: { reason: string };
  review?: { decision: string; note: string; user_name?: string };
  app_name?: string;
  created_at: number;
};
export type Overview = {
  project: Project;
  image: Pic[];
  job: Job[];
  model: Model[];
  deployment: Deployment[];
  inspection: Inspection[];
};
export type Camera = { id: string; name: string; protocol: string; host: string };

/** Shared page state handed to every studio / advanced panel. */
export type Ctx = {
  pid: string;
  data: Overview;
  busy: boolean;
  reload: () => Promise<void>;
  run: (fn: () => Promise<void>) => Promise<void>;
  notify: (message: string) => void;
};

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch("/api/v1" + path, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  if (!r.ok) {
    // A gateway error without a JSON body means the proxy could not reach the API (e.g. during a restart).
    let msg = [502, 503, 504].includes(r.status) ? `伺服器暫時無法連線（HTTP ${r.status}），可能正在重新啟動，請稍後再試` : `HTTP ${r.status}`;
    try {
      const b = await r.json();
      msg = typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail);
    } catch {}
    const e = Error(msg) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return r.json();
}

/** One pose-sequence sample: consecutive frames uploaded together as repeated "file" parts. */
export function uploadFrames(pid: string, frames: Blob[], label: string, group = "") {
  const form = new FormData();
  frames.forEach((f, i) => form.append("file", f, `frame-${i}.jpg`));
  form.append("label", label);
  form.append("group", group);
  return api<Pic>(`/projects/${pid}/images`, { method: "POST", body: form });
}

export function uploadImage(pid: string, file: Blob, label: string, group = "") {
  const form = new FormData();
  form.append("file", file, file.type === "image/jpeg" ? "sample.jpg" : file.type === "audio/wav" ? "sample.wav" : "sample.png");
  form.append("label", label);
  form.append("group", group);
  return api<Pic>(`/projects/${pid}/images`, { method: "POST", body: form });
}

// Categorical slots in fixed order; a class past the eighth folds to neutral gray.
const SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
export const classColor = (labels: string[], label: string) => {
  const i = labels.indexOf(label);
  return i >= 0 && i < SLOTS.length ? SLOTS[i] : "#8a9a9f";
};

export const adapterName: Record<string, string> = {
  transfer: "標準影像",
  baseline: "輕量影像",
  audio: "音訊 CNN",
  pose: "姿勢 MLP",
  cnn: "CNN",
  yolo: "YOLO",
};

export const modelVersion = (models: Model[], id: string) => models.findIndex((m) => m.id === id) + 1;

export const MIN_GROUPS = 5;
export const groupCount = (images: Pic[]) => new Set(images.map((x) => x.group || x.sha256)).size;

/**
 * Mirrors backend split_snapshot. Blocking issues: fewer than 5 images in a class or unconfirmed samples.
 * Warnings: enough images but fewer than 5 capture groups, so the split falls back to per-image.
 */
export function readiness(project: Project, images: Pic[]) {
  const issues: string[] = [],
    warnings: string[] = [];
  for (const label of project.labels) {
    const own = images.filter((x) => x.label === label);
    const groups = groupCount(own);
    if (own.length < MIN_GROUPS) issues.push(`「${label}」還需要 ${MIN_GROUPS - own.length} 張樣本`);
    else if (groups < MIN_GROUPS)
      warnings.push(`「${label}」只有 ${groups} 組錄製，測試準確率可能偏高；建議分 ${MIN_GROUPS} 次以上錄製`);
  }
  const pending = images.filter((x) => !x.reviewed).length;
  if (pending) issues.push(`${pending} 張影像待框選確認`);
  return { issues, warnings };
}

// crypto.randomUUID is missing on plain-HTTP LAN origins, so fall back to random hex.
export const newGroup = () =>
  "burst-" +
  (globalThis.crypto?.randomUUID?.() ?? Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join(""));

export async function captureNetworkCamera(cid: string) {
  const r = await fetch(`/api/v1/cameras/${cid}/capture`, { method: "POST" });
  if (!r.ok) {
    let msg = "相機擷取失敗";
    try {
      const b = await r.json();
      if (typeof b.detail === "string") msg = b.detail;
    } catch {}
    throw Error(msg);
  }
  return new File([await r.blob()], "network-camera.png", { type: "image/png" });
}

/** Crops an image file to the project ROI in the browser; returns the input unchanged without an ROI. */
export async function cropImage(file: Blob, roi: Roi | null | undefined, type = "image/jpeg", quality = 0.95): Promise<Blob> {
  if (!roi) return file;
  const bitmap = await createImageBitmap(file);
  const sx = Math.round(roi.x * bitmap.width),
    sy = Math.round(roi.y * bitmap.height),
    sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(roi.w * bitmap.width))),
    sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(roi.h * bitmap.height)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(Error("ROI 裁切失敗"))), type, quality),
  );
}
