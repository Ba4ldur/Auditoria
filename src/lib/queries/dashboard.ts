/**
 * Dashboard aggregation (requirement 6).
 *
 * Aggregates are computed over the audits and findings of the organization.
 * The heavy tables (invoices, invoice items) are never loaded here: the numbers
 * shown come from the audit summary rows and from the findings.
 */

import { compareCompetencia, formatCompetencia, type Competencia } from '@/lib/core/competencia';
import type { Audit, AuditFinding, Company, Severity } from '@/lib/domain/entities';
import { AUDIT_MODULE_LABELS, type AuditModule } from '@/lib/domain/sources';
import { getStore } from '@/lib/data';

export interface DashboardData {
  readonly companyCount: number;
  readonly auditCount: number;
  readonly averageConformity: number | null;
  readonly openFindings: number;
  readonly criticalFindings: number;
  readonly conformityByCompetencia: readonly { label: string; value: number }[];
  readonly findingsByModule: readonly { label: string; value: number }[];
  readonly findingsBySeverity: readonly { label: string; value: number; color: string }[];
  readonly recentAudits: readonly RecentAudit[];
}

export interface RecentAudit {
  readonly id: string;
  readonly companyName: string;
  readonly competencia: Competencia;
  readonly competenciaLabel: string;
  readonly documentCount: number;
  readonly status: Audit['status'];
  readonly score: number | null;
  readonly band: Audit['band'];
  readonly findings: number;
  readonly createdAt: string;
}

const SEVERITY_COLORS: Record<Severity, string> = {
  INFO: 'var(--color-navy-300)',
  BAIXA: 'var(--color-navy-500)',
  MEDIA: 'var(--color-warning)',
  ALTA: 'var(--color-gold-600)',
  CRITICA: 'var(--color-danger)',
};

/** Findings that still require action from the auditor. */
const OPEN_REVIEW_STATUSES = new Set(['PENDENTE', 'EM_ANALISE']);
const ACTIONABLE_STATUSES = new Set(['DIVERGENCIA', 'ALERTA']);

export async function loadDashboard(): Promise<DashboardData> {
  const store = getStore();
  const [companies, audits] = await Promise.all([store.listCompanies(), store.listAudits()]);
  const companyById = new Map(companies.map((company) => [company.id, company]));

  const findingsPage = await store.listFindings({ limit: 5000 });
  const findings = findingsPage.items;
  const findingsByAudit = new Map<string, AuditFinding[]>();
  for (const finding of findings) {
    const bucket = findingsByAudit.get(finding.auditId);
    if (bucket) bucket.push(finding);
    else findingsByAudit.set(finding.auditId, [finding]);
  }

  const scored = audits.filter((audit) => audit.score !== null);
  const averageConformity =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((sum, audit) => sum + (audit.score ?? 0), 0) / scored.length);

  const actionable = findings.filter((finding) => ACTIONABLE_STATUSES.has(finding.status));
  const open = actionable.filter((finding) => OPEN_REVIEW_STATUSES.has(finding.reviewStatus));

  return {
    companyCount: companies.length,
    auditCount: audits.length,
    averageConformity,
    openFindings: open.length,
    criticalFindings: open.filter((finding) => finding.severity === 'CRITICA').length,
    conformityByCompetencia: conformityByCompetencia(scored),
    findingsByModule: countByModule(actionable),
    findingsBySeverity: countBySeverity(actionable),
    recentAudits: audits.slice(0, 8).map((audit) => toRecentAudit(audit, companyById, findingsByAudit)),
  };
}

function conformityByCompetencia(audits: readonly Audit[]): { label: string; value: number }[] {
  const grouped = new Map<Competencia, number[]>();
  for (const audit of audits) {
    const bucket = grouped.get(audit.competencia);
    if (bucket) bucket.push(audit.score ?? 0);
    else grouped.set(audit.competencia, [audit.score ?? 0]);
  }

  return [...grouped.entries()]
    .sort((a, b) => compareCompetencia(a[0], b[0]))
    .slice(-12)
    .map(([competencia, scores]) => ({
      label: formatCompetencia(competencia),
      value: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    }));
}

function countByModule(findings: readonly AuditFinding[]): { label: string; value: number }[] {
  const counts = new Map<AuditModule, number>();
  for (const finding of findings) {
    counts.set(finding.module, (counts.get(finding.module) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([module, value]) => ({ label: AUDIT_MODULE_LABELS[module], value }))
    .sort((a, b) => b.value - a.value);
}

function countBySeverity(
  findings: readonly AuditFinding[],
): { label: string; value: number; color: string }[] {
  const order: Severity[] = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA', 'INFO'];
  const labels: Record<Severity, string> = {
    CRITICA: 'Crítica',
    ALTA: 'Alta',
    MEDIA: 'Média',
    BAIXA: 'Baixa',
    INFO: 'Informativa',
  };
  return order
    .map((severity) => ({
      label: labels[severity],
      value: findings.filter((finding) => finding.severity === severity).length,
      color: SEVERITY_COLORS[severity],
    }))
    .filter((entry) => entry.value > 0);
}

function toRecentAudit(
  audit: Audit,
  companies: Map<string, Company>,
  findingsByAudit: Map<string, AuditFinding[]>,
): RecentAudit {
  const findings = findingsByAudit.get(audit.id) ?? [];
  return {
    id: audit.id,
    companyName: companies.get(audit.companyId)?.legalName ?? 'Empresa removida',
    competencia: audit.competencia,
    competenciaLabel: formatCompetencia(audit.competencia),
    documentCount: audit.documentCount,
    status: audit.status,
    score: audit.score,
    band: audit.band,
    findings: findings.filter((finding) => ACTIONABLE_STATUSES.has(finding.status)).length,
    createdAt: audit.createdAt,
  };
}
