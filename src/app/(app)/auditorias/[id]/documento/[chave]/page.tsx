import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { formatCnpj } from '@/lib/core/cnpj';
import { formatCompetencia } from '@/lib/core/competencia';
import { formatIsoDate } from '@/lib/core/dates';
import { absCents, formatBRL, subCents, type Cents } from '@/lib/core/money';
import { describeOrigin, type Invoice } from '@/lib/domain/model';
import { sourceShortLabel } from '@/lib/domain/sources';
import { loadAuditDataset } from '@/lib/pipeline/process';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Notice, PageHeader } from '@/components/ui/page';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';
import { cn } from '@/lib/ui/cn';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Documento — XML × SPED' };

interface ComparisonRow {
  readonly label: string;
  readonly xmlField: string;
  readonly spedField: string;
  readonly xml: string | null;
  readonly sped: string | null;
  readonly difference: string | null;
  readonly differs: boolean;
}

function textRow(
  label: string,
  xmlField: string,
  spedField: string,
  xml: string | null,
  sped: string | null,
): ComparisonRow {
  return {
    label,
    xmlField,
    spedField,
    xml,
    sped,
    difference: null,
    differs: xml !== null && sped !== null && xml !== sped,
  };
}

function moneyRow(
  label: string,
  xmlField: string,
  spedField: string,
  xml: Cents | null,
  sped: Cents | null,
): ComparisonRow {
  const differs = xml !== null && sped !== null && xml !== sped;
  return {
    label,
    xmlField,
    spedField,
    xml: xml === null ? null : formatBRL(xml),
    sped: sped === null ? null : formatBRL(sped),
    difference: differs ? formatBRL(absCents(subCents(xml, sped))) : null,
    differs,
  };
}

function buildRows(xml: Invoice | undefined, sped: Invoice | undefined): ComparisonRow[] {
  return [
    textRow('Chave de acesso', 'infNFe/@Id', 'CHV_NFE', xml?.accessKey ?? null, sped?.accessKey ?? null),
    textRow('Modelo', 'ide/mod', 'COD_MOD', xml?.model ?? null, sped?.model ?? null),
    textRow('Série', 'ide/serie', 'SER', xml?.serie ?? null, sped?.serie ?? null),
    textRow('Número', 'ide/nNF', 'NUM_DOC', xml?.number ?? null, sped?.number ?? null),
    textRow(
      'Data de emissão',
      'ide/dhEmi',
      'DT_DOC',
      xml?.issueDate ? formatIsoDate(xml.issueDate) : null,
      sped?.issueDate ? formatIsoDate(sped.issueDate) : null,
    ),
    textRow(
      'Situação',
      'protNFe/infProt/cStat',
      'COD_SIT',
      xml?.status ?? null,
      sped?.status ?? null,
    ),
    textRow(
      'CFOP predominante',
      'det/prod/CFOP',
      'C170/C190 · CFOP',
      xml?.cfopPrincipal ?? null,
      sped?.cfopPrincipal ?? null,
    ),
    moneyRow('Valor total', 'ICMSTot/vNF', 'VL_DOC', xml?.totals.total ?? null, sped?.totals.total ?? null),
    moneyRow(
      'Valor das mercadorias',
      'ICMSTot/vProd',
      'VL_MERC',
      xml?.totals.produtos ?? null,
      sped?.totals.produtos ?? null,
    ),
    moneyRow(
      'Base de cálculo do ICMS',
      'ICMSTot/vBC',
      'VL_BC_ICMS',
      xml?.totals.baseIcms ?? null,
      sped?.totals.baseIcms ?? null,
    ),
    moneyRow('ICMS', 'ICMSTot/vICMS', 'VL_ICMS', xml?.totals.icms ?? null, sped?.totals.icms ?? null),
    moneyRow(
      'Base do ICMS-ST',
      'ICMSTot/vBCST',
      'VL_BC_ICMS_ST',
      xml?.totals.baseIcmsSt ?? null,
      sped?.totals.baseIcmsSt ?? null,
    ),
    moneyRow(
      'ICMS-ST',
      'ICMSTot/vST',
      'VL_ICMS_ST',
      xml?.totals.icmsSt ?? null,
      sped?.totals.icmsSt ?? null,
    ),
    moneyRow('IPI', 'ICMSTot/vIPI', 'VL_IPI', xml?.totals.ipi ?? null, sped?.totals.ipi ?? null),
    moneyRow('PIS', 'ICMSTot/vPIS', 'VL_PIS', xml?.totals.pis ?? null, sped?.totals.pis ?? null),
    moneyRow(
      'COFINS',
      'ICMSTot/vCOFINS',
      'VL_COFINS',
      xml?.totals.cofins ?? null,
      sped?.totals.cofins ?? null,
    ),
  ];
}

