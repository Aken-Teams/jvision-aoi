"use client";

// COCO-17 limb pairs, matching backend app/pose.py. Face keypoints are drawn as dots only.
const LIMBS = [[5, 7], [7, 9], [6, 8], [8, 10], [5, 6], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
const MIN_CONF = 0.3;

/** Skeleton drawn over a frame; keypoints are [x, y, conf] normalized to that frame. */
export default function Skeleton({ keypoints }: { keypoints?: number[][] }) {
  if (!keypoints?.length) return null;
  const ok = (i: number) => (keypoints[i]?.[2] ?? 0) >= MIN_CONF;
  return (
    <div className="skeleton" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {LIMBS.filter(([a, b]) => ok(a) && ok(b)).map(([a, b]) => (
          <line key={`${a}-${b}`} x1={keypoints[a][0] * 100} y1={keypoints[a][1] * 100} x2={keypoints[b][0] * 100} y2={keypoints[b][1] * 100} />
        ))}
      </svg>
      {/* Dots are HTML so they stay round when the frame is not square. */}
      {keypoints.map((k, i) => ok(i) && <i key={i} style={{ left: `${k[0] * 100}%`, top: `${k[1] * 100}%` }} />)}
    </div>
  );
}
