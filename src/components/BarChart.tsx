import { useMemo } from "react";

export interface BarDatum {
  id?: string;
  label: string;
  value: number;
  // Optional x-axis caption. When omitted, the first word of `label` is used
  // (handy for player names); set this when `label` is multi-word, e.g. a game
  // name, and you want a cleaner axis tick such as a date.
  axisLabel?: string;
}

interface Props {
  items: BarDatum[];
  // Fixed top of the Y axis. The chart is symmetric (-yMax..yMax) so negative
  // stacks render below the zero line. Auto-expands if data exceeds the cap.
  yMax?: number;
  height?: number;
  // Optional currency-style formatter for the axis + tooltips.
  format?: (n: number) => string;
}

const defaultFmt = (n: number) =>
  `${n < 0 ? "-" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;

const POS = "#161616"; // black for positive stacks
const NEG = "#c0392b"; // red for negative stacks

export default function BarChart({ items, yMax = 10000, height = 320, format = defaultFmt }: Props) {
  const W = 760;
  const H = height;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 64;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const domain = useMemo(() => {
    const maxAbs = items.reduce((m, d) => Math.max(m, Math.abs(d.value)), 0);
    return Math.max(yMax, Math.ceil(maxAbs / 1000) * 1000 || yMax);
  }, [items, yMax]);

  const y = (v: number) => padT + plotH / 2 - (v / domain) * (plotH / 2);
  const zeroY = y(0);

  const n = Math.max(items.length, 1);
  const slot = plotW / n;
  const barW = Math.min(46, slot * 0.6);

  const ticks = useMemo(() => {
    const out: number[] = [];
    const steps = 4;
    for (let i = -steps; i <= steps; i++) out.push((domain * i) / steps);
    return out;
  }, [domain]);

  return (
    <div className="chart">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Player stacks"
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={padL - 8} y={y(t) + 4} className="chart-axis-label" textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}

        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} className="chart-zero" />

        {items.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const top = y(Math.max(0, d.value));
          const bottom = y(Math.min(0, d.value));
          const h = Math.max(1, bottom - top);
          const fill = d.value < 0 ? NEG : POS;
          const short = d.axisLabel ?? d.label.split(" ")[0];
          return (
            <g key={d.id ?? i}>
              <rect x={cx - barW / 2} y={top} width={barW} height={h} rx={3} fill={fill}>
                <title>{`${d.label}: ${format(d.value)}`}</title>
              </rect>
              <text x={cx} y={H - padB + 18} className="chart-axis-label" textAnchor="middle">
                {short}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
