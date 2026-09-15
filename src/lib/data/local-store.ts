/**
 * File-backed implementation of the persistence port.
 *
 * Used for local development and for the demonstration dataset, so the whole
 * pipeline (upload, parsing, cross-checking, reporting) can be exercised
 * without provisioning a database. Data lives under `.data/`, which is
 * git-ignored.
 *
 * Writes are serialised through a promise chain: Next.js route handlers can run
 * concurrently and a partially written JSON file would corrupt the dataset.
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { newId } from '@/lib/core/hash';
import { onlyDigits } from '@/lib/core/cnpj';
import type { Competencia } from '@/lib/core/competencia';
import {
  DEFAULT_INDICIO_FACTOR,
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
import type { TaxRegime } from '@/lib/domain/model';
import type {
  AuditFileInput,
  CfopRuleInput,
  FieldConfirmationInput,
  AuditFilePatch,
  AuditInput,
  AuditPatch,
  CompanyInput,
  DataStore,
  FindingFilter,
  FindingPage,
  ReviewPatch,
  RuleSettingInput,
  StoredDataset,
} from './types';

export const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

interface Database {
  organization: Organization;
  settings: OrganizationSettings;
  companies: Company[];
  regimeHistory: CompanyRegimeHistory[];
  audits: Audit[];
  files: AuditFile[];
  datasets: Record<string, StoredDataset>;
  findings: AuditFinding[];
  comments: AuditComment[];
  ruleSettings: RuleSetting[];
  fieldConfirmations: FieldConfirmation[];
  cfopRules: CfopRule[];
}

function now(): string {
  return new Date().toISOString();
}

function emptyDatabase(): Database {
  const timestamp = now();
  return {
    organization: {
      id: DEFAULT_ORGANIZATION_ID,
      name: 'Attivare Auditor',
      slug: 'attivare',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    settings: {
      organizationId: DEFAULT_ORGANIZATION_ID,
      scoreWeights: DEFAULT_SCORE_WEIGHTS,
      indicioFactor: DEFAULT_INDICIO_FACTOR,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      updatedAt: timestamp,
    },
    companies: [],
    regimeHistory: [],
    audits: [],
    files: [],
    datasets: {},
    findings: [],
    comments: [],
    ruleSettings: [],
    fieldConfirmations: [],
    cfopRules: [],
  };
}

export class LocalStore implements DataStore {
  readonly kind = 'local' as const;

  private cache: Database | null = null;
  /**
   * Modification time of the file the cache was built from. The cache is
   * discarded whenever the file changed underneath, which keeps separate
   * instances of this store (route handlers and server components live in
   * different module graphs during development) consistent with each other.
   */
  private cachedMtimeMs = -1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async currentMtime(): Promise<number> {
    try {
      return (await stat(this.filePath)).mtimeMs;
    } catch {
      return -1;
    }
  }

  private async load(): Promise<Database> {
    const mtime = await this.currentMtime();
    if (this.cache && mtime === this.cachedMtimeMs) return this.cache;

    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = { ...emptyDatabase(), ...(JSON.parse(raw) as Database) };
    } catch {
      this.cache = emptyDatabase();
    }
    this.cachedMtimeMs = mtime;
    return this.cache;
  }

  private async persist(database: Database): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(temporary, JSON.stringify(database, null, 2), 'utf8');
    await rename(temporary, this.filePath);
    this.cache = database;
    this.cachedMtimeMs = await this.currentMtime();
  }

  /** Serialises mutations so concurrent requests cannot interleave writes. */
  private mutate<T>(operation: (database: Database) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const database = await this.load();
      const result = await operation(database);
      await this.persist(database);
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read<T>(operation: (database: Database) => T | Promise<T>): Promise<T> {
    await this.queue.catch(() => undefined);
    return operation(await this.load());
  }

  async getOrganization(): Promise<Organization> {
    return this.read((database) => database.organization);
  }

  async getSettings(): Promise<OrganizationSettings> {
    return this.read((database) => database.settings);
  }

  async saveSettings(
    patch: Partial<Omit<OrganizationSettings, 'organizationId' | 'updatedAt'>>,
  ): Promise<OrganizationSettings> {
    return this.mutate((database) => {
      database.settings = { ...database.settings, ...patch, updatedAt: now() };
      return database.settings;
    });
  }

  async listCompanies(): Promise<Company[]> {
    return this.read((database) =>
      [...database.companies].sort((a, b) => a.legalName.localeCompare(b.legalName, 'pt-BR')),
    );
  }

  async getCompany(id: string): Promise<Company | null> {
    return this.read((database) => database.companies.find((company) => company.id === id) ?? null);
  }

  async findCompanyByCnpj(cnpj: string): Promise<Company | null> {
    const digits = onlyDigits(cnpj);
    return this.read(
      (database) => database.companies.find((company) => company.cnpj === digits) ?? null,
    );
  }

  async createCompany(input: CompanyInput): Promise<Company> {
    return this.mutate((database) => {
      const timestamp = now();
      const company: Company = {
        id: newId(),
        organizationId: database.organization.id,
        legalName: input.legalName,
        tradeName: input.tradeName,
        cnpj: onlyDigits(input.cnpj),
        stateRegistration: input.stateRegistration,
        municipalRegistration: input.municipalRegistration,
        uf: input.uf,
        municipality: input.municipality,
        taxRegime: input.taxRegime,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      database.companies.push(company);
      return company;
    });
  }

  async updateCompany(
    id: string,
    input: Partial<CompanyInput> & { active?: boolean },
  ): Promise<Company> {
    return this.mutate((database) => {
      const index = database.companies.findIndex((company) => company.id === id);
      const current = database.companies[index];
      if (index === -1 || !current) throw new Error(`Empresa não encontrada: ${id}`);
      const updated: Company = {
        ...current,
        ...input,
        cnpj: input.cnpj ? onlyDigits(input.cnpj) : current.cnpj,
        updatedAt: now(),
      };
      database.companies[index] = updated;
      return updated;
    });
  }

  async listRegimeHistory(companyId: string): Promise<CompanyRegimeHistory[]> {
    return this.read((database) =>
      database.regimeHistory
        .filter((entry) => entry.companyId === companyId)
        .sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
    );
  }

  async addRegimeHistory(input: {
    companyId: string;
    taxRegime: TaxRegime;
    validFrom: Competencia;
    validTo: Competencia | null;
    note: string | null;
  }): Promise<CompanyRegimeHistory> {
    return this.mutate((database) => {
      const entry: CompanyRegimeHistory = {
        id: newId(),
        companyId: input.companyId,
        taxRegime: input.taxRegime,
        validFrom: input.validFrom,
        validTo: input.validTo,
        note: input.note,
        createdAt: now(),
      };
      database.regimeHistory.push(entry);
      return entry;
    });
  }

  async listAudits(filter: { companyId?: string; limit?: number } = {}): Promise<Audit[]> {
    return this.read((database) => {
      let audits = [...database.audits];
      if (filter.companyId) audits = audits.filter((audit) => audit.companyId === filter.companyId);
      audits.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return filter.limit ? audits.slice(0, filter.limit) : audits;
    });
  }

  async getAudit(id: string): Promise<Audit | null> {
    return this.read((database) => database.audits.find((audit) => audit.id === id) ?? null);
  }

  async createAudit(input: AuditInput): Promise<Audit> {
    return this.mutate((database) => {
      const timestamp = now();
      const audit: Audit = {
        id: newId(),
        organizationId: database.organization.id,
        companyId: input.companyId,
        competencia: input.competencia,
        status: 'AGUARDANDO_ARQUIVOS',
        score: null,
        band: null,
        documentCount: 0,
        crossChecksOk: 0,
        startedAt: null,
        finishedAt: null,
        notes: input.notes ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      database.audits.push(audit);
      return audit;
    });
  }

  async updateAudit(id: string, patch: AuditPatch): Promise<Audit> {
    return this.mutate((database) => {
      const index = database.audits.findIndex((audit) => audit.id === id);
      const current = database.audits[index];
      if (index === -1 || !current) throw new Error(`Auditoria não encontrada: ${id}`);
      const updated: Audit = { ...current, ...patch, updatedAt: now() };
      database.audits[index] = updated;
      return updated;
    });
  }

  async deleteAudit(id: string): Promise<void> {
    await this.mutate((database) => {
      database.audits = database.audits.filter((audit) => audit.id !== id);
      database.files = database.files.filter((file) => file.auditId !== id);
      database.findings = database.findings.filter((finding) => finding.auditId !== id);
      delete database.datasets[id];
    });
  }

  async listFiles(auditId: string): Promise<AuditFile[]> {
    return this.read((database) =>
      database.files
        .filter((file) => file.auditId === auditId)
        .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)),
    );
  }

  async getFile(id: string): Promise<AuditFile | null> {
    return this.read((database) => database.files.find((file) => file.id === id) ?? null);
  }

  async findFileByHash(auditId: string, sha256: string): Promise<AuditFile | null> {
    return this.read(
      (database) =>
        database.files.find((file) => file.auditId === auditId && file.sha256 === sha256) ?? null,
    );
  }

  async createFile(input: AuditFileInput): Promise<AuditFile> {
    return this.mutate((database) => {
      const file: AuditFile = {
        id: newId(),
        organizationId: database.organization.id,
        auditId: input.auditId,
        originalName: input.originalName,
        storagePath: input.storagePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        detectedSource: null,
        detectedTaxId: null,
        detectedLegalName: null,
        detectedCompetencia: null,
        detectedStartDate: null,
        detectedEndDate: null,
        identityCheck: 'NAO_IDENTIFICADO',
        reliability: 'REQUER_CONFERENCIA',
        status: 'PENDENTE',
        messages: [],
        stats: null,
        parserVersion: null,
        parseLog: null,
        inspection: null,
        parentFileId: null,
        uploadedAt: now(),
        processedAt: null,
      };
      database.files.push(file);
      return file;
    });
  }

  async updateFile(id: string, patch: AuditFilePatch): Promise<AuditFile> {
    return this.mutate((database) => {
      const index = database.files.findIndex((file) => file.id === id);
      const current = database.files[index];
      if (index === -1 || !current) throw new Error(`Arquivo não encontrado: ${id}`);
      const updated: AuditFile = { ...current, ...patch };
      database.files[index] = updated;
      return updated;
    });
  }

  async deleteFile(id: string): Promise<void> {
    await this.mutate((database) => {
      database.files = database.files.filter((file) => file.id !== id);
    });
  }

  async saveDataset(auditId: string, dataset: StoredDataset): Promise<void> {
    await this.mutate((database) => {
      database.datasets[auditId] = dataset;
    });
  }

  async loadDataset(auditId: string): Promise<StoredDataset | null> {
    return this.read((database) => database.datasets[auditId] ?? null);
  }

  async replaceFindings(auditId: string, findings: readonly AuditFinding[]): Promise<void> {
    await this.mutate((database) => {
      database.findings = database.findings.filter((finding) => finding.auditId !== auditId);
      database.findings.push(...findings);
    });
  }

  async listFindings(filter: FindingFilter): Promise<FindingPage> {
    return this.read((database) => {
      const auditIds = filter.companyId
        ? new Set(
            database.audits
              .filter((audit) => audit.companyId === filter.companyId)
              .map((audit) => audit.id),
          )
        : null;

      const search = filter.search?.trim().toLowerCase() ?? '';
      const filtered = database.findings.filter((finding) => {
        if (filter.auditId && finding.auditId !== filter.auditId) return false;
        if (auditIds && !auditIds.has(finding.auditId)) return false;
        if (filter.severity && finding.severity !== filter.severity) return false;
        if (filter.module && finding.module !== filter.module) return false;
        if (filter.ruleCode && finding.ruleCode !== filter.ruleCode) return false;
        if (filter.reviewStatus && finding.reviewStatus !== filter.reviewStatus) return false;
        if (filter.status && finding.status !== filter.status) return false;
        if (search !== '') {
          const haystack = `${finding.title} ${finding.description} ${finding.documentRef ?? ''}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      });

      filtered.sort(
        (a, b) => severityRank(b.severity) - severityRank(a.severity) || a.ruleCode.localeCompare(b.ruleCode),
      );

      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 50;
      return { items: filtered.slice(offset, offset + limit), total: filtered.length };
    });
  }

  async getFinding(id: string): Promise<AuditFinding | null> {
    return this.read((database) => database.findings.find((finding) => finding.id === id) ?? null);
  }

  async updateFindingReview(id: string, patch: ReviewPatch): Promise<AuditFinding> {
    return this.mutate((database) => {
      const index = database.findings.findIndex((finding) => finding.id === id);
      const current = database.findings[index];
      if (index === -1 || !current) throw new Error(`Divergência não encontrada: ${id}`);
      const timestamp = now();
      const updated: AuditFinding = {
        ...current,
        reviewStatus: patch.reviewStatus,
        reviewNote: patch.reviewNote,
        reviewer: patch.reviewer,
        reviewedAt: timestamp,
        updatedAt: timestamp,
      };
      database.findings[index] = updated;
      return updated;
    });
  }

  async listComments(findingId: string): Promise<AuditComment[]> {
    return this.read((database) =>
      database.comments
        .filter((comment) => comment.findingId === findingId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async addComment(findingId: string, author: string, body: string): Promise<AuditComment> {
    return this.mutate((database) => {
      const comment: AuditComment = {
        id: newId(),
        organizationId: database.organization.id,
        findingId,
        author,
        body,
        createdAt: now(),
      };
      database.comments.push(comment);
      return comment;
    });
  }

  async listRuleSettings(): Promise<RuleSetting[]> {
    return this.read((database) => [...database.ruleSettings]);
  }

  async upsertRuleSetting(input: RuleSettingInput): Promise<RuleSetting> {
    return this.mutate((database) => {
      const index = database.ruleSettings.findIndex((setting) => setting.ruleCode === input.ruleCode);
      const setting: RuleSetting = {
        id: database.ruleSettings[index]?.id ?? newId(),
        organizationId: database.organization.id,
        ruleCode: input.ruleCode,
        enabled: input.enabled,
        severity: input.severity,
        absoluteToleranceCents: input.absoluteToleranceCents,
        percentageTolerance: input.percentageTolerance,
        updatedAt: now(),
      };
      if (index === -1) database.ruleSettings.push(setting);
      else database.ruleSettings[index] = setting;
      return setting;
    });
  }

  async listFieldConfirmations(auditId: string): Promise<FieldConfirmation[]> {
    return this.read((database) =>
      database.fieldConfirmations.filter((entry) => entry.auditId === auditId),
    );
  }

  async upsertFieldConfirmation(input: FieldConfirmationInput): Promise<FieldConfirmation> {
    return this.mutate((database) => {
      const index = database.fieldConfirmations.findIndex(
        (entry) => entry.fileId === input.fileId && entry.field === input.field,
      );
      const confirmation: FieldConfirmation = {
        id: database.fieldConfirmations[index]?.id ?? newId(),
        organizationId: database.organization.id,
        auditId: input.auditId,
        fileId: input.fileId,
        field: input.field,
        // O valor originalmente extraído é preservado no primeiro registro.
        originalValue: database.fieldConfirmations[index]?.originalValue ?? input.originalValue,
        confirmedValue: input.confirmedValue,
        confirmedBy: input.confirmedBy,
        confirmedAt: now(),
        note: input.note,
      };
      if (index === -1) database.fieldConfirmations.push(confirmation);
      else database.fieldConfirmations[index] = confirmation;
      return confirmation;
    });
  }

  async deleteFieldConfirmation(id: string): Promise<void> {
    await this.mutate((database) => {
      database.fieldConfirmations = database.fieldConfirmations.filter((entry) => entry.id !== id);
    });
  }

  async listCfopRules(): Promise<CfopRule[]> {
    return this.read((database) =>
      [...database.cfopRules].sort((a, b) => a.cfop.localeCompare(b.cfop)),
    );
  }

  async upsertCfopRule(input: CfopRuleInput): Promise<CfopRule> {
    return this.mutate((database) => {
      const index = database.cfopRules.findIndex((entry) => entry.cfop === input.cfop);
      const rule: CfopRule = {
        id: database.cfopRules[index]?.id ?? newId(),
        organizationId: database.organization.id,
        cfop: input.cfop,
        description: input.description,
        treatment: input.treatment,
        reason: input.reason,
        ruleSource: input.ruleSource ?? 'CONFIGURADO',
        updatedBy: input.updatedBy,
        updatedAt: now(),
      };
      if (index === -1) database.cfopRules.push(rule);
      else database.cfopRules[index] = rule;
      return rule;
    });
  }

  async deleteCfopRule(cfop: string): Promise<void> {
    await this.mutate((database) => {
      database.cfopRules = database.cfopRules.filter((entry) => entry.cfop !== cfop);
    });
  }
}

const SEVERITY_RANK: Readonly<Record<string, number>> = {
  CRITICA: 5,
  ALTA: 4,
  MEDIA: 3,
  BAIXA: 2,
  INFO: 1,
};

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 0;
}

export function localStorePath(): string {
  return join(process.cwd(), '.data', 'attivare.json');
}
