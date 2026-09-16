import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { formatCnpj } from '@/lib/core/cnpj';
import { formatCompetencia } from '@/lib/core/competencia';
import { loadAuditDataset } from '@/lib/pipeline/process';
import { buildSample } from '@/lib/validation/sampling';
import {
  COVERAGE_LEVEL_LABELS,
  buildTechnicalPanel,
  buildValidationReport,
  documentCoverage,
  tallyCoverage,
  type CoverageTally,
} from '@/lib/validation/technical';
import {
  DOCUMENT_VALIDATION_LABELS,
  RELIABILITY_LABELS,
  type AuditFile,
  type DocumentValidation,
} from '@/lib/domain/entities';
import { sourceShortLabel } from '@/lib/domain/sources';
import type { CoverageLevel } from '@/lib/parsers/sped/efd-icms-ipi/coverage';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, Notice, PageHeader } from '@/components/ui/page';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Validação técnica do motor' };

const COVERAGE_TONES: Readonly<Record<CoverageLevel, BadgeTone>> = {
  SUPORTADO: 'success',
  PARCIALMENTE_SUPORTADO: 'gold',
  NAO_SUPORTADO: 'danger',
};

/** Contagem por registro gravada na inspeção do arquivo. */
function registersOf(file: AuditFile): { code: string; count: number }[] {
  const inspection = file.inspection as
    | { registers?: { code: string; count: number }[] }
    | null;
  return inspection?.registers ?? [];
}

/**
 * Validação técnica do motor (fase 4).
 *
 * **Esta tela não é o relatório de auditoria.** O relatório responde "a
 * escrituração desta empresa está correta?". Aqui a pergunta é anterior e
 * diferente: "o sistema leu os arquivos corretamente e cruzou o que deveria
 * cruzar?". Por isso tudo aparece em termos de leitura e cobertura — contagens
 * de registros, versões de parser, o que foi interpretado e o que ficou de fora
 * — e nunca em termos de conformidade fiscal.
 */
