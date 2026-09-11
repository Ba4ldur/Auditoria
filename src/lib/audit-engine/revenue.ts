/**
 * Revenue computed from fiscal documents.
 *
 * This is the point where an arithmetic fact ends and a tax judgement begins,
 * so the policy is explicit and parameterisable (requirement 35):
 *
 *  - only OUTGOING documents of the audited company are considered;
 *  - cancelled, denied and voided documents are excluded;
 *  - CFOPs listed in `cfopExclusions` are excluded.
 *
 * The system does NOT decide by itself which operations compose the taxable
 * revenue: transfers, returns, remittances and other operations may or may not
 * be part of it depending on the regime and on the nature of the operation.
 * The default exclusion list is empty and every figure carries the breakdown by
 * CFOP so the auditor can see exactly what was summed.
 */

import { addCents, formatBRL, sumCents, ZERO, type Cents } from '@/lib/core/money';
import type { DocumentStatus, Invoice } from '@/lib/domain/model';

export interface RevenuePolicy {
  /** CFOPs excluded from the revenue figure. Empty by default, on purpose. */
  readonly cfopExclusions: readonly string[];
  /** Statuses excluded from the revenue figure. */
  readonly excludedStatuses: readonly DocumentStatus[];
}

export const DEFAULT_REVENUE_POLICY: RevenuePolicy = Object.freeze({
  cfopExclusions: [] as readonly string[],
  excludedStatuses: ['CANCELADA', 'DENEGADA', 'INUTILIZADA'] as readonly DocumentStatus[],
});

export interface RevenueComputation {
  readonly amount: Cents;
  readonly documentCount: number;
  readonly excludedByStatus: number;
  readonly excludedByCfop: number;
  readonly cfopBreakdown: readonly { cfop: string; amount: Cents; count: number }[];
  /** Sentence describing exactly how `amount` was obtained (requirement 21). */
  readonly description: string;
}

export function computeRevenueFromInvoices(
  invoices: readonly Invoice[],
  policy: RevenuePolicy = DEFAULT_REVENUE_POLICY,
  label = 'documentos fiscais',
): RevenueComputation {
  const excludedStatuses = new Set(policy.excludedStatuses);
  const excludedCfops = new Set(policy.cfopExclusions);

  const considered: Invoice[] = [];
  let excludedByStatus = 0;
  let excludedByCfop = 0;

  for (const invoice of invoices) {
    if (invoice.direction !== 'SAIDA') continue;
    if (excludedStatuses.has(invoice.status)) {
      excludedByStatus += 1;
      continue;
    }
    if (invoice.cfopPrincipal && excludedCfops.has(invoice.cfopPrincipal)) {
      excludedByCfop += 1;
      continue;
    }
    considered.push(invoice);
  }

  const amount = sumCents(considered.map((invoice) => invoice.totalValue));

  const breakdown = new Map<string, { amount: Cents; count: number }>();
  for (const invoice of considered) {
    const cfop = invoice.cfopPrincipal ?? 'sem CFOP';
    const current = breakdown.get(cfop) ?? { amount: ZERO, count: 0 };
    breakdown.set(cfop, {
      amount: addCents(current.amount, invoice.totalValue),
      count: current.count + 1,
    });
  }

  const cfopBreakdown = [...breakdown.entries()]
    .map(([cfop, value]) => ({ cfop, amount: value.amount, count: value.count }))
    .sort((a, b) => b.amount - a.amount);

  const notes: string[] = [];
  if (excludedByStatus > 0) {
    notes.push(`${excludedByStatus} documento(s) excluido(s) por situação (cancelado/denegado/inutilizado)`);
  }
  if (excludedByCfop > 0) {
    notes.push(`${excludedByCfop} documento(s) excluido(s) pelos CFOPs configurados`);
  }

  const description =
    `Somatório do valor total de ${considered.length} ${label} considerados como saída: ${formatBRL(amount)}.` +
    (notes.length > 0 ? ` ${notes.join('; ')}.` : '');

  return {
    amount,
    documentCount: considered.length,
    excludedByStatus,
    excludedByCfop,
    cfopBreakdown,
    description,
  };
}
