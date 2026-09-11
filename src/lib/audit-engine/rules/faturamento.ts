/**
 * Regras ATT-FAT-*: conciliação de faturamento entre obrigações.
 *
 * Duas garantias desta fase estão implementadas aqui:
 *
 * 1. **Composição explícita.** O faturamento nunca é "a soma das saídas": cada
 *    documento é classificado pela Política de Receita e o resultado mostra o
 *    que entrou, o que saiu e o que aguarda classificação.
 * 2. **Sem conclusão sem base.** Se houver documento pendente de classificação,
 *    ou se a receita do PGDAS-D não tiver sido identificada ou confirmada, a
 *    regra devolve NÃO VERIFICADO com o motivo — jamais uma divergência
 *    calculada sobre dados incompletos.
 */

import { formatBRL, sumCents, type Cents } from '@/lib/core/money';
import { formatCompetencia } from '@/lib/core/competencia';
import type { DataSourceKind } from '@/lib/domain/sources';
import type { RecordOrigin } from '@/lib/domain/model';
import type { AuditDataset } from '@/lib/normalization/dataset';
import { invoicesFrom, xmlInvoices } from '@/lib/normalization/dataset';
import { composeRevenue, type RevenueComposition, type RevenuePolicy } from '../revenue-composition';
import { compareValues } from '../tolerance';
import { DEFAULT_TOLERANCE, type AuditRule, type RuleContext, type RuleResult } from '../types';
import { evidence, isEffective, moneyEvidence } from './helpers';

export type RevenueSourceKey = 'XML' | 'EFD_ICMS_IPI' | 'EFD_CONTRIBUICOES' | 'PGDAS_D';

export interface RevenueFigure {
  readonly amount: Cents;
  readonly description: string;
  readonly source: DataSourceKind;
  readonly origin: RecordOrigin | null;
  readonly documentCount: number | null;
  /** Presente quando o valor vem de documentos classificados um a um. */
  readonly composition: RevenueComposition | null;
}

/** Motivo pelo qual um faturamento não pôde ser apurado. */
export interface RevenueUnavailable {
  readonly label: string;
  readonly reason: string;
}

export type RevenueOutcome =
  | { readonly ok: true; readonly figure: RevenueFigure }
  | { readonly ok: false; readonly unavailable: RevenueUnavailable };

const SOURCE_LABELS: Readonly<Record<RevenueSourceKey, string>> = {
  XML: 'Faturamento pelos documentos fiscais (XML)',
  EFD_ICMS_IPI: 'Faturamento pela EFD ICMS/IPI',
  EFD_CONTRIBUICOES: 'Receita apurada na EFD-Contribuições',
  PGDAS_D: 'Receita bruta declarada no PGDAS-D',
};

export function revenueLabel(key: RevenueSourceKey): string {
  return SOURCE_LABELS[key];
}

/** Compõe a receita a partir dos documentos de uma origem. */
export function revenueFromDocuments(
  dataset: AuditDataset,
  key: Exclude<RevenueSourceKey, 'PGDAS_D'>,
  policy: RevenuePolicy,
): RevenueOutcome {
  const invoices =
    key === 'XML'
      ? xmlInvoices(dataset).filter(isEffective)
      : invoicesFrom(dataset, key).filter(isEffective);
  const extra = key === 'XML' ? [] : dataset.revenues.filter((revenue) => revenue.source === key);

  if (invoices.length === 0 && extra.length === 0) {
    return {
      ok: false,
      unavailable: {
        label: SOURCE_LABELS[key],
        reason: 'Nenhum documento desta origem foi importado nesta auditoria.',
      },
    };
  }

  const documentLabel =
    key === 'XML'
      ? 'documentos XML'
      : key === 'EFD_ICMS_IPI'
        ? 'documentos escriturados (C100)'
        : 'documentos escriturados (C100/A100)';

  const composition = composeRevenue(invoices, policy, documentLabel);

  if (composition.hasPendingReview) {
    return {
      ok: false,
      unavailable: {
        label: SOURCE_LABELS[key],
        reason:
          `${composition.review.length} documento(s), somando ${formatBRL(composition.reviewAmount)}, ` +
          'aguardam classificação de CFOP na Política de Receita. Enquanto houver documentos em ' +
          'revisão, o faturamento desta origem não pode ser apurado sem risco de conclusão indevida.',
      },
    };
  }

  const extraAmount = sumCents(extra.map((revenue) => revenue.amount));
  const total = (composition.includedAmount + extraAmount) as Cents;
  const description =
    composition.description +
    (extra.length > 0
      ? ` Somados ${formatBRL(extraAmount)} de outras operações declaradas como receita: ` +
        extra.map((revenue) => revenue.description).join(' ')
      : '');

  return {
    ok: true,
    figure: {
      amount: total,
      description,
      source: key === 'XML' ? 'XML_NFE' : key,
      origin: invoices[0]?.origin ?? extra[0]?.origin ?? null,
      documentCount: composition.included.length,
      composition,
    },
  };
}

