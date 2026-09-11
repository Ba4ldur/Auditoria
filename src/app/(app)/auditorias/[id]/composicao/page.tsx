import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { formatCompetencia } from '@/lib/core/competencia';
import { formatIsoDate } from '@/lib/core/dates';
import { formatBRL } from '@/lib/core/money';
import { CFOP_TREATMENT_LABELS, type CfopTreatment } from '@/lib/domain/entities';
import { describeOrigin } from '@/lib/domain/model';
import { COMPOSITION_LABELS, loadCompositions, type CompositionKey } from '@/lib/queries/composition';
import type { CompositionEntry } from '@/lib/audit-engine';
import { LinkButton } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Notice, PageHeader } from '@/components/ui/page';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Composição da receita' };

const TREATMENT_TONES: Record<CfopTreatment, 'success' | 'muted' | 'warning'> = {
  INCLUIR: 'success',
  EXCLUIR: 'muted',
  REVISAR: 'warning',
};

const EXPORT_TYPES: Record<CompositionKey, string> = {
  XML: 'receita-xml',
  EFD_ICMS_IPI: 'receita-efd',
  EFD_CONTRIBUICOES: 'receita-efd-contribuicoes',
};

/**
 * "Como este valor foi calculado?" (fase 2, requisito 18).
 *
 * Mostra a composição documento a documento: o que entrou na receita, o que foi
 * excluído e o que aguarda classificação — cada linha com o motivo e a origem.
 */
