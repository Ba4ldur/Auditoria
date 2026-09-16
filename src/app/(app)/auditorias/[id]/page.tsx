import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CheckCircle2, FileText, Siren, TriangleAlert } from 'lucide-react';
import { getStore } from '@/lib/data';
import { formatCnpj } from '@/lib/core/cnpj';
import { formatCompetencia } from '@/lib/core/competencia';
import { formatIsoDateTime } from '@/lib/core/dates';
import { AUDIT_STATUS_LABELS, FINDING_STATUS_LABELS } from '@/lib/domain/entities';
import { TAX_REGIME_LABELS } from '@/lib/domain/model';
import { BAND_LABELS } from '@/lib/audit-engine';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge, FINDING_STATUS_TONES } from '@/components/ui/badge';
import { ScoreGauge, StatCard } from '@/components/ui/stat';
import { EmptyState, Notice, PageHeader } from '@/components/ui/page';
import { UploadDropzone } from '@/components/domain/upload-dropzone';
import { RunAuditButton } from '@/components/domain/run-audit-button';
import { FileList } from '@/components/domain/file-list';
import { FindingsTable } from '@/components/domain/findings-table';
import { FindingPanel } from '@/components/domain/finding-panel';
import { DeleteAuditForm } from './delete-audit-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const audit = await getStore().getAudit(id);
  return { title: audit ? `Auditoria ${formatCompetencia(audit.competencia)}` : 'Auditoria' };
}

