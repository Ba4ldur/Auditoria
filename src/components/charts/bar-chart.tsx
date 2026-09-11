import { ChartEmpty } from './line-chart';

export interface BarDatum {
  readonly label: string;
  readonly value: number;
  readonly color?: string;
}

/** Horizontal bars — used for counts per module and per severity. */
export function BarChart({
  data,
  emptyMessage = 'Sem ocorrências registradas.',
  valueSuffix = '',
}: {
  data: readonly BarDatum[];
  emptyMessage?: string;
  valueSuffix?: string;
}) {
  const total = data.reduce((sum, datum) => sum + datum.value, 0);
  if (data.length === 0 || total === 0) {
    return <ChartEmpty height={180} message={emptyMessage} />;
  }

  const max = Math.max(...data.map((datum) => datum.value));

  return (
    <ul className="flex flex-col gap-3">
      {data.map((datum) => (
        <li key={datum.label} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3">
          <span className="truncate text-xs text-ink-muted" title={datum.label}>
            {datum.label}
          </span>
          <span className="h-2.5 w-full overflow-hidden rounded-full bg-navy-50">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${max === 0 ? 0 : (datum.value / max) * 100}%`,
                backgroundColor: datum.color ?? 'var(--color-navy-600)',
              }}
            />
          </span>
          <span className="tabular w-12 text-right text-xs font-semibold text-ink">
            {datum.value}
            {valueSuffix}
          </span>
        </li>
      ))}
    </ul>
  );
}
