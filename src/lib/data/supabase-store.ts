/**
 * Supabase / PostgreSQL implementation of the persistence port.
 *
 * Every query is scoped by `organization_id`. That scoping is defence in depth:
 * the authoritative isolation is the Row Level Security policy declared in
 * `supabase/migrations`, which the database enforces regardless of what the
 * application sends.
 *
 * Column names are snake_case in the database and camelCase in the domain; the
 * mapping lives entirely in the `row -> entity` functions at the bottom of this
 * file, so a schema change is a local edit.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { onlyDigits } from '@/lib/core/cnpj';
import type { Competencia } from '@/lib/core/competencia';
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
import type { TaxRegime } from '@/lib/domain/model';
import { MAX_UPLOAD_BYTES } from './local-store';
import {
  toAudit,
  toCfopRule,
  toFieldConfirmation,
  toAuditFile,
  toComment,
  toCompany,
  toDeclaration,
  toFinding,
  toInvoice,
  toOrganization,
  toParticipant,
  toRegimeHistory,
  toRevenueRecord,
  toRuleSetting,
  toSettings,
  toTaxRecord,
  type Row,
} from './supabase-mappers';
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

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${context}: nenhum registro retornado.`);
  return result.data;
}

export class SupabaseStore implements DataStore {
  readonly kind = 'supabase' as const;

  constructor(
    private readonly client: SupabaseClient,
    private readonly organizationId: string,
  ) {}

  async getOrganization(): Promise<Organization> {
    const result = await this.client
      .from('organizations')
      .select('*')
      .eq('id', this.organizationId)
      .single();
    return toOrganization(unwrap(result, 'Falha ao carregar organização'));
  }

  async getSettings(): Promise<OrganizationSettings> {
    const { data, error } = await this.client
      .from('organization_settings')
      .select('*')
      .eq('organization_id', this.organizationId)
      .maybeSingle();
    if (error) throw new Error(`Falha ao carregar configurações: ${error.message}`);
    if (!data) {
      return {
        organizationId: this.organizationId,
        scoreWeights: DEFAULT_SCORE_WEIGHTS,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        updatedAt: new Date().toISOString(),
      };
    }
    return toSettings(data as Row);
  }

  async saveSettings(
    patch: Partial<Omit<OrganizationSettings, 'organizationId' | 'updatedAt'>>,
  ): Promise<OrganizationSettings> {
    const current = await this.getSettings();
    const merged = { ...current, ...patch };
    const result = await this.client
      .from('organization_settings')
      .upsert(
        {
          organization_id: this.organizationId,
          score_weights: merged.scoreWeights,
          max_upload_bytes: merged.maxUploadBytes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      )
      .select()
      .single();
    return toSettings(unwrap(result, 'Falha ao salvar configurações'));
  }

  async listCompanies(): Promise<Company[]> {
    const result = await this.client
      .from('companies')
      .select('*')
      .eq('organization_id', this.organizationId)
      .order('legal_name', { ascending: true });
    return unwrap(result, 'Falha ao listar empresas').map(toCompany);
  }

  async getCompany(id: string): Promise<Company | null> {
    const { data, error } = await this.client
      .from('companies')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao carregar empresa: ${error.message}`);
    return data ? toCompany(data as Row) : null;
  }

  async findCompanyByCnpj(cnpj: string): Promise<Company | null> {
    const { data, error } = await this.client
      .from('companies')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('cnpj', onlyDigits(cnpj))
      .maybeSingle();
    if (error) throw new Error(`Falha ao consultar empresa por CNPJ: ${error.message}`);
    return data ? toCompany(data as Row) : null;
  }

  async createCompany(input: CompanyInput): Promise<Company> {
    const result = await this.client
      .from('companies')
      .insert({
        organization_id: this.organizationId,
        legal_name: input.legalName,
        trade_name: input.tradeName,
        cnpj: onlyDigits(input.cnpj),
        state_registration: input.stateRegistration,
        municipal_registration: input.municipalRegistration,
        uf: input.uf,
        municipality: input.municipality,
        tax_regime: input.taxRegime,
      })
      .select()
      .single();
    return toCompany(unwrap(result, 'Falha ao cadastrar empresa'));
  }

  async updateCompany(
    id: string,
    input: Partial<CompanyInput> & { active?: boolean },
  ): Promise<Company> {
    const patch: Row = { updated_at: new Date().toISOString() };
    if (input.legalName !== undefined) patch.legal_name = input.legalName;
    if (input.tradeName !== undefined) patch.trade_name = input.tradeName;
    if (input.cnpj !== undefined) patch.cnpj = onlyDigits(input.cnpj);
    if (input.stateRegistration !== undefined) patch.state_registration = input.stateRegistration;
    if (input.municipalRegistration !== undefined) patch.municipal_registration = input.municipalRegistration;
    if (input.uf !== undefined) patch.uf = input.uf;
    if (input.municipality !== undefined) patch.municipality = input.municipality;
    if (input.taxRegime !== undefined) patch.tax_regime = input.taxRegime;
    if (input.active !== undefined) patch.active = input.active;

    const result = await this.client
      .from('companies')
      .update(patch)
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .select()
      .single();
    return toCompany(unwrap(result, 'Falha ao atualizar empresa'));
  }

  async listRegimeHistory(companyId: string): Promise<CompanyRegimeHistory[]> {
    const result = await this.client
      .from('company_regime_history')
      .select('*')
      .eq('company_id', companyId)
      .order('valid_from', { ascending: false });
    return unwrap(result, 'Falha ao listar histórico de regime').map(toRegimeHistory);
  }

  async addRegimeHistory(input: {
    companyId: string;
    taxRegime: TaxRegime;
    validFrom: Competencia;
    validTo: Competencia | null;
    note: string | null;
  }): Promise<CompanyRegimeHistory> {
    const result = await this.client
      .from('company_regime_history')
      .insert({
        organization_id: this.organizationId,
        company_id: input.companyId,
        tax_regime: input.taxRegime,
        valid_from: input.validFrom,
        valid_to: input.validTo,
        note: input.note,
      })
      .select()
      .single();
    return toRegimeHistory(unwrap(result, 'Falha ao registrar mudanca de regime'));
  }

  async listAudits(filter: { companyId?: string; limit?: number } = {}): Promise<Audit[]> {
    let query = this.client
      .from('audits')
      .select('*')
      .eq('organization_id', this.organizationId)
      .order('created_at', { ascending: false });
    if (filter.companyId) query = query.eq('company_id', filter.companyId);
    if (filter.limit) query = query.limit(filter.limit);
    return unwrap(await query, 'Falha ao listar auditorias').map(toAudit);
  }

  async getAudit(id: string): Promise<Audit | null> {
    const { data, error } = await this.client
      .from('audits')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao carregar auditoria: ${error.message}`);
    return data ? toAudit(data as Row) : null;
  }

  async createAudit(input: AuditInput): Promise<Audit> {
    const result = await this.client
      .from('audits')
      .insert({
        organization_id: this.organizationId,
        company_id: input.companyId,
        competencia: input.competencia,
        status: 'AGUARDANDO_ARQUIVOS',
        notes: input.notes ?? null,
      })
      .select()
      .single();
    return toAudit(unwrap(result, 'Falha ao criar auditoria'));
  }

  async updateAudit(id: string, patch: AuditPatch): Promise<Audit> {
    const row: Row = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.score !== undefined) row.score = patch.score;
    if (patch.band !== undefined) row.band = patch.band;
    if (patch.documentCount !== undefined) row.document_count = patch.documentCount;
    if (patch.crossChecksOk !== undefined) row.cross_checks_ok = patch.crossChecksOk;
    if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
    if (patch.finishedAt !== undefined) row.finished_at = patch.finishedAt;
    if (patch.notes !== undefined) row.notes = patch.notes;

    const result = await this.client
      .from('audits')
      .update(row)
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .select()
      .single();
    return toAudit(unwrap(result, 'Falha ao atualizar auditoria'));
  }

  async deleteAudit(id: string): Promise<void> {
    const { error } = await this.client
      .from('audits')
      .delete()
      .eq('organization_id', this.organizationId)
      .eq('id', id);
    if (error) throw new Error(`Falha ao excluir auditoria: ${error.message}`);
  }

  async listFiles(auditId: string): Promise<AuditFile[]> {
    const result = await this.client
      .from('audit_files')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('audit_id', auditId)
      .order('uploaded_at', { ascending: true });
    return unwrap(result, 'Falha ao listar arquivos').map(toAuditFile);
  }

  async getFile(id: string): Promise<AuditFile | null> {
    const { data, error } = await this.client
      .from('audit_files')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao carregar arquivo: ${error.message}`);
    return data ? toAuditFile(data as Row) : null;
  }

  async findFileByHash(auditId: string, sha256: string): Promise<AuditFile | null> {
    const { data, error } = await this.client
      .from('audit_files')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('audit_id', auditId)
      .eq('sha256', sha256)
      .maybeSingle();
    if (error) throw new Error(`Falha ao consultar arquivo por hash: ${error.message}`);
    return data ? toAuditFile(data as Row) : null;
  }

  async createFile(input: AuditFileInput): Promise<AuditFile> {
    const result = await this.client
      .from('audit_files')
      .insert({
        organization_id: this.organizationId,
        audit_id: input.auditId,
        original_name: input.originalName,
        storage_path: input.storagePath,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        sha256: input.sha256,
        status: 'PENDENTE',
        identity_check: 'NAO_IDENTIFICADO',
        reliability: 'REQUER_CONFERENCIA',
        messages: [],
      })
      .select()
      .single();
    return toAuditFile(unwrap(result, 'Falha ao registrar arquivo'));
  }

  async updateFile(id: string, patch: AuditFilePatch): Promise<AuditFile> {
    const row: Row = {};
    if (patch.storagePath !== undefined) row.storage_path = patch.storagePath;
    if (patch.detectedSource !== undefined) row.detected_source = patch.detectedSource;
    if (patch.detectedTaxId !== undefined) row.detected_tax_id = patch.detectedTaxId;
    if (patch.detectedLegalName !== undefined) row.detected_legal_name = patch.detectedLegalName;
    if (patch.detectedCompetencia !== undefined) row.detected_competencia = patch.detectedCompetencia;
    if (patch.detectedStartDate !== undefined) row.detected_start_date = patch.detectedStartDate;
    if (patch.detectedEndDate !== undefined) row.detected_end_date = patch.detectedEndDate;
    if (patch.identityCheck !== undefined) row.identity_check = patch.identityCheck;
    if (patch.reliability !== undefined) row.reliability = patch.reliability;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.messages !== undefined) row.messages = patch.messages;
    if (patch.stats !== undefined) row.stats = patch.stats;
    if (patch.parserVersion !== undefined) row.parser_version = patch.parserVersion;
    if (patch.parseLog !== undefined) row.parse_log = patch.parseLog;
    if (patch.inspection !== undefined) row.inspection = patch.inspection;
    if (patch.processedAt !== undefined) row.processed_at = patch.processedAt;

    const result = await this.client
      .from('audit_files')
      .update(row)
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .select()
      .single();
    return toAuditFile(unwrap(result, 'Falha ao atualizar arquivo'));
  }

  async deleteFile(id: string): Promise<void> {
    const { error } = await this.client
      .from('audit_files')
      .delete()
      .eq('organization_id', this.organizationId)
      .eq('id', id);
    if (error) throw new Error(`Falha ao excluir arquivo: ${error.message}`);
  }

  /**
   * Persists the normalised dataset.
   *
   * Documents and their items go to dedicated tables so they can be indexed and
   * paginated; the period aggregates go to the tables that mirror their domain
   * shape. Everything is replaced atomically per audit: a reprocessing always
   * starts from a clean dataset.
   */
  async saveDataset(auditId: string, dataset: StoredDataset): Promise<void> {
    for (const table of [
      'invoice_items',
      'invoices',
      'revenue_records',
      'tax_records',
      'declarations',
      'participant_records',
    ]) {
      const deletion = await this.client.from(table).delete().eq('audit_id', auditId);
      if (deletion.error) {
        throw new Error(`Falha ao limpar ${table}: ${deletion.error.message}`);
      }
    }

    const CHUNK = 500;
    for (let index = 0; index < dataset.invoices.length; index += CHUNK) {
      const slice = dataset.invoices.slice(index, index + CHUNK);
      const invoiceRows = slice.map((invoice) => ({
        id: invoice.id,
        organization_id: this.organizationId,
        audit_id: auditId,
        source: invoice.source,
        document_kind: invoice.documentKind,
        access_key: invoice.accessKey,
        model: invoice.model,
        serie: invoice.serie,
        number: invoice.number,
        issue_date: invoice.issueDate,
        direction: invoice.direction,
        status: invoice.status,
        total_value: invoice.totalValue,
        emitter_tax_id: invoice.emitterTaxId,
        emitter_name: invoice.emitterName,
        emitter_uf: invoice.emitterUf,
        recipient_tax_id: invoice.recipientTaxId,
        recipient_name: invoice.recipientName,
        recipient_uf: invoice.recipientUf,
        natureza_operacao: invoice.naturezaOperacao,
        cfop_principal: invoice.cfopPrincipal,
        cfops: invoice.cfops,
        totals: invoice.totals,
        file_id: invoice.origin.fileId,
        file_name: invoice.origin.fileName,
        origin_record_code: invoice.origin.recordCode,
        origin_line_number: invoice.origin.lineNumber,
        origin_entry_name: invoice.origin.entryName,
      }));
      const inserted = await this.client.from('invoices').insert(invoiceRows);
      if (inserted.error) throw new Error(`Falha ao gravar documentos: ${inserted.error.message}`);

      const itemRows = slice.flatMap((invoice) =>
        invoice.items.map((item, position) => ({
          organization_id: this.organizationId,
          invoice_id: invoice.id,
          audit_id: auditId,
          position,
          data: item,
        })),
      );
      for (let cursor = 0; cursor < itemRows.length; cursor += CHUNK) {
        const itemsInserted = await this.client
          .from('invoice_items')
          .insert(itemRows.slice(cursor, cursor + CHUNK));
        if (itemsInserted.error) {
          throw new Error(`Falha ao gravar itens dos documentos: ${itemsInserted.error.message}`);
        }
      }
    }

    if (dataset.revenues.length > 0) {
      const inserted = await this.client.from('revenue_records').insert(
        dataset.revenues.map((revenue) => ({
          id: revenue.id,
          organization_id: this.organizationId,
          audit_id: auditId,
          source: revenue.source,
          competencia: revenue.competencia,
          basis: revenue.basis,
          amount: revenue.amount,
          description: revenue.description,
          document_count: revenue.documentCount,
          file_id: revenue.origin.fileId,
          file_name: revenue.origin.fileName,
          origin_record_code: revenue.origin.recordCode,
          origin_line_number: revenue.origin.lineNumber,
          origin_entry_name: revenue.origin.entryName,
        })),
      );
      if (inserted.error) throw new Error(`Falha ao gravar receitas: ${inserted.error.message}`);
    }

    if (dataset.taxes.length > 0) {
      const inserted = await this.client.from('tax_records').insert(
        dataset.taxes.map((tax) => ({
          id: tax.id,
          organization_id: this.organizationId,
          audit_id: auditId,
          source: tax.source,
          competencia: tax.competencia,
          tax: tax.tax,
          metric: tax.metric,
          base: tax.base,
          amount: tax.amount,
          description: tax.description,
          file_id: tax.origin.fileId,
          file_name: tax.origin.fileName,
          origin_record_code: tax.origin.recordCode,
          origin_line_number: tax.origin.lineNumber,
          origin_entry_name: tax.origin.entryName,
        })),
      );
      if (inserted.error) throw new Error(`Falha ao gravar tributos: ${inserted.error.message}`);
    }

    if (dataset.declarations.length > 0) {
      const inserted = await this.client.from('declarations').insert(
        dataset.declarations.map((declaration) => ({
          id: declaration.id,
          organization_id: this.organizationId,
          audit_id: auditId,
          source: declaration.source,
          competencia: declaration.competencia,
          tax_id: declaration.taxId,
          legal_name: declaration.legalName,
          period: declaration.period,
          lines: declaration.lines,
          confidence: declaration.confidence,
          unresolved_fields: declaration.unresolvedFields,
          file_id: declaration.origin.fileId,
          file_name: declaration.origin.fileName,
          origin_record_code: declaration.origin.recordCode,
          origin_line_number: declaration.origin.lineNumber,
          origin_entry_name: declaration.origin.entryName,
        })),
      );
      if (inserted.error) throw new Error(`Falha ao gravar declarações: ${inserted.error.message}`);
    }

    if (dataset.participants.length > 0) {
      const inserted = await this.client.from('participant_records').insert(
        dataset.participants.map((participant) => ({
          id: participant.id,
          organization_id: this.organizationId,
          audit_id: auditId,
          source: participant.source,
          code: participant.code,
          name: participant.name,
          tax_id: participant.taxId,
          uf: participant.uf,
          state_registration: participant.stateRegistration,
          country_code: participant.countryCode,
          file_id: participant.origin.fileId,
          file_name: participant.origin.fileName,
          origin_record_code: participant.origin.recordCode,
          origin_line_number: participant.origin.lineNumber,
          origin_entry_name: participant.origin.entryName,
        })),
      );
      if (inserted.error) throw new Error(`Falha ao gravar participantes: ${inserted.error.message}`);
    }
  }

  async loadDataset(auditId: string): Promise<StoredDataset | null> {
    const invoicesResult = await this.client
      .from('invoices')
      .select('*, invoice_items(position, data)')
      .eq('organization_id', this.organizationId)
      .eq('audit_id', auditId);
    if (invoicesResult.error) {
      throw new Error(`Falha ao carregar documentos: ${invoicesResult.error.message}`);
    }

    const [revenues, taxes, declarations, participants] = await Promise.all([
      this.selectByAudit('revenue_records', auditId),
      this.selectByAudit('tax_records', auditId),
      this.selectByAudit('declarations', auditId),
      this.selectByAudit('participant_records', auditId),
    ]);

    const invoices = (invoicesResult.data ?? []).map(toInvoice);
    if (
      invoices.length === 0 &&
      revenues.length === 0 &&
      taxes.length === 0 &&
      declarations.length === 0
    ) {
      return null;
    }

    return {
      invoices,
      revenues: revenues.map(toRevenueRecord),
      taxes: taxes.map(toTaxRecord),
      declarations: declarations.map(toDeclaration),
      participants: participants.map(toParticipant),
    };
  }

  private async selectByAudit(table: string, auditId: string): Promise<Row[]> {
    const result = await this.client
      .from(table)
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('audit_id', auditId);
    if (result.error) throw new Error(`Falha ao carregar ${table}: ${result.error.message}`);
    return (result.data ?? []) as Row[];
  }

  async replaceFindings(auditId: string, findings: readonly AuditFinding[]): Promise<void> {
    const deletion = await this.client
      .from('audit_findings')
      .delete()
      .eq('organization_id', this.organizationId)
      .eq('audit_id', auditId);
    if (deletion.error) throw new Error(`Falha ao limpar divergências: ${deletion.error.message}`);
    if (findings.length === 0) return;

    const rows = findings.map((finding) => ({
      id: finding.id,
      organization_id: this.organizationId,
      audit_id: auditId,
      rule_code: finding.ruleCode,
      rule_name: finding.ruleName,
      module: finding.module,
      severity: finding.severity,
      status: finding.status,
      nature: finding.nature,
      title: finding.title,
      description: finding.description,
      document_ref: finding.documentRef,
      origin_label: finding.originLabel,
      origin_value: finding.originValue,
      target_label: finding.targetLabel,
      target_value: finding.targetValue,
      difference: finding.difference,
      human_review_note: finding.humanReviewNote,
      review_status: finding.reviewStatus,
      review_note: finding.reviewNote,
      reviewer: finding.reviewer,
      reviewed_at: finding.reviewedAt,
    }));
    const inserted = await this.client.from('audit_findings').insert(rows);
    if (inserted.error) throw new Error(`Falha ao gravar divergências: ${inserted.error.message}`);

    const evidenceRows = findings.flatMap((finding) =>
      finding.evidence.map((item) => ({
        id: item.id,
        organization_id: this.organizationId,
        finding_id: finding.id,
        label: item.label,
        origin: item.origin,
        value: item.value,
        source: item.source,
        file_name: item.fileName,
        record_code: item.recordCode,
        line_number: item.lineNumber,
        reference: item.reference,
      })),
    );
    if (evidenceRows.length > 0) {
      const evidenceInserted = await this.client.from('audit_finding_evidence').insert(evidenceRows);
      if (evidenceInserted.error) {
        throw new Error(`Falha ao gravar evidências: ${evidenceInserted.error.message}`);
      }
    }
  }

  async listFindings(filter: FindingFilter): Promise<FindingPage> {
    let query = this.client
      .from('audit_findings')
      .select('*, audit_finding_evidence(*), audits!inner(company_id)', { count: 'exact' })
      .eq('organization_id', this.organizationId);

    if (filter.auditId) query = query.eq('audit_id', filter.auditId);
    if (filter.companyId) query = query.eq('audits.company_id', filter.companyId);
    if (filter.severity) query = query.eq('severity', filter.severity);
    if (filter.module) query = query.eq('module', filter.module);
    if (filter.ruleCode) query = query.eq('rule_code', filter.ruleCode);
    if (filter.reviewStatus) query = query.eq('review_status', filter.reviewStatus);
    if (filter.status) query = query.eq('status', filter.status);
    if (filter.search) query = query.ilike('title', `%${filter.search}%`);

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    const { data, error, count } = await query
      .order('severity', { ascending: false })
      .order('rule_code', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(`Falha ao listar divergências: ${error.message}`);

    return { items: (data ?? []).map(toFinding), total: count ?? (data ?? []).length };
  }

  async getFinding(id: string): Promise<AuditFinding | null> {
    const { data, error } = await this.client
      .from('audit_findings')
      .select('*, audit_finding_evidence(*)')
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao carregar divergência: ${error.message}`);
    return data ? toFinding(data as Row) : null;
  }

  async updateFindingReview(id: string, patch: ReviewPatch): Promise<AuditFinding> {
    const result = await this.client
      .from('audit_findings')
      .update({
        review_status: patch.reviewStatus,
        review_note: patch.reviewNote,
        reviewer: patch.reviewer,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .select('*, audit_finding_evidence(*)')
      .single();
    return toFinding(unwrap(result, 'Falha ao atualizar divergência'));
  }

  async listComments(findingId: string): Promise<AuditComment[]> {
    const result = await this.client
      .from('audit_comments')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('finding_id', findingId)
      .order('created_at', { ascending: true });
    return unwrap(result, 'Falha ao listar comentarios').map(toComment);
  }

  async addComment(findingId: string, author: string, body: string): Promise<AuditComment> {
    const result = await this.client
      .from('audit_comments')
      .insert({
        organization_id: this.organizationId,
        finding_id: findingId,
        author,
        body,
      })
      .select()
      .single();
    return toComment(unwrap(result, 'Falha ao registrar comentario'));
  }

  async listRuleSettings(): Promise<RuleSetting[]> {
    const result = await this.client
      .from('audit_rules')
      .select('*')
      .eq('organization_id', this.organizationId);
    return unwrap(result, 'Falha ao listar configurações de regras').map(toRuleSetting);
  }

  async upsertRuleSetting(input: RuleSettingInput): Promise<RuleSetting> {
    const result = await this.client
      .from('audit_rules')
      .upsert(
        {
          organization_id: this.organizationId,
          rule_code: input.ruleCode,
          enabled: input.enabled,
          severity: input.severity,
          absolute_tolerance_cents: input.absoluteToleranceCents,
          percentage_tolerance: input.percentageTolerance,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,rule_code' },
      )
      .select()
      .single();
    return toRuleSetting(unwrap(result, 'Falha ao salvar configuração da regra'));
  }

  async listFieldConfirmations(auditId: string): Promise<FieldConfirmation[]> {
    const result = await this.client
      .from('field_confirmations')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('audit_id', auditId);
    return unwrap(result, 'Falha ao listar confirmações manuais').map(toFieldConfirmation);
  }

  async upsertFieldConfirmation(input: FieldConfirmationInput): Promise<FieldConfirmation> {
    const existing = await this.client
      .from('field_confirmations')
      .select('original_value')
      .eq('organization_id', this.organizationId)
      .eq('file_id', input.fileId)
      .eq('field', input.field)
      .maybeSingle();
    if (existing.error) {
      throw new Error(`Falha ao consultar confirmação: ${existing.error.message}`);
    }

    const result = await this.client
      .from('field_confirmations')
      .upsert(
        {
          organization_id: this.organizationId,
          audit_id: input.auditId,
          file_id: input.fileId,
          field: input.field,
          // Preserva o valor lido originalmente pelo parser.
          original_value:
            (existing.data?.original_value as string | null | undefined) ?? input.originalValue,
          confirmed_value: input.confirmedValue,
          confirmed_by: input.confirmedBy,
          confirmed_at: new Date().toISOString(),
          note: input.note,
        },
        { onConflict: 'file_id,field' },
      )
      .select()
      .single();
    return toFieldConfirmation(unwrap(result, 'Falha ao gravar confirmação manual'));
  }

  async deleteFieldConfirmation(id: string): Promise<void> {
    const { error } = await this.client
      .from('field_confirmations')
      .delete()
      .eq('organization_id', this.organizationId)
      .eq('id', id);
    if (error) throw new Error(`Falha ao remover confirmação: ${error.message}`);
  }

  async listCfopRules(): Promise<CfopRule[]> {
    const result = await this.client
      .from('cfop_rules')
      .select('*')
      .eq('organization_id', this.organizationId)
      .order('cfop', { ascending: true });
    return unwrap(result, 'Falha ao listar a política de receita').map(toCfopRule);
  }

  async upsertCfopRule(input: CfopRuleInput): Promise<CfopRule> {
    const result = await this.client
      .from('cfop_rules')
      .upsert(
        {
          organization_id: this.organizationId,
          cfop: input.cfop,
          description: input.description,
          treatment: input.treatment,
          reason: input.reason,
          rule_source: input.ruleSource ?? 'CONFIGURADO',
          updated_by: input.updatedBy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,cfop' },
      )
      .select()
      .single();
    return toCfopRule(unwrap(result, 'Falha ao salvar a regra de CFOP'));
  }

  async deleteCfopRule(cfop: string): Promise<void> {
    const { error } = await this.client
      .from('cfop_rules')
      .delete()
      .eq('organization_id', this.organizationId)
      .eq('cfop', cfop);
    if (error) throw new Error(`Falha ao remover a regra de CFOP: ${error.message}`);
  }
}
