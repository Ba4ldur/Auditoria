/**
 * Rule registry.
 *
 * Adding a rule means writing its module and appending it here. Nothing else in
 * the application enumerates rules.
 */

import type { AuditRule } from '../types';
import { FISCAL_RULES } from './fiscal';
import { FATURAMENTO_RULES } from './faturamento';
import { CONTRIBUICOES_RULES } from './contribuicoes';

export const AUDIT_RULES: readonly AuditRule[] = [
  ...FISCAL_RULES,
  ...FATURAMENTO_RULES,
  ...CONTRIBUICOES_RULES,
];

const BY_CODE = new Map(AUDIT_RULES.map((rule) => [rule.codigo, rule]));

export function ruleByCode(codigo: string): AuditRule | undefined {
  return BY_CODE.get(codigo);
}

export { FISCAL_RULES, FATURAMENTO_RULES, CONTRIBUICOES_RULES };
