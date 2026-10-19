import type { Slice } from "@/lib/dashboard";

// Paleta categorica accesible (funciona sobre fondo oscuro).
export const PALETTE = [
  "#2f81f7",
  "#3fb950",
  "#d29922",
  "#a371f7",
  "#ec6547",
  "#56d4dd",
  "#db61a2",
  "#8b949e",
];

/** Gráfico de dona en SVG puro. */
export function Donut({
  data,
  size = 168,
  thickness = 24,
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;

  let acc = 0;
  const segments = data.map((d, i) => {
    const len = total > 0 ? (c * d.value) / total : 0;
    const seg = {
      len,
      offset: -acc,
      color: PALETTE[i % PALETTE.length],
      ...d,
    };
    acc += len;
    return seg;
  });

  return (
    <div className="donut">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
      >
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          <circle
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke="var(--border)"
            strokeWidth={thickness}
          />
          {total > 0 &&
            segments.map((s, i) => (
              <circle
                key={i}
                cx={cx}
                cy={cx}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${s.len} ${c - s.len}`}
                strokeDashoffset={s.offset}
                strokeLinecap="butt"
              />
            ))}
        </g>
        <text
          x={cx}
          y={cx - 4}
          textAnchor="middle"
          fontSize="30"
          fontWeight="700"
          fill="var(--text)"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cx + 18}
          textAnchor="middle"
          fontSize="12"
          fill="var(--muted)"
        >
          procesos
        </text>
      </svg>
      <ul className="legend">
        {data.length === 0 && <li className="muted small">Sin datos</li>}
        {data.map((d, i) => (
          <li key={d.label}>
            <span
              className="dot"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />
            <span className="legend-label">{d.label}</span>
            <span className="legend-val">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tarjeta de estadística (número grande). */
export function StatTile({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number | string;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/** Fila de barras horizontales simples (para los buckets de antigüedad). */
export function BucketBar({
  items,
}: {
  items: { label: string; value: number; color: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="buckets">
      {items.map((it) => (
        <div key={it.label} className="bucket">
          <div className="bucket-top">
            <span className="bucket-val" style={{ color: it.color }}>
              {it.value}
            </span>
            <span className="bucket-label">{it.label}</span>
          </div>
          <div className="bucket-track">
            <div
              className="bucket-fill"
              style={{
                width: `${(it.value / max) * 100}%`,
                background: it.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