export default async function ValidationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const store = getStore();
  const audit = await store.getAudit(id);
  if (!audit) notFound();

  const company = await store.getCompany(audit.companyId);
  if (!company) notFound();

  const [files, dataset, findingsPage, validations] = await Promise.all([
    store.listFiles(id),
    loadAuditDataset(id),
    store.listFindings({ auditId: id, limit: 500 }),
    store.listDocumentValidations(id),
  ]);

  if (!dataset) {
    return (
      <>
        <PageHeader
          eyebrow={`Competência ${formatCompetencia(audit.competencia)}`}
          title="Validação técnica do motor"
          description={company.legalName}
          actions={
            <LinkButton href={`/auditorias/${id}`} variant="secondary">
              Voltar à auditoria
            </LinkButton>
          }
        />
        <EmptyState
          title="Auditoria ainda não processada"
          description="Importe os arquivos da competência e execute a auditoria antes de validar o motor."
        />
      </>
    );
  }

  const panel = buildTechnicalPanel({
    company,
    competencia: audit.competencia,
    files,
    dataset,
  });

  const spedFiles = files.filter(
    (file) => file.detectedSource === 'EFD_ICMS_IPI' || file.detectedSource === 'EFD_CONTRIBUICOES',
  );
  const tallies = spedFiles.map((file) => ({
    file,
    tally: tallyCoverage(registersOf(file)),
  }));
  const combined: CoverageTally = tallyCoverage(
    Object.entries(
      tallies
        .flatMap((entry) => entry.tally.registers)
        .reduce<Record<string, number>>((acc, entry) => {
          acc[entry.code] = (acc[entry.code] ?? 0) + entry.count;
          return acc;
        }, {}),
    ).map(([code, count]) => ({ code, count })),
  );

  const coverage = documentCoverage({
    efdDocuments: panel.counts.efdDocuments,
    registers: combined.registers,
  });

  const sample = buildSample(dataset, findingsPage.items);
  const validationByKey = new Map<string, DocumentValidation>(
    validations.map((entry) => [entry.accessKey, entry]),
  );

  const report = buildValidationReport({
    documentsAnalysed: panel.counts.xmlDocuments + panel.counts.efdDocuments,
    validations,
    coverage,
    tally: combined,
  });

  return (
    <>
      <PageHeader
        eyebrow={`Competência ${formatCompetencia(audit.competencia)}`}
        title="Validação técnica do motor"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{company.legalName}</span>
            <span>·</span>
            <span className="font-mono text-xs">{formatCnpj(company.cnpj)}</span>
          </span>
        }
        actions={
          <>
            <LinkButton href={`/auditorias/${id}`} variant="secondary">
              Voltar à auditoria
            </LinkButton>
            <LinkButton href={`/auditorias/${id}/relatorio`} variant="secondary">
              Relatório de auditoria
            </LinkButton>
          </>
        }
      />

      <Notice tone="info">
        Esta tela confere o <strong>motor</strong>, não a escrituração. Ela responde se o sistema leu
        os arquivos corretamente e cruzou o que deveria cruzar. O julgamento sobre a conformidade
        fiscal da empresa está no relatório de auditoria.
      </Notice>

      {/* ------------------------------------------------ 1. Identificação */}
      <Card className="mt-6">
        <CardHeader
          title="Arquivos, identidade e versões"
          description="O que cada arquivo declara sobre si mesmo, e com qual leitor foi interpretado."
        />
        <CardBody>
          <TableWrapper>
            <thead>
              <Tr>
                <Th>Arquivo</Th>
                <Th>Tipo</Th>
                <Th>CNPJ no arquivo</Th>
                <Th>Competência</Th>
                <Th>Leiaute</Th>
                <Th>Parser</Th>
                <Th>Confiabilidade</Th>
              </Tr>
            </thead>
            <tbody>
              {panel.files.length === 0 ? (
                <EmptyRow colSpan={7}>Nenhum arquivo importado nesta competência.</EmptyRow>
              ) : (
                panel.files.map((file) => (
                  <Tr key={file.fileId}>
                    <Td>
                      <Link
                        href={`/arquivos/${file.fileId}`}
                        className="font-medium text-navy-700 underline"
                      >
                        {file.fileName}
                      </Link>
                    </Td>
                    <Td>{file.source ? sourceShortLabel(file.source) : '—'}</Td>
                    <Td className="font-mono text-xs">
                      {file.taxIdInFile ? formatCnpj(file.taxIdInFile) : '—'}
                    </Td>
                    <Td>
                      {file.competenciaInFile ? formatCompetencia(file.competenciaInFile) : '—'}
                    </Td>
                    <Td className="font-mono text-xs">{file.layoutVersion ?? '—'}</Td>
                    <Td className="font-mono text-xs">
                      {file.parserVersion ? `v${file.parserVersion}` : '—'}
                    </Td>
                    <Td>
                      <Badge tone={file.reliability === 'VALIDADO' ? 'success' : 'gold'}>
                        {RELIABILITY_LABELS[file.reliability]}
                      </Badge>
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </TableWrapper>

          <dl className="mt-4 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="CNPJ da empresa auditada" value={formatCnpj(panel.company.cnpj)} />
            <Stat
              label="CNPJ encontrados nos XML"
              value={panel.taxIdsInXml.map(formatCnpj).join(' · ') || '—'}
              hint="Emitentes e destinatários dos documentos importados."
            />
            <Stat
              label="CNPJ encontrado na EFD"
              value={panel.taxIdsInEfd.map(formatCnpj).join(' · ') || '—'}
            />
            <Stat label="Arquivos XML" value={String(panel.counts.xmlFiles)} />
            <Stat label="Documentos no XML" value={String(panel.counts.xmlDocuments)} />
            <Stat label="Registros C100" value={String(panel.counts.efdDocuments)} />
            <Stat label="Itens C170 lidos" value={String(panel.counts.efdItems)} />
            <Stat
              label="CFOP analíticos (C190)"
              value={String(panel.counts.efdAnalytics)}
              hint="CFOPs distintos consolidados nos documentos."
            />
            <Stat
              label="Tipos de registro não suportados"
              value={String(combined.byLevel.NAO_SUPORTADO.types)}
            />
          </dl>
        </CardBody>
      </Card>

      {/* ------------------------------------------------ 2. Cobertura */}
      {tallies.map(({ file, tally }) => (
        <Card className="mt-4" key={file.id}>
          <CardHeader
            title={`Registros encontrados — ${file.originalName}`}
            description={
              `${tally.totalTypes} tipos de registro, ${tally.totalRecords.toLocaleString('pt-BR')} registros. ` +
              'Um registro não interpretado é parte da escrituração que não participou de nenhum cruzamento.'
            }
          />
          <CardBody>
            <div className="mb-3 flex flex-wrap gap-2">
              {(Object.keys(COVERAGE_LEVEL_LABELS) as CoverageLevel[]).map((level) => (
                <Badge key={level} tone={COVERAGE_TONES[level]}>
                  {COVERAGE_LEVEL_LABELS[level]}: {tally.byLevel[level].types} tipos ·{' '}
                  {tally.byLevel[level].records.toLocaleString('pt-BR')} registros
                </Badge>
              ))}
            </div>

            <TableWrapper>
              <thead>
                <Tr>
                  <Th>Registro</Th>
                  <Th align="right">Ocorrências</Th>
                  <Th>Cobertura</Th>
                  <Th>O que isso significa</Th>
                </Tr>
              </thead>
              <tbody>
                {tally.registers.length === 0 ? (
                  <EmptyRow colSpan={4}>
                    A inspeção deste arquivo ainda não foi gravada. Reprocesse o arquivo.
                  </EmptyRow>
                ) : (
                  tally.registers.map((entry) => (
                    <Tr key={entry.code}>
                      <Td>
                        <span className="font-mono text-xs text-navy-700">{entry.code}</span>
                        <span className="block text-[0.625rem] text-ink-muted">
                          {entry.description}
                        </span>
                      </Td>
                      <Td align="right" className="tabular">
                        {entry.count.toLocaleString('pt-BR')}
                      </Td>
                      <Td>
                        <Badge tone={COVERAGE_TONES[entry.level]}>
                          {COVERAGE_LEVEL_LABELS[entry.level]}
                        </Badge>
                      </Td>
                      <Td className="text-[0.6875rem] text-ink-muted">{entry.detail}</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </TableWrapper>
          </CardBody>
        </Card>
      ))}

      {/* ------------------------------------------------ 3. Amostra */}
      <Card className="mt-4">
        <CardHeader
          title="Amostra para conferência"
          description={
            `${sample.documents.length} documento(s) de ${sample.population} selecionados por estrato. ` +
            'A seleção é determinística: a mesma auditoria produz sempre a mesma amostra, para que a ' +
            'conferência possa ser feita ao longo de vários dias.'
          }
        />
        <CardBody>
          <div className="mb-4 flex flex-wrap gap-2">
            {sample.strata.map((stratum) => (
              <Badge
                key={stratum.stratum}
                tone={stratum.population === 0 ? 'muted' : stratum.selected < stratum.target ? 'gold' : 'info'}
              >
                {stratum.label}: {stratum.selected} de {stratum.population}
                {stratum.population === 0 ? ' (inexistente nesta competência)' : ''}
              </Badge>
            ))}
          </div>

          <TableWrapper>
            <thead>
              <Tr>
                <Th>Documento</Th>
                <Th>Presente em</Th>
                <Th>Estratos</Th>
                <Th>Regras que se pronunciaram</Th>
                <Th>Conferência</Th>
              </Tr>
            </thead>
            <tbody>
              {sample.documents.length === 0 ? (
                <EmptyRow colSpan={5}>
                  Nenhum documento com chave de acesso nesta competência.
                </EmptyRow>
              ) : (
                sample.documents.map((document) => {
                  const validation = validationByKey.get(document.accessKey) ?? null;
                  return (
                    <Tr key={document.accessKey}>
                      <Td>
                        <Link
                          href={`/auditorias/${id}/documento/${document.accessKey}`}
                          className="font-medium text-navy-700 underline"
                        >
                          {document.describe}
                        </Link>
                        <span className="block font-mono text-[0.625rem] break-all text-ink-subtle">
                          {document.accessKey}
                        </span>
                      </Td>
                      <Td className="text-xs">
                        {[document.xml ? 'XML' : null, document.efd ? 'EFD' : null]
                          .filter(Boolean)
                          .join(' + ')}
                      </Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          {document.strata.map((stratum) => (
                            <Badge key={stratum} tone="muted">
                              {stratum.toLowerCase().replace(/_/g, ' ')}
                            </Badge>
                          ))}
                        </span>
                      </Td>
                      <Td className="font-mono text-[0.625rem]">
                        {document.ruleCodes.join(', ') || '—'}
                      </Td>
                      <Td>
                        {validation ? (
                          <Badge tone={validation.status === 'CORRETO' ? 'success' : 'gold'}>
                            {DOCUMENT_VALIDATION_LABELS[validation.status]}
                          </Badge>
                        ) : (
                          <span className="text-xs text-ink-subtle">pendente</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </tbody>
          </TableWrapper>
        </CardBody>
      </Card>

      {/* ------------------------------------------------ 4. Relatório */}
      <Card className="mt-4">
        <CardHeader
          title="Validação técnica do motor"
          description="Resumo do que foi analisado, do que foi conferido por uma pessoa e do que ficou fora."
        />
        <CardBody>
          <dl className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Documentos analisados" value={String(report.documentsAnalysed)} />
            <Stat label="Conferidos manualmente" value={String(report.manuallyChecked)} />
            <Stat label="Corretos" value={String(report.correct)} />
            <Stat label="Erros de leitura do arquivo" value={String(report.parserDefects)} />
            <Stat label="Erros de cruzamento" value={String(report.crossCheckDefects)} />
            <Stat label="Requerem análise" value={String(report.requiresAnalysis)} />
            <Stat label="Tipos de registro encontrados" value={String(report.registerTypes)} />
            <Stat
              label="Suportados / parciais / não suportados"
              value={`${report.registerTypesSupported} / ${report.registerTypesPartial} / ${report.registerTypesUnsupported}`}
            />
            <Stat
              label="Cobertura documental"
              value={
                report.coverage.percentage === null
                  ? 'não calculável'
                  : `${report.coverage.percentage}%`
              }
              hint={report.coverage.basis}
            />
          </dl>

          <div className="mt-4">
            <Notice tone={report.parserDefects + report.crossCheckDefects > 0 ? 'danger' : 'info'}>
              {report.veredito}
            </Notice>
          </div>

          <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-muted">
            Enquanto a conferência não for feita sobre XML e EFD reais da mesma empresa e
            competência, o estado do motor permanece <strong>validado em runtime com fixtures</strong>.
            Conferir uma amostra real permite dizer <strong>validado com amostra fiscal real</strong>,
            o que ainda não significa validado para todos os cenários tributários.
          </p>
        </CardBody>
      </Card>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="text-[0.625rem] leading-tight text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold break-words text-ink">{value}</dd>
      {hint ? <p className="mt-1 text-[0.625rem] leading-relaxed text-ink-subtle">{hint}</p> : null}
    </div>
  );
}
