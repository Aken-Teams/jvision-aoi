"use client";
import { useState } from "react";
import { Clapperboard } from "lucide-react";
import { newGroup } from "../lib/api";
import type { Roi } from "../lib/api";
import type { useWebcam } from "./useWebcam";

export const SEQUENCE_FRAMES = 8;
const FRAME_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Grabs SEQUENCE_FRAMES consecutive frames (about 1.2 s) as JPEG blobs, cropped to the ROI. */
export async function captureSequence(cam: ReturnType<typeof useWebcam>, roi: Roi | null, maxSide = 640) {
  const frames: Blob[] = [];
  for (let i = 0; i < SEQUENCE_FRAMES; i++) {
    const started = performance.now();
    const frame = await cam.grab(maxSide, "image/jpeg", 0.9, roi);
    if (!frame) throw Error("相機畫面尚未就緒");
    frames.push(frame.blob);
    await sleep(Math.max(0, FRAME_MS - (performance.now() - started)));
  }
  return frames;
}

/** Records one or more short action takes after a countdown; all takes in one session share a group. */
export default function SequenceRecorder({
  cam,
  roi,
  onSample,
  onDone,
}: {
  cam: ReturnType<typeof useWebcam>;
  roi: Roi | null;
  onSample: (frames: Blob[], group: string) => Promise<void>;
  onDone: () => void;
}) {
  const [takes, setTakes] = useState(3),
    [status, setStatus] = useState(""),
    [running, setRunning] = useState(false);

  const record = async () => {
    setRunning(true);
    const group = newGroup();
    try {
      for (let t = 1; t <= takes; t++) {
        for (let c = 3; c > 0; c--) {
          setStatus(`第 ${t} / ${takes} 次 · ${c}…`);
          await sleep(t === 1 ? 1000 : 400);
        }
        setStatus(`第 ${t} / ${takes} 次 · 錄製中`);
        const frames = await captureSequence(cam, roi);
        void onSample(frames, group);
      }
      setStatus("");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setRunning(false);
      onDone();
    }
  };

  return (
    <div className="sequenceRecorder">
      <div className="row">
        <label>
          連續錄製
          <select value={takes} disabled={running} onChange={(e) => setTakes(+e.target.value)}>
            {[1, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n} 次
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className={"primary full" + (running ? " recordingButton" : "")} disabled={!cam.on || running} onClick={record}>
        <Clapperboard size={16} />
        {running ? status : "錄製動作"}
      </button>
      <small>倒數 3 秒後錄製約 1.2 秒（{SEQUENCE_FRAMES} 張）為一個動作樣本。每次錄製前重新做一次完整動作。</small>
    </div>
  );
}