/**
 * Receita declarada no PGDAS-D.
 *
 * Só é considerada quando a extração tem confiança alta — o que acontece
 * automaticamente, quando o parser reconhece o campo, ou após a confirmação
 * manual do auditor. Um valor de confiança média jamais alimenta uma conclusão.
 */
export function revenueFromPgdasd(dataset: AuditDataset): RevenueOutcome {
  const declaration = dataset.declarations.find((entry) => entry.source === 'PGDAS_D');
  const record = dataset.revenues.find((revenue) => revenue.source === 'PGDAS_D');

  if (!declaration && !record) {
    return {
      ok: false,
      unavailable: {
        label: SOURCE_LABELS.PGDAS_D,
        reason: 'Nenhum PGDAS-D foi importado nesta auditoria.',
      },
    };
  }

  if (!record || declaration?.period.grossRevenue.value === null) {
    return {
      ok: false,
      unavailable: {
        label: SOURCE_LABELS.PGDAS_D,
        reason:
          'A receita bruta do PGDAS-D não foi identificada no documento. ' +
          'Confirme o valor na validação do arquivo antes de executar este cruzamento.',
      },
    };
  }

  const confidence = declaration?.period.grossRevenue.confidence ?? 'NAO_IDENTIFICADO';
  if (confidence !== 'ALTA') {
    return {
      ok: false,
      unavailable: {
        label: SOURCE_LABELS.PGDAS_D,
        reason:
          `A receita bruta do PGDAS-D foi extraída com confiança ${confidence.toLowerCase()} e ainda ` +
          'não foi confirmada. Confirme o valor na validação do arquivo antes de executar este cruzamento.',
      },
    };
  }

  return {
    ok: true,
    figure: {
      amount: record.amount,
      description: record.description,
      source: 'PGDAS_D',
      origin: record.origin,
      documentCount: null,
      composition: null,
    },
  };
}

interface RevenueRuleSpec {
  readonly id: string;
  readonly codigo: string;
  readonly nome: string;
  readonly descricao: string;
  readonly gravidade: AuditRule['gravidade'];
  readonly documentosNecessarios: readonly DataSourceKind[];
  readonly limitacoes: string;
  readonly originKey: RevenueSourceKey;
  readonly targetKey: RevenueSourceKey;
  readonly analiseHumana: string;
}

function resolve(
  dataset: AuditDataset,
  key: RevenueSourceKey,
  policy: RevenuePolicy,
): RevenueOutcome {
  return key === 'PGDAS_D'
    ? revenueFromPgdasd(dataset)
    : revenueFromDocuments(dataset, key, policy);
}

function revenueRule(spec: RevenueRuleSpec): AuditRule {
  return {
    id: spec.id,
    codigo: spec.codigo,
    nome: spec.nome,
    descricao: spec.descricao,
    modulo: 'FATURAMENTO',
    gravidade: spec.gravidade,
    documentosNecessarios: spec.documentosNecessarios,
    toleranciaPadrao: DEFAULT_TOLERANCE,
    limitacoes: spec.limitacoes,
    executar(context: RuleContext): RuleResult {
      const origin = resolve(context.dataset, spec.originKey, context.revenuePolicy);
      const target = resolve(context.dataset, spec.targetKey, context.revenuePolicy);

      if (!origin.ok || !target.ok) {
        const motivos = [
          ...(origin.ok ? [] : [`${origin.unavailable.label}: ${origin.unavailable.reason}`]),
          ...(target.ok ? [] : [`${target.unavailable.label}: ${target.unavailable.reason}`]),
        ];
        return {
          cruzamentosCorretos: 0,
          findings: [
            {
              resultado: 'NAO_VERIFICADO',
              natureza: 'FATO',
              titulo: `${spec.codigo}: cruzamento não executado`,
              descricao: motivos.join(' '),
              analiseHumana:
                'Um cruzamento que não pode ser executado não é evidência de conformidade nem de erro. ' +
                'Resolva os pontos acima e reprocesse a auditoria.',
              evidencias: motivos.map((motivo, index) =>
                evidence(`Motivo ${index + 1}`, 'Verificação de pré-requisitos da regra', motivo),
              ),
            },
          ],
          naoAplicavel: motivos.join(' '),
        };
      }

      const comparison = compareValues(
        origin.figure.amount,
        target.figure.amount,
        context.config.tolerancia,
      );

      const evidencias = [
        moneyEvidence(revenueLabel(spec.originKey), origin.figure.description, origin.figure.amount, {
          source: origin.figure.source,
          from: origin.figure.origin,
        }),
        moneyEvidence(revenueLabel(spec.targetKey), target.figure.description, target.figure.amount, {
          source: target.figure.source,
          from: target.figure.origin,
        }),
        evidence('Competência', 'Competência da auditoria', formatCompetencia(context.dataset.competencia)),
        evidence('Tolerância', 'Configuração da regra', comparison.toleranceLabel),
      ];

      for (const [key, outcome] of [
        [spec.originKey, origin],
        [spec.targetKey, target],
      ] as const) {
        if (!outcome.ok || !outcome.figure.composition) continue;
        const composition = outcome.figure.composition;
        evidencias.push(
          evidence(
            `Composição — ${revenueLabel(key)}`,
            'Classificação documento a documento pela Política de Receita',
            `${composition.included.length} incluídos · ${composition.excluded.length} excluídos · ` +
              `${composition.review.length} em revisão`,
            { source: outcome.figure.source },
          ),
        );
      }

      if (comparison.withinTolerance) {
        return { cruzamentosCorretos: 1, findings: [] };
      }

      return {
        cruzamentosCorretos: 0,
        findings: [
          {
            resultado: 'DIVERGENCIA',
            natureza: 'INDICIO',
            titulo: spec.nome,
            descricao:
              `${revenueLabel(spec.originKey)}: ${formatBRL(comparison.origin)}. ` +
              `${revenueLabel(spec.targetKey)}: ${formatBRL(comparison.target)}. ` +
              `Diferença de ${formatBRL(comparison.difference)}.`,
            rotuloOrigem: revenueLabel(spec.originKey),
            valorOrigem: comparison.origin,
            rotuloDestino: revenueLabel(spec.targetKey),
            valorDestino: comparison.target,
            diferenca: comparison.difference,
            analiseHumana: spec.analiseHumana,
            evidencias,
          },
        ],
      };
    },
  };
}

