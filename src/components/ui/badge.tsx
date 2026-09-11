import type { ReactNode } from 'react';
import { cn } from '@/lib/ui/cn';
import type { FindingStatus, ReviewStatus, Severity } from '@/lib/domain/entities';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'gold' | 'muted';

const TONES: Record<Tone, string> = {
  neutral: 'bg-navy-50 text-navy-700 ring-navy-100',
  info: 'bg-info-soft text-info ring-navy-100',
  success: 'bg-success-soft text-success ring-success/15',
  warning: 'bg-warning-soft text-warning ring-warning/20',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  gold: 'bg-gold-100 text-gold-700 ring-gold-300',
  muted: 'bg-canvas text-ink-subtle ring-line',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ring-1 ring-inset whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const SEVERITY_TONES: Record<Severity, Tone> = {
  INFO: 'muted',
  BAIXA: 'info',
  MEDIA: 'warning',
  ALTA: 'danger',
  CRITICA: 'danger',
};

export const FINDING_STATUS_TONES: Record<FindingStatus, Tone> = {
  OK: 'success',
  ALERTA: 'warning',
  DIVERGENCIA: 'danger',
  NAO_APLICAVEL: 'muted',
  NAO_VERIFICADO: 'muted',
};

export const REVIEW_STATUS_TONES: Record<ReviewStatus, Tone> = {
  PENDENTE: 'neutral',
  EM_ANALISE: 'info',
  PROCEDENTE: 'danger',
  IMPROCEDENTE: 'success',
  CORRIGIDO: 'success',
  IGNORADO: 'muted',
};
