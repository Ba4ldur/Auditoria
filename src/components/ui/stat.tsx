import type { ReactNode } from 'react';
import { cn } from '@/lib/ui/cn';

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'gold';
  icon?: ReactNode;
}) {
  const accents = {
    default: 'before:bg-navy-600',
    success: 'before:bg-success',
    warning: 'before:bg-warning',
    danger: 'before:bg-danger',
    gold: 'before:bg-gold-500',
  } as const;

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 shadow-[var(--shadow-card)]',
        'before:absolute before:top-0 before:left-0 before:h-full before:w-1 before:content-[""]',
        accents[tone],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">
          {label}
        </p>
        {icon ? <span className="text-navy-300">{icon}</span> : null}
      </div>
      <p className="tabular mt-2 text-3xl leading-none font-semibold text-ink">{value}</p>
      {hint ? <p className="mt-2 text-xs text-ink-muted">{hint}</p> : null}
    </article>
  );
}

export function ScoreGauge({
  score,
  band,
  size = 148,
}: {
  score: number;
  band: string;
  size?: number;
}) {
  const radius = size / 2 - 12;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score)) / 100;
  const color =
    score >= 90 ? 'var(--color-success)' : score >= 75 ? 'var(--color-gold-600)' : score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Score ${score} de 100`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-navy-100)"
          strokeWidth={10}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${circumference * progress} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="48%"
          textAnchor="middle"
          className="tabular fill-ink"
          style={{ fontSize: size * 0.26, fontWeight: 600 }}
        >
          {score}
        </text>
        <text
          x="50%"
          y="64%"
          textAnchor="middle"
          className="fill-ink-subtle"
          style={{ fontSize: size * 0.09 }}
        >
          / 100
        </text>
      </svg>
      <p className="mt-1 text-xs font-semibold tracking-[0.08em] uppercase" style={{ color }}>
        {band}
      </p>
    </div>
  );
}
