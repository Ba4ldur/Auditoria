/**
 * Conversao entre as linhas do PostgreSQL (snake_case) e as entidades do
 * dominio (camelCase).
 *
 * Concentrar o mapeamento em um unico modulo torna uma mudanca de schema uma
 * edicao local: o adaptador em `supabase-store.ts` nao conhece nomes de coluna
 * fora daqui e das clausulas de consulta.
 */

import { cents, type Cents } from '@/lib/core/money';
import {
  DEFAULT_SCORE_WEIGHTS,
  type Audit,
  type AuditComment,
  type AuditFile,
  type AuditFinding,
  type CfopRule,
  type Company,
  type CompanyRegimeHistory,
  type FieldConfirmation,
  type Organization,
  type OrganizationSettings,
  type RuleSetting,
} from '@/lib/domain/entities';
import { recordOrigin } from '@/lib/domain/model';
import type {
  Declaration,
  Invoice,
  ParticipantRecord,
  RevenueRecord,
  TaxRecord,
  TaxRegime,
} from '@/lib/domain/model';
import { MAX_UPLOAD_BYTES } from './local-store';

export type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  return String(row[key] ?? '');
}

function nullableStr(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function num(row: Row, key: string): number {
  return Number(row[key] ?? 0);
}

function nullableNum(row: Row, key: string): number | null {
  const value = row[key];
  return value === null || value === undefined ? null : Number(value);
}

export /** Reconstrói a origem a partir das colunas `origin_*` da linha. */
function toOrigin(row: Row) {
  return recordOrigin({
    fileId: nullableStr(row, 'file_id'),
    fileName: nullableStr(row, 'file_name'),
    recordCode: nullableStr(row, 'origin_record_code'),
    lineNumber: nullableNum(row, 'origin_line_number'),
    entryName: nullableStr(row, 'origin_entry_name'),
  });
}

export function toOrganization(row: Row): Organization {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    slug: str(row, 'slug'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}

export function toSettings(row: Row): OrganizationSettings {
  return {
    organizationId: str(row, 'organization_id'),
    scoreWeights: (row.score_weights as OrganizationSettings['scoreWeights']) ?? DEFAULT_SCORE_WEIGHTS,
    maxUploadBytes: num(row, 'max_upload_bytes') || MAX_UPLOAD_BYTES,
    updatedAt: str(row, 'updated_at'),
  };
}

export function toCompany(row: Row): Company {
  return {
    id: str(row, 'id'),
    organizationId: str(row, 'organization_id'),
    legalName: str(row, 'legal_name'),
    tradeName: nullableStr(row, 'trade_name'),
    cnpj: str(row, 'cnpj'),
    stateRegistration: nullableStr(row, 'state_registration'),
    municipalRegistration: nullableStr(row, 'municipal_registration'),
    uf: str(row, 'uf'),
    municipality: nullableStr(row, 'municipality'),
    taxRegime: str(row, 'tax_regime') as Company['taxRegime'],
    active: row.active !== false,
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}

export function toRegimeHistory(row: Row): CompanyRegimeHistory {
  return {
    id: str(row, 'id'),
    companyId: str(row, 'company_id'),
    taxRegime: str(row, 'tax_regime') as TaxRegime,
    validFrom: str(row, 'valid_from'),
    validTo: nullableStr(row, 'valid_to'),
    note: nullableStr(row, 'note'),
    createdAt: str(row, 'created_at'),
  };
}

export function toAudit(row: Row): Audit {
  return {
    id: str(row, 'id'),
    organizationId: str(row, 'organization_id'),
    companyId: str(row, 'company_id'),
    competencia: str(row, 'competencia'),
    status: str(row, 'status') as Audit['status'],
    score: nullableNum(row, 'score'),
    band: (nullableStr(row, 'band') as Audit['band']) ?? null,
    documentCount: num(row, 'document_count'),
    crossChecksOk: num(row, 'cross_checks_ok'),
    startedAt: nullableStr(row, 'started_at'),
    finishedAt: nullableStr(row, 'finished_at'),
    notes: nullableStr(row, 'notes'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}

export function toAuditFile(row: Row): AuditFile {
  return {
    id: str(row, 'id'),
    organizationId: str(row, 'organization_id'),
    auditId: str(row, 'audit_id'),
    originalName: str(row, 'original_name'),
    storagePath: nullableStr(row, 'storage_path'),
    mimeType: nullableStr(row, 'mime_type'),
    sizeBytes: num(row, 'size_bytes'),
    sha256: str(row, 'sha256'),
    detectedSource: (nullableStr(row, 'detected_source') as AuditFile['detectedSource']) ?? null,
    detectedTaxId: nullableStr(row, 'detected_tax_id'),
    detectedLegalName: nullableStr(row, 'detected_legal_name'),
    detectedCompetencia: nullableStr(row, 'detected_competencia'),
    detectedStartDate: nullableStr(row, 'detected_start_date'),
    detectedEndDate: nullableStr(row, 'detected_end_date'),
    identityCheck: (str(row, 'identity_check') || 'NAO_IDENTIFICADO') as AuditFile['identityCheck'],
    reliability: (str(row, 'reliability') || 'REQUER_CONFERENCIA') as AuditFile['reliability'],
    status: (str(row, 'status') || 'PENDENTE') as AuditFile['status'],
    messages: (row.messages as AuditFile['messages']) ?? [],
    stats: (row.stats as AuditFile['stats']) ?? null,
    parserVersion: nullableStr(row, 'parser_version'),
    parseLog: (row.parse_log as AuditFile['parseLog']) ?? null,
    inspection: (row.inspection as AuditFile['inspection']) ?? null,
    parentFileId: nullableStr(row, 'parent_file_id'),
    uploadedAt: str(row, 'uploaded_at'),
    processedAt: nullableStr(row, 'processed_at'),
  };
}

export function toInvoice(row: Row): Invoice {
  const items = ((row.invoice_items as { position: number; data: unknown }[]) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.data);

  return {
    id: str(row, 'id'),
    source: str(row, 'source') as Invoice['source'],
    documentKind: str(row, 'document_kind') as Invoice['documentKind'],
    accessKey: nullableStr(row, 'access_key'),
    model: nullableStr(row, 'model'),
    serie: nullableStr(row, 'serie'),
    number: nullableStr(row, 'number'),
    issueDate: nullableStr(row, 'issue_date'),
    direction: str(row, 'direction') as Invoice['direction'],
    status: str(row, 'status') as Invoice['status'],
    purpose: (nullableStr(row, 'purpose') as Invoice['purpose']) ?? 'INDEFINIDA',
    extemporaneous: row.extemporaneous === true,
    purposeCode: nullableStr(row, 'purpose_code'),
    purposeField: nullableStr(row, 'purpose_field'),
    totalValue: cents(num(row, 'total_value')),
    emitterTaxId: nullableStr(row, 'emitter_tax_id'),
    emitterName: nullableStr(row, 'emitter_name'),
    emitterUf: nullableStr(row, 'emitter_uf'),
    recipientTaxId: nullableStr(row, 'recipient_tax_id'),
    recipientName: nullableStr(row, 'recipient_name'),
    recipientUf: nullableStr(row, 'recipient_uf'),
    naturezaOperacao: nullableStr(row, 'natureza_operacao'),
    cfopPrincipal: nullableStr(row, 'cfop_principal'),
    cfops: (row.cfops as string[]) ?? [],
    totals: row.totals as Invoice['totals'],
    items: items as Invoice['items'],
    origin: toOrigin(row),
  };
}

export function toRevenueRecord(row: Row): RevenueRecord {
  return {
    id: str(row, 'id'),
    source: str(row, 'source') as RevenueRecord['source'],
    competencia: str(row, 'competencia'),
    basis: str(row, 'basis') as RevenueRecord['basis'],
    amount: cents(num(row, 'amount')),
    description: str(row, 'description'),
    documentCount: nullableNum(row, 'document_count'),
    origin: toOrigin(row),
  };
}

export function toTaxRecord(row: Row): TaxRecord {
  return {
    id: str(row, 'id'),
    source: str(row, 'source') as TaxRecord['source'],
    competencia: str(row, 'competencia'),
    tax: str(row, 'tax') as TaxRecord['tax'],
    metric: str(row, 'metric') as TaxRecord['metric'],
    base: toCents(nullableNum(row, 'base')),
    amount: cents(num(row, 'amount')),
    description: str(row, 'description'),
    origin: toOrigin(row),
  };
}

export function toDeclaration(row: Row): Declaration {
  return {
    id: str(row, 'id'),
    source: str(row, 'source') as Declaration['source'],
    competencia: nullableStr(row, 'competencia'),
    taxId: nullableStr(row, 'tax_id'),
    legalName: nullableStr(row, 'legal_name'),
    period: row.period as Declaration['period'],
    lines: (row.lines as Declaration['lines']) ?? [],
    confidence: str(row, 'confidence') as Declaration['confidence'],
    unresolvedFields: (row.unresolved_fields as string[]) ?? [],
    origin: toOrigin(row),
  };
}

export function toParticipant(row: Row): ParticipantRecord {
  return {
    id: str(row, 'id'),
    source: str(row, 'source') as ParticipantRecord['source'],
    code: str(row, 'code'),
    name: nullableStr(row, 'name'),
    taxId: nullableStr(row, 'tax_id'),
    uf: nullableStr(row, 'uf'),
    stateRegistration: nullableStr(row, 'state_registration'),
    countryCode: nullableStr(row, 'country_code'),
    origin: toOrigin(row),
  };
}

export function toFinding(row: Row): AuditFinding {
  const evidence = ((row.audit_finding_evidence as Row[]) ?? []).map((item) => ({
    id: str(item, 'id'),
    label: str(item, 'label'),
    origin: str(item, 'origin'),
    value: nullableStr(item, 'value'),
    source: (nullableStr(item, 'source') as AuditFinding['evidence'][number]['source']) ?? null,
    fileName: nullableStr(item, 'file_name'),
    recordCode: nullableStr(item, 'record_code'),
    fieldName: nullableStr(item, 'field_name'),
    lineNumber: nullableNum(item, 'line_number'),
    parserVersion: nullableStr(item, 'parser_version'),
    reference: nullableStr(item, 'reference'),
  }));

  return {
    id: str(row, 'id'),
    organizationId: str(row, 'organization_id'),
    auditId: str(row, 'audit_id'),
    ruleCode: str(row, 'rule_code'),
    ruleName: str(row, 'rule_name'),
    ruleVersion: nullableStr(row, 'rule_version') ?? '',
    module: str(row, 'module') as AuditFinding['module'],
    severity: str(row, 'severity') as AuditFinding['severity'],
    status: str(row, 'status') as AuditFinding['status'],
    nature: str(row, 'nature') as AuditFinding['nature'],
    title: str(row, 'title'),
    description: str(row, 'description'),
    documentRef: nullableStr(row, 'document_ref'),
    originLabel: nullableStr(row, 'origin_label'),
    originValue: toCents(nullableNum(row, 'origin_value')),
    targetLabel: nullableStr(row, 'target_label'),
    targetValue: toCents(nullableNum(row, 'target_value')),
    difference: toCents(nullableNum(row, 'difference')),
    humanReviewNote: nullableStr(row, 'human_review_note'),
    evidence,
    reviewStatus: (str(row, 'review_status') || 'PENDENTE') as AuditFinding['reviewStatus'],
    reviewNote: nullableStr(row, 'review_note'),
    reviewer: nullableStr(row, 'reviewer'),
    reviewedAt: nullableStr(row, 'reviewed_at'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}

function toCents(value: number | null): Cents | null {
  return value === null ? null : cents(value);
}

export function toComment(row: Row): AuditComment {
  return {
    id: str(row, 'id'),
    organizationId: str(row, 'organization_id'),
    findingId: str(row, 'finding_id'),
    author: str(row, 'author'),
    body: str(row, 'body'),
    createdAt: str(row, 'created_at'),
  };
}

export function toFieldConfirmation(row: Row): FieldConfirmation {
  return {
    id: str(row, 'id'),
    organizationId: str(row, 'organization_id'),
    auditId: str(row, 'audit_id'),
    fileId: str(row, 'file_id'),
    field: str(row, 'field'),
    originalValue: nullableStr(row, 'original_value'),
    confirmedValue: str(row, 'confirmed_value'),
    confirmedBy: str(row, 'confirmed_by'),
    confirmedAt: str(row, 'confirmed_at'),
    note: nullableStr(row, 'note'),
  };
}

export function toCfopRule(row: Row): CfopRule {
  return {
    id: str(row, 'id'),
    organizationId: str(row, 'organization_id'),
    cfop: str(row, 'cfop'),
    description: nullableStr(row, 'description'),
    treatment: str(row, 'treatment') as CfopRule['treatment'],
    reason: nullableStr(row, 'reason'),
    ruleSource: (str(row, 'rule_source') || 'CONFIGURADO') as CfopRule['ruleSource'],
    updatedBy: nullableStr(row, 'updated_by'),
    updatedAt: str(row, 'updated_at'),
  };
}

export function toRuleSetting(row: Row): RuleSetting {
  return {
    id: str(row, 'id'),
    organizationId: str(row, 'organization_id'),
    ruleCode: str(row, 'rule_code'),
    enabled: row.enabled !== false,
    severity: (nullableStr(row, 'severity') as RuleSetting['severity']) ?? null,
    absoluteToleranceCents: nullableNum(row, 'absolute_tolerance_cents'),
    percentageTolerance: nullableNum(row, 'percentage_tolerance'),
    updatedAt: str(row, 'updated_at'),
  };
}