export const attFat001 = revenueRule({
  id: 'att-fat-001',
  codigo: 'ATT-FAT-001',
  nome: 'Faturamento apurado pelos documentos fiscais diferente do PGDAS-D',
  descricao:
    'Compara a receita composta a partir dos documentos fiscais de saída (XML) com a receita bruta do ' +
    'período informada no PGDAS-D.',
  gravidade: 'CRITICA',
  documentosNecessarios: ['XML_NFE', 'PGDAS_D'],
  limitacoes:
    'A composição da receita segue a Política de Receita configurada pela organização. O sistema não ' +
    'decide sozinho quais operações integram a receita bruta: enquanto houver CFOP não classificado, a ' +
    'regra não é executada.',
  originKey: 'XML',
  targetKey: 'PGDAS_D',
  analiseHumana:
    'Confira a composição documento a documento e a classificação dos CFOPs antes de concluir por ' +
    'omissão de receita.',
});

export const attFat002 = revenueRule({
  id: 'att-fat-002',
  codigo: 'ATT-FAT-002',
  nome: 'Faturamento da EFD ICMS/IPI diferente do PGDAS-D',
  descricao:
    'Compara a receita composta a partir dos documentos de saída escriturados na EFD ICMS/IPI com a ' +
    'receita bruta informada no PGDAS-D.',
  gravidade: 'ALTA',
  documentosNecessarios: ['EFD_ICMS_IPI', 'PGDAS_D'],
  limitacoes:
    'A EFD ICMS/IPI escritura operações por sua natureza fiscal, que não coincide necessariamente com a ' +
    'composição da receita bruta declarada. A diferença é um fato numérico e não um erro presumido.',
  originKey: 'EFD_ICMS_IPI',
  targetKey: 'PGDAS_D',
  analiseHumana:
    'Verifique a composição por CFOP do somatório da EFD antes de concluir por omissão de receita.',
});

export const attFat003 = revenueRule({
  id: 'att-fat-003',
  codigo: 'ATT-FAT-003',
  nome: 'Faturamento da EFD-Contribuições diferente do PGDAS-D',
  descricao: 'Compara a receita apurada na EFD-Contribuições com a receita bruta informada no PGDAS-D.',
  gravidade: 'ALTA',
  documentosNecessarios: ['EFD_CONTRIBUICOES', 'PGDAS_D'],
  limitacoes:
    'Empresas do Simples Nacional em regra não entregam EFD-Contribuições; a presença simultânea dos dois ' +
    'arquivos deve ser confirmada antes de qualquer conclusão. As bases das duas obrigações também não ' +
    'são idênticas.',
  originKey: 'EFD_CONTRIBUICOES',
  targetKey: 'PGDAS_D',
  analiseHumana:
    'Confirme se a empresa está obrigada às duas entregas na competência e compare as bases utilizadas ' +
    'em cada uma.',
});

export const attFat004 = revenueRule({
  id: 'att-fat-004',
  codigo: 'ATT-FAT-004',
  nome: 'Faturamento pelos documentos fiscais diferente da receita da EFD-Contribuições',
  descricao:
    'Compara a receita composta a partir dos documentos fiscais de saída (XML) com a receita apurada na ' +
    'EFD-Contribuições.',
  gravidade: 'ALTA',
  documentosNecessarios: ['XML_NFE', 'EFD_CONTRIBUICOES'],
  limitacoes:
    'A EFD-Contribuições alcança receitas que não se documentam por NF-e (registros F100, por exemplo) e ' +
    'pode excluir operações que constam no XML. A diferença isolada não caracteriza omissão.',
  originKey: 'XML',
  targetKey: 'EFD_CONTRIBUICOES',
  analiseHumana:
    'Verifique receitas sem documento fiscal eletrônico e operações do XML sem natureza de receita antes ' +
    'de concluir.',
});

export const FATURAMENTO_RULES: readonly AuditRule[] = [attFat001, attFat002, attFat003, attFat004];