export default async function CompositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ origem?: string }>;
}) {
  const { id } = await params;
  const { origem } = await searchParams;

  const store = getStore();
  const audit = await store.getAudit(id);
  if (!audit) notFound();
  const company = await store.getCompany(audit.companyId);

  const result = await loadCompositions(id);
  const keys = [...(result?.compositions.keys() ?? [])];
  const selected = (origem && keys.includes(origem as CompositionKey)
    ? (origem as CompositionKey)
    : keys[0]) as CompositionKey | undefined;
  const composition = selected ? result?.compositions.get(selected) : undefined;

  return (
    <>
      <PageHeader
        eyebrow={`Competência ${formatCompetencia(audit.competencia)}`}
        title="Composição da receita"
        description={
          company
            ? `${company.legalName} — classificação documento a documento pela Política de Receita.`
            : undefined
        }
        actions={
          <>
            <LinkButton href={`/auditorias/${id}`} variant="secondary">
              Voltar à auditoria
            </LinkButton>
            <LinkButton href="/configuracoes/politica-receita" variant="secondary">
              Política de Receita
            </LinkButton>
          </>
        }
      />

      {keys.length === 0 || !composition || !selected ? (
        <EmptyState
          title="Nenhum documento para compor"
          description="Importe e processe os arquivos da competência para ver a composição da receita."
        />
      ) : (
        <>
          <nav className="mb-4 flex flex-wrap gap-2">
            {keys.map((key) => (
              <Link
                key={key}
                href={`/auditorias/${id}/composicao?origem=${key}`}
                className={
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ' +
                  (key === selected
                    ? 'border-navy-700 bg-navy-800 text-white'
                    : 'border-line-strong bg-white text-navy-700 hover:bg-navy-50')
                }
              >
                {COMPOSITION_LABELS[key as CompositionKey]}
              </Link>
            ))}
          </nav>

          {composition.hasPendingReview ? (
            <div className="mb-4">
              <Notice tone="warning" title="Documentos aguardando classificação">
                {composition.review.length} documento(s), somando{' '}
                {formatBRL(composition.reviewAmount)}, estão com CFOP não classificado. Enquanto houver
                documentos em revisão, as regras de faturamento reportam NÃO VERIFICADO em vez de calcular
                uma diferença sobre dados incompletos.
              </Notice>
            </div>
          ) : null}

          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <Summary
              label="Receita considerada"
              value={formatBRL(composition.includedAmount)}
              count={composition.included.length}
              tone="success"
            />
            <Summary
              label="Excluído da receita"
              value={formatBRL(composition.excludedAmount)}
              count={composition.excluded.length}
              tone="muted"
            />
            <Summary
              label="Em revisão"
              value={formatBRL(composition.reviewAmount)}
              count={composition.review.length}
              tone="warning"
            />
          </div>

          <Card className="mb-4">
            <CardHeader
              title="Composição por CFOP"
              description="Agrupamento dos documentos de saída pelo CFOP predominante."
            />
            <TableWrapper>
              <thead>
                <tr>
                  <Th>CFOP</Th>
                  <Th>Descrição</Th>
                  <Th>Tratamento</Th>
                  <Th align="right">Documentos</Th>
                  <Th align="right">Valor</Th>
                </tr>
              </thead>
              <tbody>
                {composition.cfopBreakdown.map((entry) => (
                  <Tr key={entry.cfop}>
                    <Td className="font-mono text-xs">{entry.cfop}</Td>
                    <Td className="text-xs text-ink-muted">{entry.description ?? '—'}</Td>
                    <Td>
                      <Badge tone={TREATMENT_TONES[entry.treatment]}>
                        {CFOP_TREATMENT_LABELS[entry.treatment]}
                      </Badge>
                    </Td>
                    <Td align="right">{entry.count.toLocaleString('pt-BR')}</Td>
                    <Td align="right" className="whitespace-nowrap">
                      {formatBRL(entry.amount)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrapper>
          </Card>

          <Card>
            <CardHeader
              title="Documentos"
              description="Cada linha mostra o tratamento aplicado, o motivo e a origem exata do valor."
              action={
                <LinkButton
                  href={`/api/auditorias/${id}/exportar?tipo=${EXPORT_TYPES[selected]}`}
                  variant="secondary"
                  size="sm"
                >
                  Exportar CSV
                </LinkButton>
              }
            />
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Tratamento</Th>
                  <Th>Documento</Th>
                  <Th>CFOP</Th>
                  <Th align="right">Valor</Th>
                  <Th>Motivo</Th>
                  <Th>Origem</Th>
                </tr>
              </thead>
              <tbody>
                {[...composition.review, ...composition.included, ...composition.excluded].length === 0 ? (
                  <EmptyRow colSpan={6}>Nenhum documento de saída nesta origem.</EmptyRow>
                ) : (
                  [...composition.review, ...composition.included, ...composition.excluded]
                    .slice(0, 500)
                    .map((entry) => <EntryRow key={entry.invoiceId} auditId={id} entry={entry} />)
                )}
              </tbody>
            </TableWrapper>
            {composition.included.length + composition.excluded.length + composition.review.length >
            500 ? (
              <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">
                Exibindo os 500 primeiros documentos. Use a exportação em CSV para a lista completa.
              </p>
            ) : null}
          </Card>
        </>
      )}
    </>
  );
}

function EntryRow({ auditId, entry }: { auditId: string; entry: CompositionEntry }) {
  return (
    <Tr>
      <Td>
        <Badge tone={TREATMENT_TONES[entry.treatment]}>
          {CFOP_TREATMENT_LABELS[entry.treatment]}
        </Badge>
      </Td>
      <Td className="text-xs">
        {entry.accessKey ? (
          <Link
            href={`/auditorias/${auditId}/documento/${entry.accessKey}`}
            className="font-mono text-[0.625rem] break-all text-navy-700 hover:underline"
          >
            {entry.accessKey}
          </Link>
        ) : (
          <span className="text-ink-subtle">sem chave</span>
        )}
        <span className="mt-0.5 block text-ink-muted">
          nº {entry.number ?? '—'} · série {entry.serie ?? '—'} · {formatIsoDate(entry.issueDate)}
        </span>
      </Td>
      <Td className="font-mono text-xs">{entry.cfop ?? '—'}</Td>
      <Td align="right" className="whitespace-nowrap">
        {formatBRL(entry.amount)}
      </Td>
      <Td className="max-w-sm text-xs text-ink-muted">{entry.reason}</Td>
      <Td className="text-[0.625rem] text-ink-subtle">{describeOrigin(entry.origin)}</Td>
    </Tr>
  );
}

function Summary({
  label,
  value,
  count,
  tone,
}: {
  label: string;
  value: string;
  count: number;
  tone: 'success' | 'muted' | 'warning';
}) {
  const accents = {
    success: 'before:bg-success',
    muted: 'before:bg-navy-300',
    warning: 'before:bg-warning',
  } as const;

  return (
    <article
      className={
        'relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 ' +
        'shadow-[var(--shadow-card)] before:absolute before:top-0 before:left-0 before:h-full before:w-1 ' +
        'before:content-[""] ' +
        accents[tone]
      }
    >
      <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</p>
      <p className="tabular mt-2 text-2xl leading-none font-semibold text-ink">{value}</p>
      <p className="mt-2 text-xs text-ink-muted">{count.toLocaleString('pt-BR')} documento(s)</p>
    </article>
  );
}