const ACTIONABLE = new Set(['DIVERGENCIA', 'ALERTA']);

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ divergencia?: string }>;
}) {
  const { id } = await params;
  const { divergencia } = await searchParams;

  const store = getStore();
  const audit = await store.getAudit(id);
  if (!audit) notFound();

  const company = await store.getCompany(audit.companyId);
  if (!company) notFound();

  const [files, findingsPage] = await Promise.all([
    store.listFiles(id),
    store.listFindings({ auditId: id, limit: 500 }),
  ]);

  const findings = findingsPage.items;
  const selected = divergencia ? await store.getFinding(divergencia) : null;
  const comments = selected ? await store.listComments(selected.id) : [];

  const divergences = findings.filter((finding) => finding.status === 'DIVERGENCIA');
  const alerts = findings.filter((finding) => finding.status === 'ALERTA');
  const criticals = divergences.filter((finding) => finding.severity === 'CRITICA');
  const notVerified = findings.filter(
    (finding) => finding.status === 'NAO_VERIFICADO' || finding.status === 'NAO_APLICAVEL',
  );
  const actionable = findings.filter((finding) => ACTIONABLE.has(finding.status));

  const usableFiles = files.filter((file) => file.identityCheck !== 'INCOMPATIVEL');
  const blockedFiles = files.length - usableFiles.length;
  const processed = audit.status === 'CONCLUIDA' || audit.status === 'CONCLUIDA_COM_ERROS';

  return (
    <>
      <PageHeader
        eyebrow={`Competência ${formatCompetencia(audit.competencia)}`}
        title={company.legalName}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs">{formatCnpj(company.cnpj)}</span>
            <span>·</span>
            <span>{TAX_REGIME_LABELS[company.taxRegime]}</span>
            <span>·</span>
            <Badge tone={processed ? 'success' : 'neutral'}>{AUDIT_STATUS_LABELS[audit.status]}</Badge>
          </span>
        }
        actions={
          <>
            <LinkButton href="/auditorias" variant="secondary">
              Voltar
            </LinkButton>
            {processed ? (
              <>
                <LinkButton href={`/auditorias/${audit.id}/composicao`} variant="secondary">
                  Ver composição
                </LinkButton>
                <LinkButton href={`/auditorias/${audit.id}/validacao`} variant="secondary">
                  Validação técnica
                </LinkButton>
                <LinkButton href={`/auditorias/${audit.id}/relatorio`} variant="primary">
                  Relatório
                </LinkButton>
              </>
            ) : null}
          </>
        }
      />

      {blockedFiles > 0 ? (
        <div className="mb-4">
          <Notice tone="danger" title="Arquivo incompatível">
            {blockedFiles} arquivo(s) importado(s) pertencem a outro CNPJ e foram bloqueados. Eles não entram
            nos cruzamentos desta auditoria. Remova-os ou importe-os na empresa correta.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader
            title="Importação de arquivos"
            description="Arraste os arquivos da competência. O CNPJ e a competência são conferidos automaticamente."
          />
          <CardBody>
            <UploadDropzone auditId={audit.id} disabled={audit.status === 'PROCESSANDO'} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Processamento" description="Executa os cruzamentos com os arquivos importados." />
          <CardBody className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2 text-xs text-ink-muted">
              <FlowStep label="Empresa e competência definidas" done />
              <FlowStep label={`Arquivos importados (${usableFiles.length})`} done={usableFiles.length > 0} />
              <FlowStep label="Identificação e validação dos documentos" done={usableFiles.length > 0} />
              <FlowStep label="Processamento e cruzamento" done={processed} />
              <FlowStep label="Resultado e score de conformidade" done={processed} />
            </ul>

            <div className="flex items-end justify-between gap-3 border-t border-line pt-4">
              <div className="text-xs text-ink-muted">
                {audit.finishedAt ? (
                  <>Última execução em {formatIsoDateTime(audit.finishedAt)}.</>
                ) : (
                  <>Nenhuma execução concluída até o momento.</>
                )}
              </div>
              <RunAuditButton
                auditId={audit.id}
                disabled={usableFiles.length === 0 || audit.status === 'PROCESSANDO'}
                label={processed ? 'Reprocessar auditoria' : 'Iniciar auditoria'}
              />
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={`Arquivos da auditoria (${files.length})`}
          description="Cada arquivo mantem nome original, hash SHA-256, tipo identificado e status de processamento."
        />
        <FileList auditId={audit.id} files={files} />
      </Card>

      {processed ? (
        <>
          <div className="mt-6 grid gap-4 xl:grid-cols-[auto_1fr]">
            <Card className="flex items-center justify-center px-8 py-6">
              <ScoreGauge
                score={audit.score ?? 0}
                band={audit.band ? BAND_LABELS[audit.band].toUpperCase() : '—'}
              />
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Cruzamentos corretos"
                value={audit.crossChecksOk.toLocaleString('pt-BR')}
                tone="success"
                icon={<CheckCircle2 size={18} aria-hidden />}
                hint="Comparacoes conferidas sem diferença"
              />
              <StatCard
                label="Alertas"
                value={alerts.length}
                tone="warning"
                icon={<TriangleAlert size={18} aria-hidden />}
                hint="Pontos de atenção"
              />
              <StatCard
                label="Divergências"
                value={divergences.length}
                tone={divergences.length > 0 ? 'danger' : 'success'}
                icon={<FileText size={18} aria-hidden />}
                hint="Diferenças apuradas"
              />
              <StatCard
                label="Críticas"
                value={criticals.length}
                tone={criticals.length > 0 ? 'danger' : 'success'}
                icon={<Siren size={18} aria-hidden />}
                hint="Gravidade crítica"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_25rem]">
            <Card>
              <CardHeader
                title={`Ocorrências (${actionable.length})`}
                description="Clique em uma linha para ver as evidências utilizadas."
                action={
                  <LinkButton href={`/divergencias?auditoria=${audit.id}`} variant="secondary" size="sm">
                    Abrir em Divergências
                  </LinkButton>
                }
              />
              <FindingsTable
                findings={actionable}
                basePath={`/auditorias/${audit.id}`}
                selectedId={selected?.id ?? null}
              />
              <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
                <span className="self-center text-xs text-ink-muted">Exportar em CSV:</span>
                <LinkButton
                  href={`/api/auditorias/${audit.id}/exportar?tipo=divergencias`}
                  variant="secondary"
                  size="sm"
                >
                  Divergências
                </LinkButton>
                <LinkButton
                  href={`/api/auditorias/${audit.id}/exportar?tipo=nao-encontrados`}
                  variant="secondary"
                  size="sm"
                >
                  Documentos não encontrados
                </LinkButton>
                <LinkButton
                  href={`/api/auditorias/${audit.id}/exportar?tipo=documentos-em-revisao`}
                  variant="secondary"
                  size="sm"
                >
                  Documentos em revisão
                </LinkButton>
              </div>
            </Card>

            {selected ? (
              <Card className="min-w-0 overflow-hidden xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)]">
                <FindingPanel
                  finding={selected}
                  comments={comments}
                  closeHref={`/auditorias/${audit.id}`}
                  auditId={audit.id}
                />
              </Card>
            ) : (
              <Card>
                <CardHeader title="Detalhe da ocorrência" />
                <CardBody>
                  <p className="text-sm text-ink-muted">
                    Selecione uma ocorrência na tabela para ver a descrição, os valores comparados e as
                    evidências que originaram o resultado.
                  </p>
                </CardBody>
              </Card>
            )}
          </div>

          {notVerified.length > 0 ? (
            <Card className="mt-4">
              <CardHeader
                title={`Regras não verificadas ou não aplicáveis (${notVerified.length})`}
                description="Um cruzamento que não pôde ser executado, ou que não se aplica aos documentos, não é evidência de conformidade nem de erro: não conta como divergência e não afeta o score. Fica listado aqui porque continua em aberto."
              />
              <CardBody>
                <ul className="flex flex-col gap-2">
                  {notVerified.map((finding) => (
                    <li key={finding.id} className="rounded-md border border-line px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-navy-700">{finding.ruleCode}</span>
                        <Badge tone={FINDING_STATUS_TONES[finding.status]}>
                          {FINDING_STATUS_LABELS[finding.status]}
                        </Badge>
                        <span className="text-xs font-medium text-ink">{finding.title}</span>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">{finding.description}</p>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : (
        <div className="mt-6">
          <EmptyState
            title="Auditoria ainda não processada"
            description="Importe os arquivos da competência e clique em Iniciar auditoria para executar os cruzamentos."
          />
        </div>
      )}

      <Card className="mt-6 border-danger/25">
        <CardHeader
          title="Excluir auditoria"
          description="Remove a auditoria, os arquivos importados e as ocorrências apuradas. A ação não pode ser desfeita."
        />
        <CardBody>
          <DeleteAuditForm auditId={audit.id} />
        </CardBody>
      </Card>

      {audit.notes ? (
        <p className="mt-4 text-xs text-ink-muted">
          <Link href={`/auditorias/${audit.id}`} className="font-semibold">
            Observações:
          </Link>{' '}
          {audit.notes}
        </p>
      ) : null}
    </>
  );
}

function FlowStep({ label, done }: { label: string; done: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[0.5rem] ' +
          (done ? 'border-success bg-success text-white' : 'border-line-strong text-transparent')
        }
        aria-hidden
      >
        ✓
      </span>
      <span className={done ? 'text-ink' : undefined}>{label}</span>
    </li>
  );
}
