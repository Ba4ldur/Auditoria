/**
 * Monetary comparison with configurable tolerance (requirement 18).
 *
 * Fiscal files are rounded at different points of the calculation chain, so a
 * difference of a few cents on a document with dozens of items is an artefact
 * of rounding, not an inconsistency. The tolerance is per rule and always
 * reported alongside the comparison, so the auditor sees why a difference was
 * or was not raised.
 */

import { absCents, formatBRL, subCents, type Cents } from '@/lib/core/money';
import type { RuleTolerance } from './types';

export interface Comparison {
  readonly origin: Cents;
  readonly target: Cents;
  readonly difference: Cents;
  readonly withinTolerance: boolean;
  /** Human-readable description of the tolerance that was applied. */
  readonly toleranceLabel: string;
}

export function compareValues(origin: Cents, target: Cents, tolerance: RuleTolerance): Comparison {
  const difference = subCents(origin, target);
  const magnitude = absCents(difference);
  const reference = Math.max(Math.abs(origin), Math.abs(target));
  const percentageAllowance = Math.round((reference * tolerance.percentageTolerance) / 100);
  const allowance = Math.max(tolerance.absoluteTolerance, percentageAllowance);

  return {
    origin,
    target,
    difference,
    withinTolerance: magnitude <= allowance,
    toleranceLabel: describeTolerance(tolerance, allowance as Cents),
  };
}

function describeTolerance(tolerance: RuleTolerance, applied: Cents): string {
  const parts: string[] = [`absoluta ${formatBRL(tolerance.absoluteTolerance)}`];
  if (tolerance.percentageTolerance > 0) {
    parts.push(`percentual ${tolerance.percentageTolerance.toLocaleString('pt-BR')}%`);
  }
  return `Tolerância ${parts.join(' / ')} (aplicada: ${formatBRL(applied)}).`;
}
