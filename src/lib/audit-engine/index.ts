export { runAudit, resolveConfig, type EngineOptions, type EngineResult, type EngineSummary } from './engine';
export { computeScore, bandFor, BAND_LABELS, type ScoreResult } from './score';
export { compareValues, type Comparison } from './tolerance';
export {
  computeRevenueFromInvoices,
  DEFAULT_REVENUE_POLICY,
  type RevenueComputation,
  type RevenuePolicy,
} from './revenue';
export { AUDIT_RULES, ruleByCode } from './rules';
export type { AuditRule, RuleConfig, RuleContext, RuleFinding, RuleResult, RuleTolerance } from './types';
export { DEFAULT_TOLERANCE } from './types';
