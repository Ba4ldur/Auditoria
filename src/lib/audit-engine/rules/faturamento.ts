/**
 * Rules ATT-FAT-*: revenue reconciliation across obligations.
 *
 * Every figure compared here is accompanied by the sentence describing how it
 * was obtained, because a revenue difference is only auditable when the auditor
 * can see what was summed (requirement 21).
 *
 * None of these rules concludes that a difference is an error: operations that
 * do not compose revenue, different measurement bases between obligations and
 * regime-specific treatments are legitimate causes of divergence.
 */

import { formatBRL, sumCents, type Cents } from '@/lib/core/money';
import { formatCompetencia } from '@/lib/core/competencia';
import type { DataSourceKind } from '@/lib/domain/sources';
import type { AuditDataset } from '@/lib/normalization/dataset';
import { invoicesFrom, xmlInvoices } from '@/lib/normalization/dataset';
import { computeRevenueFromInvoices, type RevenueComputation, type RevenuePolicy } from '../revenue';
import { compareValues } from '../tolerance';
import { DEFAULT_TOLERANCE, type AuditRule, type RuleContext, type RuleResult } from '../types';
import { evidence, isEffective, moneyEvidence } from './helpers';

export interface RevenueFigure {
  readonly amount: Cents;
  readonly description: string;
  readonly source: DataSourceKind;
  readonly fileName: string | null;
  readonly documentCount: number | null;
}

/** Revenue derived from the documents of a given source. */
function revenueFromDocuments(
  dataset: AuditDataset,
  source: 'XML' | 'EFD_ICMS_IPI' | 'EFD_CONTRIBUICOES',
  policy: RevenuePolicy,
): RevenueFigure | null {
  if (source === 'XML') {
    const invoices = xmlInvoices(dataset).filter(isEffective);
    if (invoices.length === 0) return null;
    const computation = computeRevenueFromInvoices(invoices, policy, 'documentos XML');
    return toFigure(computation, 'XML_NFE', invoices[0]?.fileName ?? null);
  }

  const invoices = invoicesFrom(dataset, source).filter(isEffective);
  const extra = dataset.revenues.filter((revenue) => revenue.source === source);
  if (invoices.length === 0 && extra.length === 0) return null;

  const computation = computeRevenueFromInvoices(
    invoices,
    policy,
    source === 'EFD_ICMS_IPI' ? 'documentos escriturados (C100)' : 'documentos escriturados (C100/A100)',
  );
  const extraAmount = sumCents(extra.map((revenue) => revenue.amount));
  const total = (computation.amount + extraAmount) as Cents;

  const description =
    computation.description +
    (extra.length > 0
      ? ` Somados ${formatBRL(extraAmount)} de outras operações declaradas como receita: ` +
        extra.map((revenue) => revenue.description).join(' ')
      : '');

  return {
    amount: total,
    description,
    source,
    fileName: invoices[0]?.fileName ?? extra[0]?.fileName ?? null,
    documentCount: computation.documentCount,
  };
}

function toFigure(
  computation: RevenueComputation,
  source: DataSourceKind,
  fileName: string | null,
): RevenueFigure {
  return {
    amount: computation.amount,
    description: computation.description,
    source,
    fileName,
    documentCount: computation.documentCount,
  };
}

/** Revenue as declared in the PGDAS-D. */
function revenueFromPgdasd(dataset: AuditDataset): RevenueFigure | null {
  const record = dataset.revenues.find((revenue) => revenue.source === 'PGDAS_D');
  if (!record) return null;
  return {
    amount: record.amount,
    description: record.description,
    source: 'PGDAS_D',
    fileName: record.fileName,
    documentCount: null,
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
  readonly originLabel: string;
  readonly targetLabel: string;
  readonly analiseHumana: string;
  readonly origin: (dataset: AuditDataset, policy: RevenuePolicy) => RevenueFigure | null;
  readonly target: (dataset: AuditDataset, policy: RevenuePolicy) => RevenueFigure | null;
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
      const origin = spec.origin(context.dataset, context.revenuePolicy);
      const target = spec.target(context.dataset, context.revenuePolicy);

      if (!origin || !target) {
        const missing = [!origin ? spec.originLabel : null, !target ? spec.targetLabel : null]
          .filter((value): value is string => value !== null)
          .join(' e ');
        return {
          cruzamentosCorretos: 0,
          findings: [
            {
              resultado: 'NAO_VERIFICADO',
              natureza: 'FATO',
              titulo: `${spec.codigo}: cruzamento não executado`,
              descricao: `Não foi possível apurar ${missing} com os arquivos importados nesta auditoria.`,
              evidencias: [],
            },
          ],
          naoAplicavel: `Faturamento não apurado: ${missing}.`,
        };
      }

      const comparison = compareValues(origin.amount, target.amount, context.config.tolerancia);
      const evidencias = [
        moneyEvidence(spec.originLabel, origin.description, origin.amount, {
          source: origin.source,
          fileName: origin.fileName,
        }),
        moneyEvidence(spec.targetLabel, target.description, target.amount, {
          source: target.source,
          fileName: target.fileName,
        }),
        evidence('Competência', 'Competência da auditoria', formatCompetencia(context.dataset.competencia)),
        evidence('Tolerância', 'Configuração da regra', comparison.toleranceLabel),
      ];

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
              `${spec.originLabel}: ${formatBRL(comparison.origin)}. ${spec.targetLabel}: ${formatBRL(comparison.target)}. ` +
              `Diferença de ${formatBRL(comparison.difference)}.`,
            rotuloOrigem: spec.originLabel,
            valorOrigem: comparison.origin,
            rotuloDestino: spec.targetLabel,
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
    'Compara o somatório dos documentos fiscais de saída (XML) com a receita bruta do período informada no PGDAS-D.',
  gravidade: 'CRITICA',
  documentosNecessarios: ['XML_NFE', 'PGDAS_D'],
  limitacoes:
    'Os dois valores medem coisas diferentes por construcao: o somatório de documentos inclui toda operação de saída ' +
    'documentada, enquanto a receita bruta declarada segue as regras de composição da receita aplicáveis ao regime. ' +
    'Devoluções, transferências, remessas e operações sem natureza de receita explicam diferenças legitimas.',
  originLabel: 'Faturamento pelos documentos fiscais (XML)',
  targetLabel: 'Receita bruta declarada no PGDAS-D',
  analiseHumana:
    'Confira quais CFOPs compoem o somatório dos documentos e se ha operações que não integram a receita bruta. ' +
    'Os CFOPs a excluir do cálculo podem ser parametrizados em Configurações.',
  origin: (dataset, policy) => revenueFromDocuments(dataset, 'XML', policy),
  target: revenueFromPgdasd,
});