/**
 * Comparação documento a documento entre o XML e a escrituração
 * (fase 2, requisito 7).
 *
 * Cada linha indica o elemento do XML e o campo oficial do SPED que foram
 * comparados, e a origem exata de cada lado — inclusive a linha do arquivo.
 */
export default async function DocumentComparisonPage({
  params,
}: {
  params: Promise<{ id: string; chave: string }>;
}) {
  const { id, chave } = await params;

  const store = getStore();
  const audit = await store.getAudit(id);
  if (!audit) notFound();
  const company = await store.getCompany(audit.companyId);

  const dataset = await loadAuditDataset(id);
  const matching = (dataset?.invoices ?? []).filter((invoice) => invoice.accessKey === chave);

  const xml = matching.find(
    (invoice) => invoice.source === 'XML_NFE' || invoice.source === 'XML_NFCE',
  );
  const sped = matching.find((invoice) => invoice.source === 'EFD_ICMS_IPI');
  const contrib = matching.find((invoice) => invoice.source === 'EFD_CONTRIBUICOES');

  const rows = buildRows(xml, sped);
  const divergences = rows.filter((row) => row.differs);

  return (
    <>
      <PageHeader
        eyebrow={`Competência ${formatCompetencia(audit.competencia)}`}
        title="Documento — XML × escrituração"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs break-all">{chave}</span>
            {company ? (
              <>
                <span>·</span>
                <span>{company.legalName}</span>
              </>
            ) : null}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/auditorias/${id}`} variant="secondary">
              Voltar à auditoria
            </LinkButton>
            <LinkButton href={`/auditorias/${id}/composicao`} variant="secondary">
              Composição
            </LinkButton>
          </>
        }
      />

      {matching.length === 0 ? (
        <EmptyState
          title="Documento não encontrado nesta auditoria"
          description="A chave informada não consta no conjunto normalizado desta competência."
        />
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <SourceCard title="XML" invoice={xml} />
            <SourceCard title="EFD ICMS/IPI" invoice={sped} />
            <SourceCard title="EFD-Contribuições" invoice={contrib} />
          </div>

          {!xml || !sped ? (
            <div className="mb-4">
              <Notice tone="warning" title="Comparação parcial">
                {!xml
                  ? 'O documento não foi encontrado entre os XML importados: a coluna XML fica vazia.'
                  : 'O documento não foi encontrado na EFD ICMS/IPI: a coluna da escrituração fica vazia.'}{' '}
                A ausência de um dos lados é um fato apurado, não uma conclusão sobre a obrigatoriedade da
                escrituração.
              </Notice>
            </div>
          ) : divergences.length === 0 ? (
            <div className="mb-4">
              <Notice tone="success">
                Todos os campos comparados conferem entre o XML e a escrituração.
              </Notice>
            </div>
          ) : (
            <div className="mb-4">
              <Notice tone="warning" title={`${divergences.length} campo(s) com diferença`}>
                As linhas destacadas abaixo apresentam valores diferentes entre as duas origens.
              </Notice>
            </div>
          )}

          <Card>
            <CardHeader
              title="Campos comparados"
              description="Cada linha indica o elemento do XML e o campo oficial do SPED utilizados na comparação."
            />
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Campo</Th>
                  <Th>XML</Th>
                  <Th>EFD ICMS/IPI (C100)</Th>
                  <Th align="right">Diferença</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Tr key={row.label} className={cn(row.differs && 'bg-danger-soft/40')}>
                    <Td>
                      <span className="font-medium text-ink">{row.label}</span>
                    </Td>
                    <Td>
                      <span className="block break-all text-ink">{row.xml ?? '—'}</span>
                      <span className="mt-0.5 block font-mono text-[0.625rem] text-ink-subtle">
                        {row.xmlField}
                      </span>
                    </Td>
                    <Td>
                      <span className="block break-all text-ink">{row.sped ?? '—'}</span>
                      <span className="mt-0.5 block font-mono text-[0.625rem] text-ink-subtle">
                        {row.spedField}
                      </span>
                    </Td>
                    <Td align="right" className="whitespace-nowrap">
                      {row.difference ? (
                        <span className="font-semibold text-danger">{row.difference}</span>
                      ) : row.differs ? (
                        <Badge tone="danger">diferente</Badge>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrapper>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="Itens"
              description="O XML traz o item como emitido; a escrituração traz o item do registro C170. Quando um dos lados não detalha itens, a comparação de CFOP é feita em nível agregado — e isso fica indicado aqui."
            />
            {(xml?.items.length ?? 0) === 0 && (sped?.items.length ?? 0) === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-muted">
                  Nenhum dos lados detalha itens para este documento. O CFOP comparado na tabela acima é o
                  predominante, apurado em nível agregado.
                </p>
              </CardBody>
            ) : (
              <div className="grid gap-0 xl:grid-cols-2">
                <ItemsTable title="Itens do XML" invoice={xml} emptyNote="XML não importado ou sem itens." />
                <ItemsTable
                  title="Itens do C170"
                  invoice={sped}
                  emptyNote="A escrituração não detalha itens (C170 ausente); o CFOP vem do registro analítico C190."
                />
              </div>
            )}
          </Card>

          <p className="mt-4 text-xs text-ink-muted">
            Precisa conferir a linha original?{' '}
            {sped?.origin.fileId ? (
              <Link
                href={`/arquivos/${sped.origin.fileId}`}
                className="font-medium text-navy-700 underline"
              >
                Abrir a validação do arquivo da EFD
              </Link>
            ) : (
              'Abra a validação do arquivo correspondente em Importações.'
            )}
          </p>
        </>
      )}
    </>
  );
}

function SourceCard({ title, invoice }: { title: string; invoice: Invoice | undefined }) {
  return (
    <Card>
      <CardHeader
        title={title}
        action={
          invoice ? (
            <Badge tone="success">encontrado</Badge>
          ) : (
            <Badge tone="muted">não encontrado</Badge>
          )
        }
      />
      <CardBody>
        {invoice ? (
          <dl className="flex flex-col gap-2 text-xs">
            <div>
              <dt className="text-[0.625rem] tracking-[0.08em] text-ink-subtle uppercase">Origem</dt>
              <dd className="mt-0.5 break-all text-ink">{describeOrigin(invoice.origin)}</dd>
            </div>
            <div>
              <dt className="text-[0.625rem] tracking-[0.08em] text-ink-subtle uppercase">Emitente</dt>
              <dd className="mt-0.5 text-ink">
                {invoice.emitterName ?? '—'}
                {invoice.emitterTaxId ? (
                  <span className="block font-mono text-[0.625rem] text-ink-subtle">
                    {formatCnpj(invoice.emitterTaxId)}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-[0.625rem] tracking-[0.08em] text-ink-subtle uppercase">Operação</dt>
              <dd className="mt-0.5 text-ink">
                {invoice.direction} · {sourceShortLabel(invoice.source)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-ink-muted">
            Este documento não foi localizado nesta origem para a competência auditada.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function ItemsTable({
  title,
  invoice,
  emptyNote,
}: {
  title: string;
  invoice: Invoice | undefined;
  emptyNote: string;
}) {
  return (
    <div className="border-t border-line xl:border-t-0 xl:not-last:border-r">
      <p className="border-b border-line bg-navy-50/50 px-5 py-2 text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">
        {title}
      </p>
      <TableWrapper>
        <thead>
          <tr>
            <Th>Item</Th>
            <Th>CFOP</Th>
            <Th>NCM</Th>
            <Th align="right">Valor</Th>
            <Th align="right">ICMS</Th>
          </tr>
        </thead>
        <tbody>
          {!invoice || invoice.items.length === 0 ? (
            <EmptyRow colSpan={5}>{emptyNote}</EmptyRow>
          ) : (
            invoice.items.map((item) => (
              <Tr key={`${item.numero}-${item.codigo ?? ''}`}>
                <Td className="text-xs">
                  <span className="font-medium text-ink">{item.numero}</span>
                  <span className="block text-ink-muted">{item.descricao ?? item.codigo ?? '—'}</span>
                </Td>
                <Td className="font-mono text-xs">{item.cfop ?? '—'}</Td>
                <Td className="font-mono text-xs">{item.ncm ?? '—'}</Td>
                <Td align="right" className="whitespace-nowrap">
                  {formatBRL(item.valorProduto)}
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  {formatBRL(item.icms)}
                </Td>
              </Tr>
            ))
          )}
        </tbody>
      </TableWrapper>
    </div>
  );
}
