/**
 * Exportação em CSV das composições e dos resultados (fase 2, requisito 19).
 *
 * Cada exportação inclui a origem de cada linha — arquivo, registro e número da
 * linha — para que a planilha continue conferível fora do sistema.
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/guard';
import { describeError } from '@/lib/core/result';
import { formatIsoDate } from '@/lib/core/dates';
import { formatCompetencia } from '@/lib/core/competencia';
import { getStore } from '@/lib/data';
import { buildCsv, csvMoney, csvResponseHeaders, type CsvCell } from '@/lib/reports/csv';
import { CFOP_TREATMENT_LABELS, SEVERITY_LABELS, FINDING_STATUS_LABELS, REVIEW_STATUS_LABELS } from '@/lib/domain/entities';
import { loadCompositions, type CompositionKey } from '@/lib/queries/composition';
import { describeOrigin } from '@/lib/domain/model';
import type { CompositionEntry } from '@/lib/audit-engine';

export const runtime = 'nodejs';
export const maxDuration = 120;

const COMPOSITION_TYPES: Readonly<Record<string, CompositionKey>> = {
  'receita-xml': 'XML',
  'receita-efd': 'EFD_ICMS_IPI',
  'receita-efd-contribuicoes': 'EFD_CONTRIBUICOES',
};

const COMPOSITION_HEADERS = [
  'Tratamento',
  'Chave de acesso',
  'Serie',
  'Numero',
  'Emissao',
  'CFOP',
  'Situacao',
  'Valor',
  'Motivo',
  'Arquivo',
  'Registro',
  'Linha',
];

function compositionRow(entry: CompositionEntry): CsvCell[] {
  return [
    CFOP_TREATMENT_LABELS[entry.treatment],
    entry.accessKey,
    entry.serie,
    entry.number,
    entry.issueDate ? formatIsoDate(entry.issueDate) : '',
    entry.cfop,
    entry.status,
    csvMoney(entry.amount),
    entry.reason,
    entry.origin.entryName ?? entry.origin.fileName,
    entry.origin.recordCode,
    entry.origin.lineNumber,
  ];
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const { id } = await context.params;
  const tipo = new URL(request.url).searchParams.get('tipo') ?? '';

  const store = getStore();
  const audit = await store.getAudit(id);
  if (!audit) return NextResponse.json({ error: 'Auditoria não encontrada.' }, { status: 404 });

  const slug = `${formatCompetencia(audit.competencia).replace('/', '-')}`;

  try {
    if (tipo in COMPOSITION_TYPES) {
      const result = await loadCompositions(id);
      const composition = result?.compositions.get(COMPOSITION_TYPES[tipo]!);
      if (!composition) {
        return NextResponse.json({ error: 'Composição não disponível.' }, { status: 404 });
      }
      const rows = [
        ...composition.included.map(compositionRow),
        ...composition.excluded.map(compositionRow),
        ...composition.review.map(compositionRow),
      ];
      return new NextResponse(buildCsv(COMPOSITION_HEADERS, rows), {
        headers: csvResponseHeaders(`${tipo}-${slug}.csv`),
      });
    }

    if (tipo === 'documentos-em-revisao') {
      const result = await loadCompositions(id);
      const rows = [...(result?.compositions.values() ?? [])].flatMap((composition) =>
        composition.review.map(compositionRow),
      );
      return new NextResponse(buildCsv(COMPOSITION_HEADERS, rows), {
        headers: csvResponseHeaders(`documentos-em-revisao-${slug}.csv`),
      });
    }

    if (tipo === 'divergencias' || tipo === 'nao-encontrados') {
      const page = await store.listFindings({ auditId: id, limit: 5000 });
      const findings =
        tipo === 'nao-encontrados'
          ? page.items.filter(
              (finding) => finding.ruleCode === 'ATT-FIS-001' || finding.ruleCode === 'ATT-FIS-002',
            )
          : page.items.filter((finding) => finding.status === 'DIVERGENCIA' || finding.status === 'ALERTA');

      const rows: CsvCell[][] = findings.map((finding) => [
        finding.ruleCode,
        finding.ruleName,
        finding.ruleVersion,
        finding.title,
        FINDING_STATUS_LABELS[finding.status],
        SEVERITY_LABELS[finding.severity],
        finding.nature,
        finding.documentRef,
        finding.originLabel,
        csvMoney(finding.originValue),
        finding.targetLabel,
        csvMoney(finding.targetValue),
        csvMoney(finding.difference),
        REVIEW_STATUS_LABELS[finding.reviewStatus],
        finding.evidence.map((item) => `${item.label}: ${describeEvidence(item)}`).join(' | '),
      ]);

      return new NextResponse(
        buildCsv(
          [
            'Codigo',
            'Regra',
            'Versao da regra',
            'Ocorrencia',
            'Resultado',
            'Gravidade',
            'Natureza',
            'Documento',
            'Rotulo origem',
            'Valor origem',
            'Rotulo destino',
            'Valor destino',
            'Diferenca',
            'Situacao da analise',
            'Evidencias',
          ],
          rows,
        ),
        { headers: csvResponseHeaders(`${tipo}-${slug}.csv`) },
      );
    }

    return NextResponse.json({ error: `Tipo de exportação desconhecido: ${tipo}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

function describeEvidence(item: {
  value: string | null;
  fileName: string | null;
  recordCode: string | null;
  fieldName: string | null;
  lineNumber: number | null;
  parserVersion: string | null;
}): string {
  const origin = describeOrigin({
    fileId: null,
    fileName: item.fileName,
    recordCode: item.recordCode,
    lineNumber: item.lineNumber,
    entryName: null,
  });
  const detail = [
    origin,
    ...(item.fieldName ? [`campo ${item.fieldName}`] : []),
    ...(item.parserVersion ? [`leitor v${item.parserVersion}`] : []),
  ].join(' · ');
  return `${item.value ?? ''} (${detail})`;
}
