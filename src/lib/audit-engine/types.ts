/**
 * Audit rule contract (requirement 16).
 *
 * Rules never live inside React components and never read a file format. A rule
 * receives a normalised dataset plus its own configuration and returns a
 * result with explicit evidence.
 *
 * The distinction between `FATO` and `INDICIO` is structural, not cosmetic: a
 * `FATO` is fully determined by the data (the document is in the XML and not in
 * the SPED), while an `INDICIO` states an arithmetic difference whose tax
 * meaning depends on the nature of the operation and requires human analysis
 * (requirement 35).
 */

import type { Cents } from '@/lib/core/money';
import type { AuditDataset } from '@/lib/normalization/dataset';
import type { RevenuePolicy } from './revenue';
import type { AuditModule, DataSourceKind } from '@/lib/domain/sources';
import type {
  FindingEvidence,
  FindingNature,
  FindingStatus,
  Severity,
} from '@/lib/domain/entities';

export interface RuleTolerance {
  /** Absolute tolerance in cents. Differences at or below it are rounding. */
  readonly absoluteTolerance: Cents;
  /** Relative tolerance in percentage points (0.5 means 0,5%). */
  readonly percentageTolerance: number;
}

export const DEFAULT_TOLERANCE: RuleTolerance = Object.freeze({
  absoluteTolerance: 5 as Cents, // R$ 0,05
  percentageTolerance: 0,
});

export interface RuleConfig {
  readonly enabled: boolean;
  readonly gravidade: Severity;
  readonly tolerancia: RuleTolerance;
}

/** A single observation produced by a rule. */
export interface RuleFinding {
  readonly resultado: FindingStatus;
  readonly gravidade?: Severity;
  readonly natureza: FindingNature;
  readonly titulo: string;
  readonly descricao: string;
  readonly documento?: string | null;
  readonly rotuloOrigem?: string | null;
  readonly valorOrigem?: Cents | null;
  readonly rotuloDestino?: string | null;
  readonly valorDestino?: Cents | null;
  readonly diferenca?: Cents | null;
  /** Filled whenever the conclusion depends on human analysis. */
  readonly analiseHumana?: string | null;
  readonly evidencias: readonly Omit<FindingEvidence, 'id'>[];
}

export interface RuleResult {
  /** Number of comparisons the rule performed and considered correct. */
  readonly cruzamentosCorretos: number;
  readonly findings: readonly RuleFinding[];
  /** Set when the rule could not run; explains why in auditor-facing wording. */
  readonly naoAplicavel?: string | null;
}

export interface RuleContext {
  readonly dataset: AuditDataset;
  readonly config: RuleConfig;
  /**
   * Organization-level policy for what composes revenue. Kept out of the rule
   * definitions because it is a tax judgement, configurable by the auditor.
   */
  readonly revenuePolicy: RevenuePolicy;
}

export interface AuditRule {
  readonly id: string;
  readonly codigo: string;
  readonly nome: string;
  readonly descricao: string;
  readonly modulo: AuditModule;
  readonly gravidade: Severity;
  /** Sources the rule needs; if any is missing the rule reports NAO_VERIFICADO. */
  readonly documentosNecessarios: readonly DataSourceKind[];
  readonly toleranciaPadrao: RuleTolerance;
  /**
   * Explains what the rule can and cannot conclude on its own. Displayed in the
   * "Regras de Auditoria" screen and in the finding detail panel.
   */
  readonly limitacoes: string;
  executar(context: RuleContext): RuleResult;
}

export function emptyResult(naoAplicavel?: string): RuleResult {
  return {
    cruzamentosCorretos: 0,
    findings: [],
    naoAplicavel: naoAplicavel ?? null,
  };
}
