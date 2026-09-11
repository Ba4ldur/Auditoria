import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { formatCnpj } from '@/lib/core/cnpj';
import { formatCompetencia } from '@/lib/core/competencia';
import { formatIsoDate, formatIsoDateTime } from '@/lib/core/dates';
import { formatBRL, formatSignedBRL } from '@/lib/core/money';
import {
  FINDING_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  SEVERITY_LABELS,
} from '@/lib/domain/entities';
import { TAX_REGIME_LABELS } from '@/lib/domain/model';
import { AUDIT_MODULE_LABELS, sourceShortLabel } from '@/lib/domain/sources';
import { BAND_LABELS } from '@/lib/audit-engine';
import { LinkButton } from '@/components/ui/button';
import { PrintButton } from '@/components/domain/print-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const audit = await getStore().getAudit(id);
  return {
    title: audit ? `Relatório ${formatCompetencia(audit.competencia)}` : 'Relatório',
  };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();

  const audit = await store.getAudit(id);
  if (!audit) notFound();
  const company = await store.getCompany(audit.companyId);
  if (!company) notFound();

  const [files, findingsPage] = await Promise.all([
    store.listFiles(id),
    store.listFindings({ auditId: id, limit: 1000 }),
  ]);

  const findings = findingsPage.items;
  const divergences = findings.filter((finding) => finding.status === 'DIVERGENCIA');
  const alerts = findings.filter((finding) => finding.status === 'ALERTA');
  const criticals = divergences.filter(
    (finding) => finding.severity === 'CRITICA' || finding.severity === 'ALTA',
  );
  const notVerified = findings.filter(
    (finding) => finding.status === 'NAO_VERIFICADO' || finding.status === 'NAO_APLICAVEL',
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print mb-4 flex flex-wrap justify-between gap-2">
        <LinkButton href={`/auditorias/${audit.id}`} variant="secondary">
          Voltar a auditoria
        </LinkButton>
        <PrintButton />
      </div>

      <article className="print-page rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)]">
        <header className="rounded-t-[var(--radius-card)] bg-navy-900 px-8 py-7 text-white">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-[0.625rem] tracking-[0.28em] text-gold-400 uppercase">
                Attivare Auditor
              </p>
              <h1 className="mt-2 text-xl font-semibold">Relatório de Conformidade Fiscal</h1>
              <p className="mt-1 text-xs text-navy-200">
                Documento técnico de auditoria. As conclusões tributárias dependem de análise humana.
              </p>
            </div>
            <div className="text-right">
              <p className="text-[0.625rem] tracking-[0.16em] text-navy-300 uppercase">Score</p>
              <p className="tabular text-4xl leading-none font-semibold text-gold-400">
                {audit.score ?? '—'}
              </p>
              <p className="mt-1 text-[0.6875rem] text-navy-200">
                {audit.band ? BAND_LABELS[audit.band] : 'Não apurado'}
              </p>
            </div>
          </div>
        </header>

        <section className="grid gap-x-8 gap-y-4 border-b border-line px-8 py-6 sm:grid-cols-2 lg:grid-cols-4">
          <Item label="Empresa" value={company.legalName} />
          <Item label="CNPJ" value={formatCnpj(company.cnpj)} mono />
          <Item label="Regime tributário" value={TAX_REGIME_LABELS[company.taxRegime]} />
          <Item label="Competência" value={formatCompetencia(audit.competencia)} />
          <Item label="Inscrição estadual" value={company.stateRegistration ?? '—'} mono />
          <Item label="UF / Município" value={`${company.uf}${company.municipality ? ` / ${company.municipality}` : ''}`} />
          <Item label="Data da auditoria" value={formatIsoDateTime(audit.finishedAt ?? audit.createdAt)} />
          <Item label="Documentos analisados" value={audit.documentCount.toLocaleString('pt-BR')} />
        </section>

        <Section title="Arquivos analisados">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="py-2 pr-3 font-medium">Arquivo</th>
                <th className="py-2 pr-3 font-medium">Tipo</th>
                <th className="py-2 pr-3 font-medium">Período</th>
                <th className="py-2 pr-3 font-medium">Situação</th>
                <th className="py-2 font-medium">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-ink-muted">
                    Nenhum arquivo importado.
                  </td>
                </tr>
              ) : (
                files.map((file) => (
                  <tr key={file.id} className="border-b border-line/70 align-top">
                    <td className="py-2 pr-3 break-all">{file.originalName}</td>
                    <td className="py-2 pr-3">
                      {file.detectedSource ? sourceShortLabel(file.detectedSource) : 'Não identificado'}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {file.detectedStartDate ? formatIsoDate(file.detectedStartDate) : '—'}
                      {file.detectedEndDate ? ` a ${formatIsoDate(file.detectedEndDate)}` : ''}
                    </td>
                    <td className="py-2 pr-3">{file.status}</td>
                    <td className="py-2 font-mono text-[0.625rem] break-all text-ink-muted">
                      {file.sha256}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Section>

        <Section title="Resumo">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Summary label="Cruzamentos corretos" value={audit.crossChecksOk} />
            <Summary label="Alertas" value={alerts.length} />
            <Summary label="Divergências" value={divergences.length} />
            <Summary label="Não verificadas" value={notVerified.length} />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">
            O score parte de 100 e desconta pesos por gravidade das ocorrências que exigem ação. Regras não
            executadas por ausência de documento, ou não aplicáveis ao regime da empresa, não afetam o score
            porque a impossibilidade de verificar não e evidência de conformidade nem de erro.
          </p>
        </Section>

        <Section title={`Divergências apuradas (${divergences.length})`}>
          {divergences.length === 0 ? (
            <p className="text-xs text-ink-muted">
              Nenhuma divergência apurada nos cruzamentos executados nesta competência.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {divergences.map((finding) => (
                <li key={finding.id} className="break-inside-avoid border-l-2 border-danger pl-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-mono text-[0.6875rem] text-navy-700">{finding.ruleCode}</span>
                    <span className="text-xs font-semibold text-ink">{finding.title}</span>
                    <span className="text-[0.625rem] text-ink-muted">
                      {SEVERITY_LABELS[finding.severity]} · {AUDIT_MODULE_LABELS[finding.module]} ·{' '}
                      {REVIEW_STATUS_LABELS[finding.reviewStatus]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">{finding.description}</p>

                  {finding.originValue !== null || finding.targetValue !== null ? (
                    <p className="tabular mt-1 text-xs">
                      <strong>{finding.originLabel}:</strong>{' '}
                      {finding.originValue === null ? '—' : formatBRL(finding.originValue)}
                      {' · '}
                      <strong>{finding.targetLabel}:</strong>{' '}
                      {finding.targetValue === null ? '—' : formatBRL(finding.targetValue)}
                      {finding.difference !== null ? (
                        <>
                          {' · '}
                          <strong>Diferença:</strong> {formatSignedBRL(finding.difference)}
                        </>
                      ) : null}
                    </p>
                  ) : null}

                  {finding.evidence.length > 0 ? (
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {finding.evidence.map((item) => (
                        <li key={item.id} className="text-[0.6875rem] text-ink-subtle">
                          <span className="font-medium text-ink-muted">{item.label}:</span> {item.origin}
                          {item.value ? ` — ${item.value}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`Riscos encontrados (${criticals.length})`}>
          {criticals.length === 0 ? (
            <p className="text-xs text-ink-muted">
              Nenhuma ocorrência de gravidade alta ou crítica nos cruzamentos executados.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {criticals.map((finding) => (
                <li key={finding.id} className="text-xs">
                  <span className="font-mono text-[0.6875rem] text-navy-700">{finding.ruleCode}</span>{' '}
                  <span className="font-semibold">{finding.title}</span>
                  {finding.humanReviewNote ? (
                    <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-ink-muted">
                      {finding.humanReviewNote}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {notVerified.length > 0 ? (
          <Section title={`Cruzamentos não executados (${notVerified.length})`}>
            <ul className="flex flex-col gap-1.5">
              {notVerified.map((finding) => (
                <li key={finding.id} className="text-xs text-ink-muted">
                  <span className="font-mono text-[0.6875rem] text-navy-700">{finding.ruleCode}</span>{' '}
                  {FINDING_STATUS_LABELS[finding.status]} — {finding.description}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Observações">
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
            {audit.notes?.trim() || 'Sem observações registradas para esta auditoria.'}
          </p>
          <p className="mt-4 border-t border-line pt-3 text-[0.6875rem] leading-relaxed text-ink-subtle">
            Este relatório apresenta o resultado de cruzamentos automatizados entre os arquivos apresentados.
            As diferenças apontadas são fatos aritméticos apurados sobre esses arquivos e não constituem, por
            si so, conclusão sobre a correção do tratamento tributário aplicado, que depende da natureza das
            operações e da análise de profissional habilitado.
          </p>
        </Section>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-b border-line px-8 py-6 last:border-b-0">
      <h2 className="mb-3 text-[0.6875rem] font-semibold tracking-[0.12em] text-gold-700 uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[0.625rem] tracking-[0.08em] text-ink-subtle uppercase">{label}</p>
      <p className={'mt-0.5 text-sm text-ink ' + (mono ? 'font-mono text-xs' : '')}>{value}</p>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line px-3 py-2.5">
      <p className="text-[0.625rem] tracking-[0.08em] text-ink-subtle uppercase">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold text-ink">{value.toLocaleString('pt-BR')}</p>
    </div>
  );
}
