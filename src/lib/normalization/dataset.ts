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
  RecordOrigin,
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
  /** Versão do parser que interpretou o arquivo (rastreabilidade, fase 3). */
  readonly parserVersion: string | null;
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
  /**
   * `fileId` → versão do parser que produziu os registros daquele arquivo.
   *
   * As regras usam este mapa para carimbar a evidência: o registro normalizado
   * guarda de qual arquivo veio, e é aqui que se descobre com qual leitura de
   * campo aquele arquivo foi interpretado.
   */
  readonly parserVersions: ReadonlyMap<string, string>;
  /**
   * Origens colapsadas pela deduplicação, por `source|chave`, incluindo a
   * ocorrência preservada.
   *
   * A deduplicação existe porque o mesmo XML costuma chegar duas vezes (solto e
   * dentro do ZIP), e contá-lo duas vezes inflaria a receita. Na escrituração,
   * porém, a mesma chave em dois registros C100 é uma duplicidade real, que
   * altera a apuração do período. Colapsar sem registrar faria o sistema apagar
   * exatamente o fato que precisa acusar.
   */
  readonly duplicateOrigins: ReadonlyMap<string, readonly RecordOrigin[]>;
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
  const parserVersions = new Map<string, string>();
  const duplicateOrigins = new Map<string, RecordOrigin[]>();

  for (const { payload, fileId, fileName } of input.payloads) {
    files.push({ fileId, fileName, source: payload.source, parserVersion: payload.parserVersion ?? null });
    if (payload.parserVersion) parserVersions.set(fileId, payload.parserVersion);

    for (const invoice of payload.invoices) {
      availableSources.add(invoice.source);
      const dedupeKey = `${invoice.source}|${invoice.accessKey ?? invoice.id}`;
      const origin: RecordOrigin = {
        ...invoice.origin,
        fileId: invoice.origin.fileId ?? fileId,
        fileName: invoice.origin.fileName ?? fileName,
      };

      const kept = invoicesBySourceKey.get(dedupeKey);
      if (kept) {
        const origins = duplicateOrigins.get(dedupeKey) ?? [kept.origin];
        origins.push(origin);
        duplicateOrigins.set(dedupeKey, origins);
        continue;
      }

      invoicesBySourceKey.set(dedupeKey, {
        ...invoice,
        direction: resolveDirection(invoice, input.company.cnpj),
        origin,
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
    parserVersions,
    duplicateOrigins,
  };
}

/** Ocorrências colapsadas de um documento, ou lista vazia se não houve. */
export function duplicateOriginsOf(
  dataset: AuditDataset,
  source: DataSourceKind,
  accessKey: string,
): readonly RecordOrigin[] {
  return dataset.duplicateOrigins.get(`${source}|${accessKey}`) ?? [];
}

/** Versão do parser que leu o arquivo de onde o registro veio, se conhecida. */
export function parserVersionOf(dataset: AuditDataset, fileId: string | null): string | null {
  if (!fileId) return null;
  return dataset.parserVersions.get(fileId) ?? null;
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
