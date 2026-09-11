import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getStore } from '@/lib/data';
import { formatCnpj } from '@/lib/core/cnpj';
import { formatCompetencia, isCompetencia } from '@/lib/core/competencia';
import { formatIsoDate, formatIsoDateTime } from '@/lib/core/dates';
import { formatBRL } from '@/lib/core/money';
import {
  FILE_STATUS_LABELS,
  RELIABILITY_DESCRIPTIONS,
  RELIABILITY_LABELS,
  type FileReliability,
} from '@/lib/domain/entities';
import { sourceLabel } from '@/lib/domain/sources';
import { confirmableFieldsFor } from '@/lib/pipeline/confirmations';
import { loadAuditDataset } from '@/lib/pipeline/process';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Notice, PageHeader } from '@/components/ui/page';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';
import { SpedInspector } from '@/components/domain/sped-inspector';
import { C100DiagnosticPanel } from '@/components/domain/c100-diagnostic';
import { ReprocessFileButton } from '@/components/domain/reprocess-file-button';
import { FieldConfirmationPanel, type ExtractedRow } from '@/components/domain/field-confirmation';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const file = await getStore().getFile(id);
  return { title: file ? `Validação · ${file.originalName}` : 'Validação de arquivo' };
}

const RELIABILITY_TONES: Record<FileReliability, 'success' | 'warning' | 'danger' | 'muted'> = {
  VALIDADO: 'success',
  VALIDADO_COM_ALERTAS: 'warning',
  REQUER_CONFERENCIA: 'warning',
  INCOMPATIVEL: 'danger',
  ERRO: 'danger',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function FileValidationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();

  const file = await store.getFile(id);
  if (!file) notFound();

  const audit = await store.getAudit(file.auditId);
  const company = audit ? await store.getCompany(audit.companyId) : null;
  const isSped = file.detectedSource === 'EFD_ICMS_IPI' || file.detectedSource === 'EFD_CONTRIBUICOES';

  const dataset = await loadAuditDataset(file.auditId);
  const invoices = (dataset?.invoices ?? []).filter((invoice) => invoice.origin.fileId === file.id);
  const declaration = (dataset?.declarations ?? []).find(
    (entry) => entry.origin.fileId === file.id,
  );
  const confirmations = await store.listFieldConfirmations(file.auditId);

  const confirmableRows: ExtractedRow[] = confirmableFieldsFor(file.detectedSource ?? '').map(
    (field) => {
      const extractedField =
        field.key === 'competencia'
          ? declaration?.period.competencia
          : field.key === 'grossRevenue'
            ? declaration?.period.grossRevenue
            : field.key === 'rbt12'
              ? declaration?.period.rbt12
              : declaration?.period.totalDue;

      const value = extractedField?.value ?? null;
      return {
        field,
        extractedValue:
          value === null
            ? null
            : field.type === 'COMPETENCIA'
              ? formatCompetencia(String(value))
              : formatBRL(value as never),
        confidence: extractedField?.confidence ?? 'NAO_IDENTIFICADO',
        evidence: extractedField?.evidence ?? null,
        confirmation:
          confirmations.find(
            (entry) => entry.fileId === file.id && entry.field === field.key,
          ) ?? null,
      };
    },
  );

  return (
    <>
      <PageHeader
        eyebrow="Validação de arquivo"
        title={file.originalName}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={RELIABILITY_TONES[file.reliability]}>
              {RELIABILITY_LABELS[file.reliability]}
            </Badge>
            <span>{FILE_STATUS_LABELS[file.status]}</span>
            {file.parserVersion ? (
              <>
                <span>·</span>
                <span className="font-mono text-xs">parser {file.parserVersion}</span>
              </>
            ) : null}
          </span>
        }
        actions={
          <>
            {audit ? (
              <LinkButton href={`/auditorias/${audit.id}`} variant="secondary">
                Voltar à auditoria
              </LinkButton>
            ) : null}
            <LinkButton href={`/api/arquivos/${file.id}`} variant="secondary">
              Baixar original
            </LinkButton>
          </>
        }
      />

      <div className="mb-4">
        <Notice tone={file.reliability === 'VALIDADO' ? 'success' : file.reliability === 'INCOMPATIVEL' || file.reliability === 'ERRO' ? 'danger' : 'warning'}>
          <p className="font-semibold">{RELIABILITY_LABELS[file.reliability]}</p>
          <p>{RELIABILITY_DESCRIPTIONS[file.reliability]}</p>
        </Notice>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Arquivo identificado"
            description="Leitura automática feita na importação, antes de qualquer cruzamento."
          />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Item
                label="Tipo"
                value={file.detectedSource ? sourceLabel(file.detectedSource) : 'Não identificado'}
              />
              <Item label="Empresa no arquivo" value={file.detectedLegalName ?? 'Não identificada'} />
              <Item
                label="CNPJ no arquivo"
                value={file.detectedTaxId ? formatCnpj(file.detectedTaxId) : 'Não identificado'}
                mono
              />
              <Item
                label="Competência no arquivo"
                value={
                  file.detectedCompetencia && isCompetencia(file.detectedCompetencia)
                    ? formatCompetencia(file.detectedCompetencia)
                    : 'Não identificada'
                }
              />
              <Item label="Data inicial" value={formatIsoDate(file.detectedStartDate)} />
              <Item label="Data final" value={formatIsoDate(file.detectedEndDate)} />
              <Item
                label="Leiaute declarado"
                value={
                  file.parseLog?.unsupportedLayout
                    ? `COD_VER ${file.parseLog.unsupportedLayout.declaredVersion ?? '—'} (não verificado)`
                    : file.inspection
                      ? 'Verificado por este parser'
                      : '—'
                }
              />
              <Item
                label="Linhas / registros"
                value={
                  file.inspection
                    ? `${file.inspection.totalLines.toLocaleString('pt-BR')} / ${file.inspection.totalRecords.toLocaleString('pt-BR')}`
                    : '—'
                }
              />
            </dl>

            {audit && company ? (
              <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
                Auditoria: <strong>{company.legalName}</strong> ·{' '}
                {formatCompetencia(audit.competencia)} · CNPJ cadastrado {formatCnpj(company.cnpj)}.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Integridade e processamento"
            description="Comprova qual arquivo foi auditado."
          />
          <CardBody className="flex flex-col gap-4">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Item label="Nome original" value={file.originalName} />
              <Item label="Tamanho" value={formatBytes(file.sizeBytes)} />
              <Item label="Envio" value={formatIsoDateTime(file.uploadedAt)} />
              <Item label="Processamento" value={formatIsoDateTime(file.processedAt)} />
              <Item label="Versão do parser" value={file.parserVersion ?? '—'} mono />
              <Item label="Tipo MIME" value={file.mimeType ?? '—'} />
            </dl>
            <div>
              <p className="text-[0.625rem] tracking-[0.08em] text-ink-subtle uppercase">SHA-256</p>
              <code className="mt-1 block font-mono text-[0.6875rem] break-all text-ink">
                {file.sha256}
              </code>
            </div>
            <div className="flex justify-end border-t border-line pt-3">
              <ReprocessFileButton fileId={file.id} />
            </div>
          </CardBody>
        </Card>
      </div>

      {(file.messages.length > 0 || file.parseLog) ? (
        <Card className="mt-4">
          <CardHeader
            title="Log de leitura"
            description="Nada é escondido: alertas, erros e registros não mapeados aparecem exatamente como foram produzidos."
          />
          <CardBody className="flex flex-col gap-4">
            {file.parseLog?.unsupportedLayout ? (
              <Notice tone="warning" title="Leiaute não verificado por este parser">
                Versão COD_VER {file.parseLog.unsupportedLayout.declaredVersion ?? 'não informada'} não
                consta na lista validada ({file.parseLog.unsupportedLayout.verifiedVersions.join(', ')}). O
                arquivo foi processado, mas os resultados precisam de conferência.
              </Notice>
            ) : null}

            {file.messages.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {file.messages.map((message, index) => (
                  <li
                    key={`${message.code}-${index}`}
                    className="rounded-md border border-line px-3 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          message.level === 'ERRO'
                            ? 'danger'
                            : message.level === 'ALERTA'
                              ? 'warning'
                              : 'muted'
                        }
                      >
                        {message.level}
                      </Badge>
                      <span className="font-mono text-[0.625rem] text-ink-subtle">{message.code}</span>
                    </div>
                    <p className="mt-1 text-ink">{message.message}</p>
                    {message.detail ? (
                      <p className="mt-0.5 text-ink-muted">{message.detail}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {file.parseLog && file.parseLog.unsupportedRecords.length > 0 ? (
              <div>
                <h3 className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-muted uppercase">
                  Registros presentes e não mapeados por este parser
                </h3>
                <ul className="flex flex-wrap gap-1.5">
                  {file.parseLog.unsupportedRecords.map((entry) => (
                    <li key={entry.code}>
                      <Badge tone="muted">
                        {entry.code} · {entry.count.toLocaleString('pt-BR')}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {confirmableRows.length > 0 ? (
        <Card className="mt-4">
          <CardHeader
            title="Conferência do parsing"
            description="Campos extraídos por padrões de texto. A correção manual atua apenas na camada normalizada — o arquivo original nunca é alterado."
          />
          <CardBody>
            {declaration ? (
              <FieldConfirmationPanel auditId={file.auditId} fileId={file.id} rows={confirmableRows} />
            ) : (
              <p className="text-sm text-ink-muted">
                Processe a auditoria uma vez para que os campos extraídos deste documento apareçam aqui.
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {invoices.length > 0 ? (
        <Card className="mt-4">
          <CardHeader
            title={`Documentos lidos deste arquivo (${invoices.length.toLocaleString('pt-BR')})`}
            description="Resumo técnico do que o parser extraiu, com a origem de cada documento."
          />
          <CardBody className="pb-0">
            <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <Counter label="Total" value={invoices.length} />
              <Counter label="NF-e (55)" value={invoices.filter((i) => i.model === '55').length} />
              <Counter label="NFC-e (65)" value={invoices.filter((i) => i.model === '65').length} />
              <Counter
                label="Autorizadas"
                value={invoices.filter((i) => i.status === 'AUTORIZADA').length}
              />
              <Counter
                label="Canceladas"
                value={invoices.filter((i) => i.status === 'CANCELADA').length}
              />
              <Counter
                label="Denegadas / inutilizadas"
                value={
                  invoices.filter((i) => i.status === 'DENEGADA' || i.status === 'INUTILIZADA').length
                }
              />
            </dl>
            {file.stats ? (
              <p className="mb-4 text-xs text-ink-muted">
                Importação: {file.stats.found.toLocaleString('pt-BR')} encontrados ·{' '}
                {file.stats.processed.toLocaleString('pt-BR')} processados ·{' '}
                {file.stats.duplicated.toLocaleString('pt-BR')} duplicados ·{' '}
                {file.stats.invalid.toLocaleString('pt-BR')} inválidos ·{' '}
                {file.stats.ignored.toLocaleString('pt-BR')} ignorados.
              </p>
            ) : null}
          </CardBody>
          <TableWrapper>
            <thead>
              <tr>
                <Th>Chave</Th>
                <Th>Emitente</Th>
                <Th>Destinatário</Th>
                <Th>Emissão</Th>
                <Th>Mod. / Série / Nº</Th>
                <Th>Situação</Th>
                <Th align="right">Valor</Th>
                <Th>Origem</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.slice(0, 200).map((invoice) => (
                <Tr key={invoice.id}>
                  <Td className="max-w-[12rem] font-mono text-[0.625rem] break-all">
                    {invoice.accessKey ?? '—'}
                  </Td>
                  <Td className="text-xs">
                    {invoice.emitterName ?? '—'}
                    <span className="block font-mono text-[0.625rem] text-ink-subtle">
                      {invoice.emitterTaxId ? formatCnpj(invoice.emitterTaxId) : ''}
                    </span>
                  </Td>
                  <Td className="text-xs">
                    {invoice.recipientName ?? '—'}
                    <span className="block font-mono text-[0.625rem] text-ink-subtle">
                      {invoice.recipientTaxId ? formatCnpj(invoice.recipientTaxId) : ''}
                    </span>
                  </Td>
                  <Td className="text-xs whitespace-nowrap">{formatIsoDate(invoice.issueDate)}</Td>
                  <Td className="text-xs whitespace-nowrap">
                    {invoice.model ?? '—'} / {invoice.serie ?? '—'} / {invoice.number ?? '—'}
                  </Td>
                  <Td>
                    <Badge tone={invoice.status === 'AUTORIZADA' ? 'success' : 'warning'}>
                      {invoice.status}
                    </Badge>
                  </Td>
                  <Td align="right" className="whitespace-nowrap">
                    {formatBRL(invoice.totalValue)}
                  </Td>
                  <Td className="text-[0.625rem] text-ink-muted">
                    {invoice.origin.recordCode ?? '—'}
                    {invoice.origin.lineNumber !== null ? (
                      <span className="block">linha {invoice.origin.lineNumber.toLocaleString('pt-BR')}</span>
                    ) : null}
                    {invoice.origin.entryName ? (
                      <span className="block break-all">{invoice.origin.entryName}</span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
              {invoices.length === 0 ? <EmptyRow colSpan={8}>Nenhum documento lido.</EmptyRow> : null}
            </tbody>
          </TableWrapper>
          {invoices.length > 200 ? (
            <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">
              Exibindo os 200 primeiros documentos. Use a exportação da composição para a lista completa.
            </p>
          ) : null}
        </Card>
      ) : null}

      {isSped ? (
        <>
          <div className="mt-6 mb-3">
            <h2 className="text-lg font-semibold text-ink">Inspeção técnica</h2>
            <p className="text-sm text-ink-muted">
              Conteúdo do arquivo registro a registro, com o nome oficial de cada campo.
            </p>
          </div>
          <SpedInspector fileId={file.id} />

          {file.inspection?.registers.some((register) => register.code === 'C100') ? (
            <div className="mt-4">
              <C100DiagnosticPanel fileId={file.id} />
            </div>
          ) : null}
        </>
      ) : null}

      {audit ? (
        <p className="mt-6 text-xs text-ink-muted">
          Depois de conferir, volte à{' '}
          <Link href={`/auditorias/${audit.id}`} className="font-medium text-navy-700 underline">
            auditoria
          </Link>{' '}
          para executar os cruzamentos.
        </p>
      ) : null}
    </>
  );
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[0.625rem] tracking-[0.08em] text-ink-subtle uppercase">{label}</dt>
      <dd className={'mt-0.5 text-sm text-ink ' + (mono ? 'font-mono text-xs' : '')}>{value}</dd>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <dt className="text-[0.625rem] leading-tight tracking-[0.06em] text-ink-subtle uppercase">{label}</dt>
      <dd className="tabular mt-1 text-lg font-semibold text-ink">{value.toLocaleString('pt-BR')}</dd>
    </div>
  );
}
