import { useMemo, useState } from "react";
import type { TimelineSeries } from "../api.ts";

interface Props {
  labels: string[]; // x-axis labels (tournament names/dates)
  series: TimelineSeries[]; // each with points [{x,y}]
  height?: number;
}

const PALETTE = [
  "#e7cd6e",
  "#7be0a0",
  "#d9596a",
  "#6ec6ff",
  "#f0a868",
  "#b691f0",
  "#9ad36a",
  "#ff8fab",
  "#5ad1c8",
  "#d8b53f",
];

const fmt = (n: number) => `${n < 0 ? "-" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;

export default function LineChart({ labels, series, height = 320 }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const W = 760;
  const H = height;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 48;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const visible = series.filter((s) => !hidden.has(s.id));

  const { minY, maxY, maxX } = useMemo(() => {
    let min = 0;
    let max = 0;
    let mx = 0;
    for (const s of series) {
      for (const p of s.points) {
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
        if (p.x > mx) mx = p.x;
      }
    }
    if (min === max) {
      min -= 100;
      max += 100;
    }
    return { minY: min, maxY: max, maxX: Math.max(mx, 1) };
  }, [series]);

  const x = (i: number) => padL + (maxX === 0 ? 0 : (i / maxX) * plotW);
  const y = (v: number) => padT + plotH - ((v - minY) / (maxY - minY)) * plotH;

  const zeroY = y(0);

  // horizontal gridlines (5 bands)
  const ticks = useMemo(() => {
    const out: number[] = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      out.push(minY + ((maxY - minY) * i) / steps);
    }
    return out;
  }, [minY, maxY]);

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const colorOf = (id: string) => PALETTE[series.findIndex((s) => s.id === id) % PALETTE.length];

  return (
    <div className="chart">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Cumulative win/loss over time"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(t)}
              y2={y(t)}
              className="chart-grid"
            />
            <text x={padL - 8} y={y(t) + 4} className="chart-axis-label" textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* zero baseline */}
        {minY < 0 && maxY > 0 && (
          <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} className="chart-zero" />
        )}

        {/* series lines */}
        {visible.map((s) => {
          const d = s.points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`)
            .join(" ");
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.id}>
              <path d={d} fill="none" stroke={colorOf(s.id)} strokeWidth={2.5} />
              {last && (
                <circle cx={x(last.x)} cy={y(last.y)} r={3.5} fill={colorOf(s.id)} />
              )}
            </g>
          );
        })}

        {/* x-axis labels (first, middle, last to avoid clutter) */}
        {labels.length > 0 &&
          [0, Math.floor((labels.length - 1) / 2), labels.length - 1]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((idx) => (
              <text
                key={idx}
                x={x(idx)}
                y={H - padB + 22}
                className="chart-axis-label"
                textAnchor="middle"
              >
                {labels[idx]}
              </text>
            ))}
      </svg>

      <div className="chart-legend">
        {series.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`legend-item ${hidden.has(s.id) ? "off" : ""}`}
            onClick={() => toggle(s.id)}
          >
            <span className="legend-swatch" style={{ background: colorOf(s.id) }} />
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
