/**
 * Composição explícita da receita (fase 2, requisitos 5, 6, 17, 18 e 23).
 *
 * A regra anterior — "somar as notas de saída" — é uma suposição tributária, e
 * este módulo existe para eliminá-la. Cada documento recebe um tratamento
 * declarado (INCLUIR, EXCLUIR ou REVISAR) com o motivo correspondente, e o
 * resultado sempre apresenta os três grupos separadamente.
 *
 * O sistema não cria tratamento fiscal. Sem regra configurada para o CFOP, o
 * documento fica em REVISAR: ele aparece, com o valor, esperando a decisão do
 * profissional responsável. Documentos em revisão **nunca** são somados à
 * receita considerada nem descartados em silêncio.
 */

import { addCents, formatBRL, sumCents, ZERO, type Cents } from '@/lib/core/money';
import type { CfopRule, CfopTreatment } from '@/lib/domain/entities';
import type { DocumentStatus, Invoice, RecordOrigin } from '@/lib/domain/model';

export interface RevenuePolicy {
  /** Tratamento por CFOP, configurado pela organização. */
  readonly rules: ReadonlyMap<string, CfopRule>;
  /** Situações de documento sem efeito de faturamento. */
  readonly ineffectiveStatuses: readonly DocumentStatus[];
}

export const DEFAULT_INEFFECTIVE_STATUSES: readonly DocumentStatus[] = Object.freeze([
  'CANCELADA',
  'DENEGADA',
  'INUTILIZADA',
]);

/** Política vazia: nenhum CFOP classificado, tudo em revisão. */
export const EMPTY_REVENUE_POLICY: RevenuePolicy = Object.freeze({
  rules: new Map<string, CfopRule>(),
  ineffectiveStatuses: DEFAULT_INEFFECTIVE_STATUSES,
});

export function policyFromRules(rules: readonly CfopRule[]): RevenuePolicy {
  return {
    rules: new Map(rules.map((rule) => [rule.cfop, rule])),
    ineffectiveStatuses: DEFAULT_INEFFECTIVE_STATUSES,
  };
}

export interface CompositionEntry {
  readonly invoiceId: string;
  readonly accessKey: string | null;
  readonly number: string | null;
  readonly serie: string | null;
  readonly issueDate: string | null;
  readonly cfop: string | null;
  readonly amount: Cents;
  readonly status: DocumentStatus;
  readonly treatment: CfopTreatment;
  /** Por que o documento recebeu este tratamento, em palavras verificáveis. */
  readonly reason: string;
  readonly origin: RecordOrigin;
}

export interface RevenueComposition {
  /** Receita considerada: somatório apenas dos documentos com tratamento INCLUIR. */
  readonly includedAmount: Cents;
  readonly excludedAmount: Cents;
  /** Valor pendente de classificação. Nunca somado, nunca escondido. */
  readonly reviewAmount: Cents;
  readonly included: readonly CompositionEntry[];
  readonly excluded: readonly CompositionEntry[];
  readonly review: readonly CompositionEntry[];
  readonly cfopBreakdown: readonly CfopBreakdown[];
  /** Frase que descreve a composição, usada nas evidências. */
  readonly description: string;
  /** Verdadeiro quando há documentos aguardando classificação. */
  readonly hasPendingReview: boolean;
}

export interface CfopBreakdown {
  readonly cfop: string;
  readonly treatment: CfopTreatment;
  readonly count: number;
  readonly amount: Cents;
  readonly description: string | null;
}

const MISSING_CFOP = 'sem CFOP';

