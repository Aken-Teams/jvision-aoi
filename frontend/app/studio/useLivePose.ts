"use client";
import { useEffect, useState } from "react";
import type { Roi } from "../lib/api";
import type { useWebcam } from "./useWebcam";

const MIN_INTERVAL_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Live keypoints for the webcam while collecting pose samples (no trained model needed).
 * Frames are cropped to the ROI, so keypoints are normalized to the ROI region like saved samples.
 */
export function useLivePose(pid: string, cam: ReturnType<typeof useWebcam>, roi: Roi | null, enabled: boolean) {
  const [keypoints, setKeypoints] = useState<number[][] | null>(null),
    [status, setStatus] = useState<"idle" | "found" | "none" | "error">("idle"),
    [message, setMessage] = useState("");
  const { grab, on } = cam;
  const roiKey = JSON.stringify(roi);

  useEffect(() => {
    if (!enabled || !on) {
      setKeypoints(null);
      setStatus("idle");
      return;
    }
    let alive = true;
    (async () => {
      while (alive) {
        const started = performance.now();
        if (document.visibilityState === "visible") {
          const frame = await grab(640, "image/jpeg", 0.8, roi);
          if (frame && alive) {
            try {
              const form = new FormData();
              form.append("file", frame.blob, "frame.jpg");
              const r = await fetch(`/api/v1/projects/${pid}/pose/detect`, { method: "POST", body: form });
              const body = await r.json().catch(() => ({}));
              if (!alive) break;
              if (!r.ok) {
                setStatus("error");
                setMessage(typeof body.detail === "string" ? body.detail : `HTTP ${r.status}`);
                await sleep(2000);
              } else {
                setKeypoints(body.keypoints);
                setStatus(body.keypoints ? "found" : "none");
              }
            } catch {
              if (alive) setStatus("error");
              await sleep(2000);
            }
          }
        }
        await sleep(Math.max(0, MIN_INTERVAL_MS - (performance.now() - started)));
      }
    })();
    return () => {
      alive = false;
    };
    // roi is tracked through roiKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, enabled, on, grab, roiKey]);

  return { keypoints, status, message };
}