export const attFat002 = revenueRule({
  id: 'att-fat-002',
  codigo: 'ATT-FAT-002',
  nome: 'Faturamento da EFD ICMS/IPI diferente do PGDAS-D',
  descricao:
    'Compara o somatório dos documentos de saída escriturados na EFD ICMS/IPI com a receita bruta informada no PGDAS-D.',
  gravidade: 'ALTA',
  documentosNecessarios: ['EFD_ICMS_IPI', 'PGDAS_D'],
  limitacoes:
    'A EFD ICMS/IPI escritura operações por sua natureza fiscal, que não coincide necessariamente com a composição ' +
    'da receita bruta declarada. A diferença é um fato numérico e não um erro presumido.',
  originLabel: 'Faturamento pela EFD ICMS/IPI',
  targetLabel: 'Receita bruta declarada no PGDAS-D',
  analiseHumana:
    'Verifique a composição por CFOP do somatório da EFD antes de concluir por omissão de receita.',
  origin: (dataset, policy) => revenueFromDocuments(dataset, 'EFD_ICMS_IPI', policy),
  target: revenueFromPgdasd,
});

export const attFat003 = revenueRule({
  id: 'att-fat-003',
  codigo: 'ATT-FAT-003',
  nome: 'Faturamento da EFD-Contribuições diferente do PGDAS-D',
  descricao:
    'Compara a receita apurada na EFD-Contribuições com a receita bruta informada no PGDAS-D.',
  gravidade: 'ALTA',
  documentosNecessarios: ['EFD_CONTRIBUICOES', 'PGDAS_D'],
  limitacoes:
    'Empresas do Simples Nacional em regra não entregam EFD-Contribuições; a presença simultânea dos dois arquivos ' +
    'deve ser confirmada antes de qualquer conclusão. As bases das duas obrigações também não são idênticas.',
  originLabel: 'Receita apurada na EFD-Contribuições',
  targetLabel: 'Receita bruta declarada no PGDAS-D',
  analiseHumana:
    'Confirme se a empresa esta obrigada as duas entregas na competência e compare as bases utilizadas em cada uma.',
  origin: (dataset, policy) => revenueFromDocuments(dataset, 'EFD_CONTRIBUICOES', policy),
  target: revenueFromPgdasd,
});

export const attFat004 = revenueRule({
  id: 'att-fat-004',
  codigo: 'ATT-FAT-004',
  nome: 'Faturamento pelos documentos fiscais diferente da receita da EFD-Contribuições',
  descricao:
    'Compara o somatório dos documentos fiscais de saída (XML) com a receita apurada na EFD-Contribuições.',
  gravidade: 'ALTA',
  documentosNecessarios: ['XML_NFE', 'EFD_CONTRIBUICOES'],
  limitacoes:
    'A EFD-Contribuições alcanca receitas que não se documentam por NF-e (registros F100, por exemplo) e pode ' +
    'excluir operações que constam no XML. A diferença isolada não caracteriza omissão.',
  originLabel: 'Faturamento pelos documentos fiscais (XML)',
  targetLabel: 'Receita apurada na EFD-Contribuições',
  analiseHumana:
    'Verifique receitas sem documento fiscal eletrônico e operações do XML sem natureza de receita antes de concluir.',
  origin: (dataset, policy) => revenueFromDocuments(dataset, 'XML', policy),
  target: (dataset, policy) => revenueFromDocuments(dataset, 'EFD_CONTRIBUICOES', policy),
});

export const FATURAMENTO_RULES: readonly AuditRule[] = [attFat001, attFat002, attFat003, attFat004];
