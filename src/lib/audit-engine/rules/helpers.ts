/** Building blocks shared by the audit rules. */

import { formatBRL, type Cents } from '@/lib/core/money';
import { formatIsoDate } from '@/lib/core/dates';
import type { Invoice, RecordOrigin } from '@/lib/domain/model';
import type { FindingEvidence } from '@/lib/domain/entities';
import type { DataSourceKind } from '@/lib/domain/sources';
import { parserVersionOf, type AuditDataset } from '@/lib/normalization/dataset';

export type EvidenceDraft = Omit<FindingEvidence, 'id'>;

export interface EvidenceOptions {
  readonly source?: DataSourceKind | null;
  /** Origem completa do valor; preenche arquivo, registro e linha de uma vez. */
  readonly from?: RecordOrigin | null;
  readonly fileName?: string | null;
  readonly reference?: string | null;
  /**
   * Nome oficial do campo lido (`VL_DOC`, `CHV_NFE`, `vNF`). Fica separado da
   * frase de origem para que a conferência contra o leiaute seja direta.
   */
  readonly field?: string | null;
  /** Versão do parser; normalmente resolvida pelo `tracer` a partir do arquivo. */
  readonly parserVersion?: string | null;
}

export function evidence(
  label: string,
  origin: string,
  value: string | null,
  options: EvidenceOptions = {},
): EvidenceDraft {
  return {
    label,
    origin,
    value,
    source: options.source ?? null,
    fileName: options.fileName ?? options.from?.entryName ?? options.from?.fileName ?? null,
    recordCode: options.from?.recordCode ?? null,
    fieldName: options.field ?? null,
    lineNumber: options.from?.lineNumber ?? null,
    parserVersion: options.parserVersion ?? null,
    reference: options.reference ?? null,
  };
}

export function moneyEvidence(
  label: string,
  origin: string,
  amount: Cents,
  options: EvidenceOptions = {},
): EvidenceDraft {
  return evidence(label, origin, formatBRL(amount), options);
}

/**
 * Fábrica de evidências ligada ao dataset da auditoria.
 *
 * Existe por um motivo só: a versão do parser não está no registro normalizado,
 * está no arquivo de onde ele veio. Passar o dataset uma vez evita que cada
 * regra tenha de repetir essa busca — e evita que alguém a esqueça, deixando a
 * evidência sem dizer qual leitura de campo produziu o valor.
 */
export interface Tracer {
  evidence(label: string, origin: string, value: string | null, options?: EvidenceOptions): EvidenceDraft;
  money(label: string, origin: string, amount: Cents, options?: EvidenceOptions): EvidenceDraft;
}

export function tracer(dataset: AuditDataset): Tracer {
  const resolve = (options: EvidenceOptions): EvidenceOptions => ({
    ...options,
    parserVersion: options.parserVersion ?? parserVersionOf(dataset, options.from?.fileId ?? null),
  });
  return {
    evidence: (label, origin, value, options = {}) => evidence(label, origin, value, resolve(options)),
    money: (label, origin, amount, options = {}) => moneyEvidence(label, origin, amount, resolve(options)),
  };
}

/** Documents excluded from cross-checks because they carry no fiscal effect. */
export const INEFFECTIVE_STATUSES = new Set(['CANCELADA', 'DENEGADA', 'INUTILIZADA']);

export function isEffective(invoice: Invoice): boolean {
  return !INEFFECTIVE_STATUSES.has(invoice.status);
}

/** Indexes invoices by access key, keeping only documents that have one. */
export function byAccessKey(invoices: readonly Invoice[]): Map<string, Invoice> {
  const map = new Map<string, Invoice>();
  for (const invoice of invoices) {
    if (!invoice.accessKey) continue;
    if (!map.has(invoice.accessKey)) map.set(invoice.accessKey, invoice);
  }
  return map;
}

export function describeInvoice(invoice: Invoice): string {
  const parts: string[] = [];
  if (invoice.model) parts.push(`mod. ${invoice.model}`);
  if (invoice.serie) parts.push(`serie ${invoice.serie}`);
  if (invoice.number) parts.push(`n. ${invoice.number}`);
  if (invoice.issueDate) parts.push(formatIsoDate(invoice.issueDate));
  return parts.length > 0 ? parts.join(' · ') : (invoice.accessKey ?? 'documento sem identificação');
}

export function invoiceReference(invoice: Invoice): string {
  return invoice.accessKey ?? `${invoice.model ?? '??'}-${invoice.serie ?? '0'}-${invoice.number ?? '0'}`;
}

export function hasSources(dataset: AuditDataset, sources: readonly DataSourceKind[]): boolean {
  return sources.every((source) => dataset.availableSources.has(source));
}

export function missingSources(
  dataset: AuditDataset,
  sources: readonly DataSourceKind[],
): DataSourceKind[] {
  return sources.filter((source) => !dataset.availableSources.has(source));
}

/**
 * Caps the number of individual findings a rule emits, so a systematic failure
 * (e.g. an entire month not booked) produces a readable report instead of ten
 * thousand rows. The remainder is reported as a single aggregate finding.
 */
export const MAX_INDIVIDUAL_FINDINGS = 200;
