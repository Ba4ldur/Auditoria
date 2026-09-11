/** Building blocks shared by the audit rules. */

import { formatBRL, type Cents } from '@/lib/core/money';
import { formatIsoDate } from '@/lib/core/dates';
import type { Invoice } from '@/lib/domain/model';
import type { FindingEvidence } from '@/lib/domain/entities';
import type { DataSourceKind } from '@/lib/domain/sources';
import type { AuditDataset } from '@/lib/normalization/dataset';

export type EvidenceDraft = Omit<FindingEvidence, 'id'>;

export function evidence(
  label: string,
  origin: string,
  value: string | null,
  options: { source?: DataSourceKind | null; fileName?: string | null; reference?: string | null } = {},
): EvidenceDraft {
  return {
    label,
    origin,
    value,
    source: options.source ?? null,
    fileName: options.fileName ?? null,
    reference: options.reference ?? null,
  };
}

export function moneyEvidence(
  label: string,
  origin: string,
  amount: Cents,
  options: { source?: DataSourceKind | null; fileName?: string | null; reference?: string | null } = {},
): EvidenceDraft {
  return evidence(label, origin, formatBRL(amount), options);
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
