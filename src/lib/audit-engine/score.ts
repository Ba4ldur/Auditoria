/**
 * Score de conformidade (requisito 23).
 *
 * # Fórmula
 *
 * ```
 * penalidade  = Σ  peso[gravidade] × fator(natureza)
 *              ocorrências que exigem ação
 *
 * fator(FATO)    = 1
 * fator(INDICIO) = indicioFactor   (padrão 0,5; configurável por organização)
 *
 * score = máx(0, 100 − arredonda(penalidade))
 * ```
 *
 * # O que entra na soma
 *
 * Apenas ocorrências com resultado `DIVERGENCIA` ou `ALERTA` — as que exigem
 * ação do auditor. Por construção, portanto:
 *
 * - `NAO_APLICAVEL` **não penaliza.** A regra não se aplica àquele documento;
 *   não há o que corrigir. É o caso das exclusões por escopo (ICMS e CFOP de
 *   entradas): um documento fora do escopo de uma regra não reduz o score.
 * - `NAO_VERIFICADO` **não penaliza.** A verificação não pôde ser feita, seja
 *   por arquivo ausente, seja por registro não suportado — como as NFC-e
 *   escrituradas por consolidação. Uma conferência que não rodou não é prova de
 *   não conformidade, e também não é prova de conformidade: ela aparece no
 *   relatório, mas fora do score.
 * - `OK` não penaliza, por definição.
 *
 * O score é limitado inferiormente a zero: um mês muito ruim satura, em vez de
 * produzir números negativos sem significado.
 */

import {
  DEFAULT_INDICIO_FACTOR,
  DEFAULT_SCORE_WEIGHTS,
  type ConformityBand,
  type FindingNature,
  type ScoreWeights,
  type Severity,
} from '@/lib/domain/entities';

/** Resultados que exigem ação do auditor e, por isso, entram no score. */
const PENALISED_STATUSES = new Set(['DIVERGENCIA', 'ALERTA']);

export interface ScoreInput {
  readonly status: string;
  readonly severity: Severity;
  /** Ocorrências de natureza `INDICIO` recebem peso reduzido. */
  readonly nature?: FindingNature;
}

export interface ScoreResult {
  readonly score: number;
  readonly band: ConformityBand;
  readonly penalty: number;
  readonly breakdown: Readonly<Record<Severity, number>>;
  /** Quantas das ocorrências penalizadas eram indícios. */
  readonly indicios: number;
}

export function computeScore(
  findings: readonly ScoreInput[],
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
  indicioFactor: number = DEFAULT_INDICIO_FACTOR,
): ScoreResult {
  const breakdown: Record<Severity, number> = { INFO: 0, BAIXA: 0, MEDIA: 0, ALTA: 0, CRITICA: 0 };
  const factor = Number.isFinite(indicioFactor) ? Math.min(1, Math.max(0, indicioFactor)) : DEFAULT_INDICIO_FACTOR;

  let penalty = 0;
  let indicios = 0;

  for (const finding of findings) {
    if (!PENALISED_STATUSES.has(finding.status)) continue;
    breakdown[finding.severity] += 1;
    const indicio = finding.nature === 'INDICIO';
    if (indicio) indicios += 1;
    penalty += weights[finding.severity] * (indicio ? factor : 1);
  }

  const rounded = Math.round(penalty);
  const score = Math.max(0, 100 - rounded);
  return { score, band: bandFor(score), penalty: rounded, breakdown, indicios };
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
