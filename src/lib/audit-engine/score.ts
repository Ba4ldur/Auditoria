/**
 * Conformity score (requirement 23).
 *
 * Starts at 100 and subtracts the weight of each finding that requires action.
 * Weights are per severity and configurable per organization; the score is
 * clamped at zero. `NAO_APLICAVEL` and `NAO_VERIFICADO` findings never affect
 * the score: a check that could not run is not evidence of non-conformity.
 */

import { DEFAULT_SCORE_WEIGHTS, type ConformityBand, type ScoreWeights, type Severity } from '@/lib/domain/entities';

const PENALISED_STATUSES = new Set(['DIVERGENCIA', 'ALERTA']);

export interface ScoreInput {
  readonly status: string;
  readonly severity: Severity;
}

export interface ScoreResult {
  readonly score: number;
  readonly band: ConformityBand;
  readonly penalty: number;
  readonly breakdown: Readonly<Record<Severity, number>>;
}

export function computeScore(
  findings: readonly ScoreInput[],
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ScoreResult {
  const breakdown: Record<Severity, number> = { INFO: 0, BAIXA: 0, MEDIA: 0, ALTA: 0, CRITICA: 0 };
  let penalty = 0;

  for (const finding of findings) {
    if (!PENALISED_STATUSES.has(finding.status)) continue;
    breakdown[finding.severity] += 1;
    penalty += weights[finding.severity];
  }

  const score = Math.max(0, 100 - penalty);
  return { score, band: bandFor(score), penalty, breakdown };
}

export function bandFor(score: number): ConformityBand {
  if (score >= 90) return 'EXCELENTE';
  if (score >= 75) return 'BOM';
  if (score >= 50) return 'ATENCAO';
  return 'CRITICO';
}

export const BAND_LABELS: Readonly<Record<ConformityBand, string>> = {
  EXCELENTE: 'Excelente',
  BOM: 'Bom',
  ATENCAO: 'Atenção',
  CRITICO: 'Crítico',
};
