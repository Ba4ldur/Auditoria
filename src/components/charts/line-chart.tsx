/**
 * Minimal SVG line chart, rendered on the server.
 *
 * Charting libraries were avoided on purpose: the dashboard needs three simple,
 * precisely styled charts, and shipping a generic library would add a large
 * client bundle and impose its own visual language.
 */

export interface LinePoint {
  readonly label: string;
  readonly value: number;
}

export function LineChart({
  points,
  max = 100,
  height = 200,
  emptyMessage = 'Sem dados para o período.',
}: {
  points: readonly LinePoint[];
  max?: number;
  height?: number;
  emptyMessage?: string;
}) {
  if (points.length === 0) {
    return <ChartEmpty height={height} message={emptyMessage} />;
  }

  const width = 720;
  const padding = { top: 16, right: 16, bottom: 28, left: 34 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const stepX = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  const coords = points.map((point, index) => ({
    x: padding.left + (points.length > 1 ? index * stepX : innerWidth / 2),
    y: padding.top + innerHeight - (Math.max(0, Math.min(max, point.value)) / max) * innerHeight,
    point,
  }));

  const path = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x},${coord.y}`).join(' ');
  const area =
    `${path} L${coords[coords.length - 1]?.x ?? padding.left},${padding.top + innerHeight} ` +
    `L${coords[0]?.x ?? padding.left},${padding.top + innerHeight} Z`;

  const gridValues = [0, 25, 50, 75, 100].filter((value) => value <= max);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Evolucao da conformidade">
      {gridValues.map((value) => {
        const y = padding.top + innerHeight - (value / max) * innerHeight;
        return (
          <g key={value}>
            <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={1} />
            <text x={padding.left - 8} y={y + 3} textAnchor="end" style={{ fontSize: 10 }} className="fill-ink-subtle">
              {value}
            </text>
          </g>
        );
      })}

      <path d={area} fill="var(--color-navy-600)" opacity={0.08} />
      <path d={path} fill="none" stroke="var(--color-navy-600)" strokeWidth={2} strokeLinejoin="round" />

      {coords.map((coord) => (
        <g key={coord.point.label}>
          <circle cx={coord.x} cy={coord.y} r={3.5} fill="var(--color-surface)" stroke="var(--color-gold-600)" strokeWidth={2} />
          <title>{`${coord.point.label}: ${coord.point.value}`}</title>
        </g>
      ))}

      {coords.map((coord) => (
        <text
          key={`label-${coord.point.label}`}
          x={coord.x}
          y={height - 8}
          textAnchor="middle"
          style={{ fontSize: 10 }}
          className="fill-ink-muted"
        >
          {coord.point.label}
        </text>
      ))}
    </svg>
  );
}

export function ChartEmpty({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-ink-subtle"
      style={{ height }}
    >
      {message}
    </div>
  );
}
