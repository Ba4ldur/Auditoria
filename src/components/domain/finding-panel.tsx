import Link from 'next/link';
import { X } from 'lucide-react';
import { formatBRL, formatSignedBRL, type Cents } from '@/lib/core/money';
import { formatIsoDateTime } from '@/lib/core/dates';
import {
  FINDING_STATUS_LABELS,
  SEVERITY_LABELS,
  type AuditComment,
  type AuditFinding,
} from '@/lib/domain/entities';
import { AUDIT_MODULE_LABELS, sourceShortLabel } from '@/lib/domain/sources';
import { Badge, FINDING_STATUS_TONES, SEVERITY_TONES } from '@/components/ui/badge';
import { ReviewForm } from './review-form';
import { CommentForm } from './comment-form';

/**
 * Detail panel of a finding (requirements 20, 21 and 22).
 *
 * The panel always answers the question "where did this number come from":
 * every evidence row states the origin in the auditor's own vocabulary (field
 * of the XML, register of the SPED, field of the PDF) and the file it came
 * from. A finding never says only that something is wrong.
 */
export function FindingPanel({
  finding,
  comments,
  closeHref,
}: {
  finding: AuditFinding;
  comments: readonly AuditComment[];
  closeHref: string;
}) {
  return (
    <aside className="flex h-full flex-col bg-surface">
      <header className="flex items-start justify-between gap-3 border-b border-line bg-navy-900 px-5 py-4 text-white">
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-wide text-gold-400">{finding.ruleCode}</p>
          <h2 className="mt-1 text-base leading-snug font-semibold">{finding.title}</h2>
          <p className="mt-1 text-xs text-navy-200">{finding.ruleName}</p>
        </div>
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Fechar painel"
          className="rounded-md p-1.5 text-navy-200 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={18} aria-hidden />
        </Link>
      </header>

      <div className="app-scroll flex-1 overflow-y-auto px-5 py-5">
        <div className="flex flex-wrap gap-2">
          <Badge tone={FINDING_STATUS_TONES[finding.status]}>
            {FINDING_STATUS_LABELS[finding.status]}
          </Badge>
          <Badge tone={SEVERITY_TONES[finding.severity]}>{SEVERITY_LABELS[finding.severity]}</Badge>
          <Badge tone="neutral">{AUDIT_MODULE_LABELS[finding.module]}</Badge>
          <Badge tone={finding.nature === 'FATO' ? 'info' : 'gold'}>
            {finding.nature === 'FATO' ? 'Fato apurado' : 'Indício — requer análise'}
          </Badge>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-ink">{finding.description}</p>

        {finding.originValue !== null || finding.targetValue !== null ? (
          <dl className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
            <ValueCell label={finding.originLabel ?? 'Origem'} value={finding.originValue} />
            <ValueCell label={finding.targetLabel ?? 'Destino'} value={finding.targetValue} />
            <ValueCell label="Diferença" value={finding.difference} emphasis />
          </dl>
        ) : null}

        {finding.documentRef ? (
          <p className="mt-4 text-xs text-ink-muted">
            Documento: <span className="font-mono break-all text-ink">{finding.documentRef}</span>
          </p>
        ) : null}

        <section className="mt-6">
          <h3 className="text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-muted uppercase">
            Evidências utilizadas
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {finding.evidence.length === 0 ? (
              <li className="text-xs text-ink-subtle">Sem evidências registradas para esta ocorrência.</li>
            ) : (
              finding.evidence.map((item) => (
                <li key={item.id} className="rounded-md border border-line bg-navy-50/40 px-3 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-ink">{item.label}</span>
                    {item.value ? (
                      <span className="tabular font-mono text-xs text-navy-700">{item.value}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-muted">{item.origin}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {item.source ? <Badge tone="muted">{sourceShortLabel(item.source)}</Badge> : null}
                    {item.fileName ? (
                      <span className="text-[0.625rem] break-all text-ink-subtle">{item.fileName}</span>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>

        {finding.humanReviewNote ? (
          <section className="mt-6 rounded-md border border-gold-300 bg-gold-100/60 px-3 py-3">
            <h3 className="text-[0.6875rem] font-semibold tracking-[0.1em] text-gold-700 uppercase">
              Análise humana necessária
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink">{finding.humanReviewNote}</p>
          </section>
        ) : null}

        <section className="mt-6">
          <h3 className="text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-muted uppercase">
            Classificação da divergência
          </h3>
          <div className="mt-2">
            <ReviewForm
              findingId={finding.id}
              reviewStatus={finding.reviewStatus}
              reviewNote={finding.reviewNote ?? ''}
            />
          </div>
          {finding.reviewer ? (
            <p className="mt-2 text-[0.6875rem] text-ink-subtle">
              Última análise por {finding.reviewer} em {formatIsoDateTime(finding.reviewedAt)}.
            </p>
          ) : null}
        </section>

        <section className="mt-6">
          <h3 className="text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-muted uppercase">
            Observacoes ({comments.length})
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {comments.map((comment) => (
              <li key={comment.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{comment.author}</span>
                  <span className="text-[0.625rem] text-ink-subtle">
                    {formatIsoDateTime(comment.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
                  {comment.body}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <CommentForm findingId={finding.id} />
          </div>
        </section>
      </div>
    </aside>
  );
}

function ValueCell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: Cents | null;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="text-[0.625rem] leading-tight text-ink-muted">{label}</dt>
      <dd
        className={
          'tabular mt-1 text-sm font-semibold ' + (emphasis ? 'text-danger' : 'text-ink')
        }
      >
        {value === null ? '—' : emphasis ? formatSignedBRL(value) : formatBRL(value)}
      </dd>
    </div>
  );
}
