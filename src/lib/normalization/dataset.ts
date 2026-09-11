/**
 * Builds the `AuditDataset` consumed by the rule engine.
 *
 * Two things happen here that no parser can do on its own, because they depend
 * on the audited company:
 *  1. the operation direction is re-expressed from the company's point of view;
 *  2. documents repeated across files (the same NF-e present in a ZIP and in a
 *     stand-alone XML) are collapsed to a single record per source.
 */

import { onlyDigits } from '@/lib/core/cnpj';
import type { Competencia } from '@/lib/core/competencia';
import type {
  Declaration,
  Invoice,
  OperationDirection,
  ParticipantRecord,
  RevenueRecord,
  TaxRecord,
} from '@/lib/domain/model';
import type { Company } from '@/lib/domain/entities';
import type { DataSourceKind } from '@/lib/domain/sources';
import type { ParsedPayload } from '@/lib/parsers/types';

export interface AuditFileSummary {
  readonly fileId: string;
  readonly fileName: string;
  readonly source: DataSourceKind | null;
}

export interface AuditDataset {
  readonly company: Company;
  readonly competencia: Competencia;
  readonly invoices: readonly Invoice[];
  readonly revenues: readonly RevenueRecord[];
  readonly taxes: readonly TaxRecord[];
  readonly declarations: readonly Declaration[];
  readonly participants: readonly ParticipantRecord[];
  readonly files: readonly AuditFileSummary[];
  /** Sources actually present in the dataset; drives rule applicability. */
  readonly availableSources: ReadonlySet<DataSourceKind>;
}

/**
 * Re-expresses the direction of an operation from the audited company's point
 * of view. A document issued by a supplier with `tpNF = 1` (saida) is an
 * ENTRADA for the company receiving it.
 */
export function resolveDirection(invoice: Invoice, companyCnpj: string): OperationDirection {
  const company = onlyDigits(companyCnpj);
  const emitter = onlyDigits(invoice.emitterTaxId ?? '');
  const recipient = onlyDigits(invoice.recipientTaxId ?? '');

  if (emitter !== '' && emitter === company) return 'SAIDA';
  if (recipient !== '' && recipient === company) return 'ENTRADA';
  return invoice.direction;
}

export interface DatasetInput {
  readonly company: Company;
  readonly competencia: Competencia;
  readonly payloads: readonly { payload: ParsedPayload; fileId: string; fileName: string }[];
}

export function buildDataset(input: DatasetInput): AuditDataset {
  const invoicesBySourceKey = new Map<string, Invoice>();
  const revenues: RevenueRecord[] = [];
  const taxes: TaxRecord[] = [];
  const declarations: Declaration[] = [];
  const participants: ParticipantRecord[] = [];
  const files: AuditFileSummary[] = [];
  const availableSources = new Set<DataSourceKind>();

  for (const { payload, fileId, fileName } of input.payloads) {
    files.push({ fileId, fileName, source: payload.source });

    for (const invoice of payload.invoices) {
      availableSources.add(invoice.source);
      const dedupeKey = `${invoice.source}|${invoice.accessKey ?? invoice.id}`;
      if (invoicesBySourceKey.has(dedupeKey)) continue;
      invoicesBySourceKey.set(dedupeKey, {
        ...invoice,
        direction: resolveDirection(invoice, input.company.cnpj),
        fileId: invoice.fileId ?? fileId,
        fileName: invoice.fileName ?? fileName,
      });
    }

    for (const revenue of payload.revenues) {
      availableSources.add(revenue.source);
      revenues.push(revenue);
    }
    for (const tax of payload.taxes) {
      availableSources.add(tax.source);
      taxes.push(tax);
    }
    for (const declaration of payload.declarations) {
      availableSources.add(declaration.source);
      declarations.push(declaration);
    }
    participants.push(...payload.participants);
  }

  return {
    company: input.company,
    competencia: input.competencia,
    invoices: [...invoicesBySourceKey.values()],
    revenues,
    taxes,
    declarations,
    participants,
    files,
    availableSources,
  };
}

export function invoicesFrom(
  dataset: AuditDataset,
  ...sources: readonly DataSourceKind[]
): Invoice[] {
  const wanted = new Set(sources);
  return dataset.invoices.filter((invoice) => wanted.has(invoice.source));
}

/** XML documents, regardless of being NF-e or NFC-e. */
export function xmlInvoices(dataset: AuditDataset): Invoice[] {
  return invoicesFrom(dataset, 'XML_NFE', 'XML_NFCE');
}
