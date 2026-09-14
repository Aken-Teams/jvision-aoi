"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Roi } from "../lib/api";

/** Browser webcam with device choice and frame grabbing, stopped on unmount. */
export function useWebcam() {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null);
  const [on, setOn] = useState(false),
    [streamVersion, setStreamVersion] = useState(0),
    [error, setError] = useState(""),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [deviceId, setDeviceId] = useState("");

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOn(false);
  }, []);

  const start = useCallback(
    async (id = deviceId) => {
      setError("");
      if (!navigator.mediaDevices) {
        setError("相機需要 HTTPS 或 localhost");
        return;
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({
          video: id ? { deviceId: { exact: id }, width: { ideal: 1280 } } : { width: { ideal: 1280 } },
        });
        // Bump the version so the <video> element is re-bound even when the camera was already on.
        setStreamVersion((v) => v + 1);
        setOn(true);
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter((d) => d.kind === "videoinput"));
      } catch (e) {
        setError(`無法開啟相機：${(e as Error).message}`);
        setOn(false);
      }
    },
    [deviceId],
  );

  useEffect(() => {
    const v = video.current;
    if (!on || !v) return;
    if (v.srcObject !== stream.current) v.srcObject = stream.current;
    v.play().catch(() => {});
  }, [on, streamVersion]);
  useEffect(() => stop, [stop]);

  const choose = (id: string) => {
    setDeviceId(id);
    if (on) start(id);
  };

  /** Current frame, cropped to roi when given, scaled so the longest side is at most maxSide (0 keeps native size). */
  const grab = useCallback(
    (
      maxSide = 0,
      type = "image/png",
      quality = 0.85,
      roi: Roi | null = null,
    ): Promise<{ blob: Blob; width: number; height: number } | null> => {
      const v = video.current;
      const track = stream.current?.getVideoTracks()[0];
      // Never save frames from a stopped or detached stream: they come out solid black.
      if (!v || !v.videoWidth || !track || track.readyState !== "live" || v.srcObject !== stream.current)
        return Promise.resolve(null);
      const r = roi || { x: 0, y: 0, w: 1, h: 1 };
      const sx = Math.round(r.x * v.videoWidth),
        sy = Math.round(r.y * v.videoHeight),
        sw = Math.max(1, Math.min(v.videoWidth - sx, Math.round(r.w * v.videoWidth))),
        sh = Math.max(1, Math.min(v.videoHeight - sy, Math.round(r.h * v.videoHeight)));
      const scale = maxSide ? Math.min(1, maxSide / Math.max(sw, sh)) : 1;
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(sw * scale));
      c.height = Math.max(1, Math.round(sh * scale));
      c.getContext("2d")!.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return new Promise((resolve) =>
        c.toBlob((b) => resolve(b ? { blob: b, width: c.width, height: c.height } : null), type, quality),
      );
    },
    [],
  );

  return { video, on, error, devices, deviceId, start, stop, choose, grab };
}

export function WebcamPicker({ cam }: { cam: ReturnType<typeof useWebcam> }) {
  if (cam.devices.length < 2) return null;
  return (
    <select aria-label="選擇相機" value={cam.deviceId} onChange={(e) => cam.choose(e.target.value)}>
      <option value="">預設相機</option>
      {cam.devices.map((d, i) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || `相機 ${i + 1}`}
        </option>
      ))}
    </select>
  );
}
