/**
 * Persistence port.
 *
 * The application talks only to this interface. Two adapters implement it:
 *  - `LocalStore`  — file-backed, used for development and for the demo dataset;
 *  - `SupabaseStore` — PostgreSQL through Supabase, with RLS enforced per
 *    organization.
 *
 * Keeping persistence behind a port is what allows the audit pipeline to be
 * tested without a database and what will allow moving processing into
 * background workers later without touching the domain code.
 */

import type { Competencia } from '@/lib/core/competencia';
import type {
  Audit,
  AuditComment,
  AuditFile,
  AuditFinding,
  AuditStatus,
  CfopRule,
  CfopRuleSource,
  CfopTreatment,
  Company,
  CompanyRegimeHistory,
  ConformityBand,
  FieldConfirmation,
  FileInspection,
  FileMessage,
  FileParseLog,
  FileProcessingStatus,
  FileReliability,
  FileStats,
  IdentityCheck,
  Organization,
  OrganizationSettings,
  ReviewStatus,
  RuleSetting,
  Severity,
} from '@/lib/domain/entities';
import type {
  Declaration,
  Invoice,
  ParticipantRecord,
  RevenueRecord,
  TaxRecord,
  TaxRegime,
} from '@/lib/domain/model';
import type { DataSourceKind } from '@/lib/domain/sources';

export interface CompanyInput {
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly cnpj: string;
  readonly stateRegistration: string | null;
  readonly municipalRegistration: string | null;
  readonly uf: string;
  readonly municipality: string | null;
  readonly taxRegime: TaxRegime;
}

export interface AuditInput {
  readonly companyId: string;
  readonly competencia: Competencia;
  readonly notes?: string | null;
}

export interface AuditPatch {
  readonly status?: AuditStatus;
  readonly score?: number | null;
  readonly band?: ConformityBand | null;
  readonly documentCount?: number;
  readonly crossChecksOk?: number;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  readonly notes?: string | null;
}

export interface AuditFileInput {
  readonly auditId: string;
  readonly originalName: string;
  readonly storagePath: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface AuditFilePatch {
  readonly storagePath?: string | null;
  readonly detectedSource?: DataSourceKind | null;
  readonly detectedTaxId?: string | null;
  readonly detectedLegalName?: string | null;
  readonly detectedCompetencia?: Competencia | null;
  readonly detectedStartDate?: string | null;
  readonly detectedEndDate?: string | null;
  readonly identityCheck?: IdentityCheck;
  readonly reliability?: FileReliability;
  readonly status?: FileProcessingStatus;
  readonly messages?: readonly FileMessage[];
  readonly stats?: FileStats | null;
  readonly parserVersion?: string | null;
  readonly parseLog?: FileParseLog | null;
  readonly inspection?: FileInspection | null;
  readonly processedAt?: string | null;
}

export interface StoredDataset {
  readonly invoices: readonly Invoice[];
  readonly revenues: readonly RevenueRecord[];
  readonly taxes: readonly TaxRecord[];
  readonly declarations: readonly Declaration[];
  readonly participants: readonly ParticipantRecord[];
}

export interface FindingFilter {
  readonly auditId?: string;
  readonly companyId?: string;
  readonly severity?: Severity;
  readonly module?: string;
  readonly ruleCode?: string;
  readonly reviewStatus?: ReviewStatus;
  readonly status?: string;
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface FindingPage {
  readonly items: readonly AuditFinding[];
  readonly total: number;
}

export interface ReviewPatch {
  readonly reviewStatus: ReviewStatus;
  readonly reviewNote: string | null;
  readonly reviewer: string | null;
}

export interface FieldConfirmationInput {
  readonly auditId: string;
  readonly fileId: string;
  readonly field: string;
  readonly originalValue: string | null;
  readonly confirmedValue: string;
  readonly confirmedBy: string;
  readonly note: string | null;
}

export interface CfopRuleInput {
  readonly cfop: string;
  readonly description: string | null;
  readonly treatment: CfopTreatment;
  readonly reason: string | null;
  readonly ruleSource?: CfopRuleSource;
  readonly updatedBy: string | null;
}

export interface RuleSettingInput {
  readonly ruleCode: string;
  readonly enabled: boolean;
  readonly severity: Severity | null;
  readonly absoluteToleranceCents: number | null;
  readonly percentageTolerance: number | null;
}

export interface DataStore {
  readonly kind: 'local' | 'supabase';

  getOrganization(): Promise<Organization>;
  getSettings(): Promise<OrganizationSettings>;
  saveSettings(patch: Partial<Omit<OrganizationSettings, 'organizationId' | 'updatedAt'>>): Promise<OrganizationSettings>;

  listCompanies(): Promise<Company[]>;
  getCompany(id: string): Promise<Company | null>;
  findCompanyByCnpj(cnpj: string): Promise<Company | null>;
  createCompany(input: CompanyInput): Promise<Company>;
  updateCompany(id: string, input: Partial<CompanyInput> & { active?: boolean }): Promise<Company>;
  listRegimeHistory(companyId: string): Promise<CompanyRegimeHistory[]>;
  addRegimeHistory(input: {
    companyId: string;
    taxRegime: TaxRegime;
    validFrom: Competencia;
    validTo: Competencia | null;
    note: string | null;
  }): Promise<CompanyRegimeHistory>;

  listAudits(filter?: { companyId?: string; limit?: number }): Promise<Audit[]>;
  getAudit(id: string): Promise<Audit | null>;
  createAudit(input: AuditInput): Promise<Audit>;
  updateAudit(id: string, patch: AuditPatch): Promise<Audit>;
  deleteAudit(id: string): Promise<void>;

  listFiles(auditId: string): Promise<AuditFile[]>;
  getFile(id: string): Promise<AuditFile | null>;
  findFileByHash(auditId: string, sha256: string): Promise<AuditFile | null>;
  createFile(input: AuditFileInput): Promise<AuditFile>;
  updateFile(id: string, patch: AuditFilePatch): Promise<AuditFile>;
  deleteFile(id: string): Promise<void>;

  saveDataset(auditId: string, dataset: StoredDataset): Promise<void>;
  loadDataset(auditId: string): Promise<StoredDataset | null>;

  replaceFindings(auditId: string, findings: readonly AuditFinding[]): Promise<void>;
  listFindings(filter: FindingFilter): Promise<FindingPage>;
  getFinding(id: string): Promise<AuditFinding | null>;
  updateFindingReview(id: string, patch: ReviewPatch): Promise<AuditFinding>;

  listComments(findingId: string): Promise<AuditComment[]>;
  addComment(findingId: string, author: string, body: string): Promise<AuditComment>;

  listRuleSettings(): Promise<RuleSetting[]>;
  upsertRuleSetting(input: RuleSettingInput): Promise<RuleSetting>;

  listFieldConfirmations(auditId: string): Promise<FieldConfirmation[]>;
  upsertFieldConfirmation(input: FieldConfirmationInput): Promise<FieldConfirmation>;
  deleteFieldConfirmation(id: string): Promise<void>;

  listCfopRules(): Promise<CfopRule[]>;
  upsertCfopRule(input: CfopRuleInput): Promise<CfopRule>;
  deleteCfopRule(cfop: string): Promise<void>;
}
