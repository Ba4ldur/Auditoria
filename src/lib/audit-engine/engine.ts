/**
 * Audit engine.
 *
 * Runs every enabled rule against the normalised dataset, converts the results
 * into persistable findings and computes the conformity score.
 *
 * A rule that throws is isolated: it becomes a `NAO_VERIFICADO` finding
 * describing the failure, and the remaining rules still run. One broken rule
 * must never invalidate an entire audit.
 */

import { newId } from '@/lib/core/hash';
import { describeError } from '@/lib/core/result';
import type { Cents } from '@/lib/core/money';
import type {
  AuditFinding,
  FindingEvidence,
  RuleSetting,
  ScoreWeights,
  Severity,
} from '@/lib/domain/entities';
import { DEFAULT_SCORE_WEIGHTS } from '@/lib/domain/entities';
import type { AuditDataset } from '@/lib/normalization/dataset';
import { AUDIT_RULES } from './rules';
import { computeScore, type ScoreResult } from './score';
import { EMPTY_REVENUE_POLICY, type RevenuePolicy } from './revenue-composition';
import type { AuditRule, RuleConfig, RuleFinding, RuleTolerance } from './types';

export interface EngineOptions {
  readonly organizationId: string;
  readonly auditId: string;
  readonly rules?: readonly AuditRule[];
  readonly settings?: ReadonlyMap<string, RuleSetting>;
  readonly scoreWeights?: ScoreWeights;
  readonly revenuePolicy?: RevenuePolicy;
  readonly now?: () => string;
}

export interface EngineSummary {
  readonly cruzamentosCorretos: number;
  readonly alertas: number;
  readonly divergencias: number;
  readonly criticas: number;
  readonly naoVerificados: number;
  readonly naoAplicaveis: number;
}

export interface EngineResult {
  readonly findings: readonly AuditFinding[];
  readonly score: ScoreResult;
  readonly summary: EngineSummary;
}

export function resolveConfig(rule: AuditRule, setting: RuleSetting | undefined): RuleConfig {
  const tolerancia: RuleTolerance = {
    absoluteTolerance: (setting?.absoluteToleranceCents ?? rule.toleranciaPadrao.absoluteTolerance) as Cents,
    percentageTolerance: setting?.percentageTolerance ?? rule.toleranciaPadrao.percentageTolerance,
  };
  return {
    enabled: setting?.enabled ?? true,
    gravidade: setting?.severity ?? rule.gravidade,
    tolerancia,
  };
}

export function runAudit(dataset: AuditDataset, options: EngineOptions): EngineResult {
  const rules = options.rules ?? AUDIT_RULES;
  const weights = options.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;
  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  const revenuePolicy = options.revenuePolicy ?? EMPTY_REVENUE_POLICY;

  const findings: AuditFinding[] = [];
  let cruzamentosCorretos = 0;

  for (const rule of rules) {
    const config = resolveConfig(rule, options.settings?.get(rule.codigo));
    if (!config.enabled) continue;

    try {
      const result = rule.executar({ dataset, config, revenuePolicy });
      cruzamentosCorretos += result.cruzamentosCorretos;
      for (const finding of result.findings) {
        findings.push(toEntity(finding, rule, config.gravidade, options, timestamp));
      }
    } catch (error) {
      findings.push(
        toEntity(
          {
            resultado: 'NAO_VERIFICADO',
            natureza: 'FATO',
            titulo: `${rule.codigo}: falha na execução da regra`,
            descricao:
              'A regra não pode ser concluída por um erro de execução. As demais regras da auditoria foram ' +
              'processadas normalmente.',
            evidencias: [
              {
                label: 'Erro',
                origin: 'Motor de auditoria',
                value: describeError(error),
                source: null,
                fileName: null,
                recordCode: null,
                lineNumber: null,
                reference: null,
              },
            ],
          },
          rule,
          config.gravidade,
          options,
          timestamp,
        ),
      );
    }
  }

  const score = computeScore(
    findings.map((finding) => ({ status: finding.status, severity: finding.severity })),
    weights,
  );

  return {
    findings,
    score,
    summary: {
      cruzamentosCorretos,
      alertas: findings.filter((finding) => finding.status === 'ALERTA').length,
      divergencias: findings.filter((finding) => finding.status === 'DIVERGENCIA').length,
      criticas: findings.filter(
        (finding) => finding.status === 'DIVERGENCIA' && finding.severity === 'CRITICA',
      ).length,
      naoVerificados: findings.filter((finding) => finding.status === 'NAO_VERIFICADO').length,
      naoAplicaveis: findings.filter((finding) => finding.status === 'NAO_APLICAVEL').length,
    },
  };
}

function toEntity(
  finding: RuleFinding,
  rule: AuditRule,
  defaultSeverity: Severity,
  options: EngineOptions,
  timestamp: string,
): AuditFinding {
  const severity: Severity =
    finding.resultado === 'OK' || finding.resultado === 'NAO_APLICAVEL' || finding.resultado === 'NAO_VERIFICADO'
      ? 'INFO'
      : (finding.gravidade ?? defaultSeverity);

  const evidence: FindingEvidence[] = finding.evidencias.map((item) => ({ id: newId(), ...item }));

  return {
    id: newId(),
    organizationId: options.organizationId,
    auditId: options.auditId,
    ruleCode: rule.codigo,
    ruleName: rule.nome,
    module: rule.modulo,
    severity,
    status: finding.resultado,
    nature: finding.natureza,
    title: finding.titulo,
    description: finding.descricao,
    documentRef: finding.documento ?? null,
    originLabel: finding.rotuloOrigem ?? null,
    originValue: finding.valorOrigem ?? null,
    targetLabel: finding.rotuloDestino ?? null,
    targetValue: finding.valorDestino ?? null,
    difference: finding.diferenca ?? null,
    humanReviewNote: finding.analiseHumana ?? null,
    evidence,
    reviewStatus: 'PENDENTE',
    reviewNote: null,
    reviewer: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