function classify(
  invoice: Invoice,
  policy: RevenuePolicy,
): { treatment: CfopTreatment; reason: string } {
  if (policy.ineffectiveStatuses.includes(invoice.status)) {
    return {
      treatment: 'EXCLUIR',
      reason: `Documento com situação ${invoice.status.toLowerCase()}, sem efeito de faturamento.`,
    };
  }

  const cfop = invoice.cfopPrincipal;
  if (!cfop) {
    return {
      treatment: 'REVISAR',
      reason: 'Documento sem CFOP identificado; o tratamento não pode ser determinado automaticamente.',
    };
  }

  const rule = policy.rules.get(cfop);
  if (!rule) {
    return {
      treatment: 'REVISAR',
      reason:
        `CFOP ${cfop} ainda não classificado na Política de Receita. ` +
        'O sistema não define tratamento tributário por conta própria.',
    };
  }

  if (rule.treatment === 'INCLUIR') {
    return {
      treatment: 'INCLUIR',
      reason: rule.reason ?? `CFOP ${cfop} classificado como receita na Política de Receita.`,
    };
  }
  if (rule.treatment === 'EXCLUIR') {
    return {
      treatment: 'EXCLUIR',
      reason: rule.reason ?? `CFOP ${cfop} excluído da receita pela Política de Receita.`,
    };
  }
  return {
    treatment: 'REVISAR',
    reason: rule.reason ?? `CFOP ${cfop} marcado para revisão na Política de Receita.`,
  };
}

function toEntry(
  invoice: Invoice,
  classification: { treatment: CfopTreatment; reason: string },
): CompositionEntry {
  return {
    invoiceId: invoice.id,
    accessKey: invoice.accessKey,
    number: invoice.number,
    serie: invoice.serie,
    issueDate: invoice.issueDate,
    cfop: invoice.cfopPrincipal,
    amount: invoice.totalValue,
    status: invoice.status,
    treatment: classification.treatment,
    reason: classification.reason,
    origin: invoice.origin,
  };
}

/**
 * Compõe a receita a partir dos documentos de saída.
 *
 * Documentos de entrada são simplesmente ignorados: não fazem parte da
 * discussão de faturamento e apareceriam como ruído na conferência.
 */
export function composeRevenue(
  invoices: readonly Invoice[],
  policy: RevenuePolicy,
  label = 'documentos fiscais',
): RevenueComposition {
  const included: CompositionEntry[] = [];
  const excluded: CompositionEntry[] = [];
  const review: CompositionEntry[] = [];
  const breakdown = new Map<string, { treatment: CfopTreatment; count: number; amount: Cents }>();

  for (const invoice of invoices) {
    if (invoice.direction !== 'SAIDA') continue;
    const classification = classify(invoice, policy);
    const entry = toEntry(invoice, classification);

    if (classification.treatment === 'INCLUIR') included.push(entry);
    else if (classification.treatment === 'EXCLUIR') excluded.push(entry);
    else review.push(entry);

    const key = invoice.cfopPrincipal ?? MISSING_CFOP;
    const current = breakdown.get(key) ?? {
      treatment: classification.treatment,
      count: 0,
      amount: ZERO,
    };
    breakdown.set(key, {
      treatment: classification.treatment,
      count: current.count + 1,
      amount: addCents(current.amount, invoice.totalValue),
    });
  }

  const includedAmount = sumCents(included.map((entry) => entry.amount));
  const excludedAmount = sumCents(excluded.map((entry) => entry.amount));
  const reviewAmount = sumCents(review.map((entry) => entry.amount));

  const parts = [
    `${included.length} ${label} incluídos na receita, somando ${formatBRL(includedAmount)}`,
  ];
  if (excluded.length > 0) {
    parts.push(`${excluded.length} excluídos (${formatBRL(excludedAmount)})`);
  }
  if (review.length > 0) {
    parts.push(`${review.length} aguardando classificação (${formatBRL(reviewAmount)})`);
  }

  return {
    includedAmount,
    excludedAmount,
    reviewAmount,
    included,
    excluded,
    review,
    cfopBreakdown: [...breakdown.entries()]
      .map(([cfop, value]) => ({
        cfop,
        treatment: value.treatment,
        count: value.count,
        amount: value.amount,
        description: policy.rules.get(cfop)?.description ?? null,
      }))
      .sort((a, b) => b.amount - a.amount),
    description: `${parts.join('; ')}.`,
    hasPendingReview: review.length > 0,
  };
}
