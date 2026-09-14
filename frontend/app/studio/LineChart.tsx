"use client";
import { useState } from "react";

export type Series = { name: string; color: string; values: (number | undefined)[] };

const W = 250,
  H = 140,
  PAD = { l: 36, r: 34, t: 10, b: 22 };

/** Small per-epoch line chart: one y-axis, legend, direct end labels, hover crosshair. */
export default function LineChart({
  title,
  series,
  percent = false,
}: {
  title: string;
  series: Series[];
  percent?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== undefined && isFinite(v));
  if (!n || !all.length) return null;
  const max = percent ? 1 : Math.max(...all) * 1.1 || 1;
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const fmt = (v: number) => (percent ? `${(v * 100).toFixed(1)}%` : v.toFixed(3));
  const ticks = [0, max / 2, max];
  // Direct end labels only where they cannot collide; the legend always carries identity.
  const ends = series.map((s) => {
    const i = s.values.map((v, k) => (v === undefined ? -1 : k)).filter((k) => k >= 0).pop();
    return i === undefined ? null : y(s.values[i]!);
  });
  const labelled = ends.map((e, i) => e !== null && ends.every((o, j) => j === i || o === null || Math.abs(o - e) >= 12));

  return (
    <figure className="lineChart">
      <figcaption>{title}</figcaption>
      <div className="chartLegend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="chartBox">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}，共 ${n} 個 epoch`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            setHover(n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chartGrid" />
              <text x={PAD.l - 5} y={y(t) + 3} textAnchor="end" className="chartTick">
                {percent ? `${Math.round(t * 100)}%` : t.toFixed(t < 1 ? 2 : 1)}
              </text>
            </g>
          ))}
          <text x={PAD.l} y={H - 6} className="chartTick">
            1
          </text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" className="chartTick">
            epoch {n}
          </text>
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="chartCross" />}
          {series.map((s, si) => {
            const pts = s.values.map((v, i) => (v === undefined ? null : [x(i), y(v)] as const)).filter(Boolean) as [number, number][];
            return (
              <g key={s.name}>
                <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                {pts.length === 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r={4} fill={s.color} />}
                {hover !== null && s.values[hover] !== undefined && (
                  <circle cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
                )}
                {labelled[si] && pts.length > 0 && (
                  <text x={pts[pts.length - 1][0] + 4} y={pts[pts.length - 1][1] + 3} className="chartEnd">
                    {s.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div className="chartTip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <b>epoch {hover + 1}</b>
            {series.map(
              (s) =>
                s.values[hover] !== undefined && (
                  <span key={s.name}>
                    <i style={{ background: s.color }} />
                    {s.name} {fmt(s.values[hover]!)}
                  </span>
                ),
            )}
          </div>
        )}
      </div>
    </figure>
  );
}
