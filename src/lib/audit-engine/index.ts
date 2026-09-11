export { runAudit, resolveConfig, type EngineOptions, type EngineResult, type EngineSummary } from './engine';
export { computeScore, bandFor, BAND_LABELS, type ScoreResult } from './score';
export { compareValues, type Comparison } from './tolerance';
export {
  composeRevenue,
  policyFromRules,
  EMPTY_REVENUE_POLICY,
  DEFAULT_INEFFECTIVE_STATUSES,
  type CompositionEntry,
  type CfopBreakdown,
  type RevenueComposition,
  type RevenuePolicy,
} from './revenue-composition';
export {
  revenueFromDocuments,
  revenueFromPgdasd,
  revenueLabel,
  type RevenueFigure,
  type RevenueOutcome,
  type RevenueSourceKey,
} from './rules/faturamento';
export { AUDIT_RULES, ruleByCode } from './rules';
export type { AuditRule, RuleConfig, RuleContext, RuleFinding, RuleResult, RuleTolerance } from './types';
export { DEFAULT_TOLERANCE } from './types';
