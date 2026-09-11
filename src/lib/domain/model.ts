/**
 * Normalised fiscal model (requirement 15).
 *
 * The audit engine reads ONLY the types declared here. Parsers translate their
 * native formats (XML, SPED text, PDF) into these structures, so a rule can
 * compare a value coming from an NF-e XML with a value coming from the EFD
 * without knowing anything about either format.
 */

import type { Cents } from '@/lib/core/money';
import type { Competencia } from '@/lib/core/competencia';
import type { DataSourceKind } from './sources';

export type TaxRegime =
  | 'SIMPLES_NACIONAL'
  | 'LUCRO_PRESUMIDO'
  | 'LUCRO_REAL'
  | 'IMUNE_ISENTA'
  | 'OUTRO';

export const TAX_REGIME_LABELS: Readonly<Record<TaxRegime, string>> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
  IMUNE_ISENTA: 'Imune/Isenta',
  OUTRO: 'Outro',
};

export const TAX_REGIMES = Object.keys(TAX_REGIME_LABELS) as TaxRegime[];

/** Direction of the operation from the audited company's point of view. */
export type OperationDirection = 'SAIDA' | 'ENTRADA' | 'INDEFINIDA';

/** Status of a fiscal document. `INDEFINIDA` means the source did not state it. */
export type DocumentStatus =
  | 'AUTORIZADA'
  | 'CANCELADA'
  | 'DENEGADA'
  | 'INUTILIZADA'
  | 'INDEFINIDA';

export type FiscalDocumentKind = 'NFE' | 'NFCE' | 'NFSE' | 'CTE' | 'MDFE' | 'OUTRO';

/** Minimal identity shared by every fiscal document, whatever its origin. */
export interface FiscalDocument {
  readonly source: DataSourceKind;
  readonly documentKind: FiscalDocumentKind;
  /** 44-digit access key, when the document type has one. */
  readonly accessKey: string | null;
  readonly model: string | null;
  readonly serie: string | null;
  readonly number: string | null;
  readonly issueDate: string | null;
  readonly direction: OperationDirection;
  readonly status: DocumentStatus;
  readonly totalValue: Cents;
}

export interface InvoiceTotals {
  readonly produtos: Cents;
  readonly frete: Cents;
  readonly seguro: Cents;
  readonly desconto: Cents;
  readonly outrasDespesas: Cents;
  readonly total: Cents;
  readonly baseIcms: Cents;
  readonly icms: Cents;
  readonly baseIcmsSt: Cents;
  readonly icmsSt: Cents;
  readonly fcp: Cents;
  readonly ipi: Cents;
  readonly basePis: Cents;
  readonly pis: Cents;
  readonly baseCofins: Cents;
  readonly cofins: Cents;
}

export const EMPTY_TOTALS: InvoiceTotals = Object.freeze({
  produtos: 0 as Cents,
  frete: 0 as Cents,
  seguro: 0 as Cents,
  desconto: 0 as Cents,
  outrasDespesas: 0 as Cents,
  total: 0 as Cents,
  baseIcms: 0 as Cents,
  icms: 0 as Cents,
  baseIcmsSt: 0 as Cents,
  icmsSt: 0 as Cents,
  fcp: 0 as Cents,
  ipi: 0 as Cents,
  basePis: 0 as Cents,
  pis: 0 as Cents,
  baseCofins: 0 as Cents,
  cofins: 0 as Cents,
});

export interface InvoiceItem {
  readonly numero: string;
  readonly codigo: string | null;
  readonly descricao: string | null;
  readonly ncm: string | null;
  readonly cest: string | null;
  readonly cfop: string | null;
  /** ICMS situation code: CST for the normal regime, CSOSN for Simples Nacional. */
  readonly cst: string | null;
  readonly csosn: string | null;
  readonly cstPis: string | null;
  readonly cstCofins: string | null;
  readonly unidade: string | null;
  readonly quantidade: number | null;
  readonly valorUnitario: Cents;
  readonly valorProduto: Cents;
  readonly desconto: Cents;
  readonly frete: Cents;
  readonly seguro: Cents;
  readonly outrasDespesas: Cents;
  readonly baseIcms: Cents;
  readonly aliquotaIcms: number | null;
  readonly icms: Cents;
  readonly baseIcmsSt: Cents;
  readonly icmsSt: Cents;
  readonly fcp: Cents;
  readonly ipi: Cents;
  readonly basePis: Cents;
  readonly pis: Cents;
  readonly baseCofins: Cents;
  readonly cofins: Cents;
}

export interface Invoice extends FiscalDocument {
  readonly id: string;
  readonly emitterTaxId: string | null;
  readonly emitterName: string | null;
  readonly emitterUf: string | null;
  readonly recipientTaxId: string | null;
  readonly recipientName: string | null;
  readonly recipientUf: string | null;
  readonly naturezaOperacao: string | null;
  /** Most frequent CFOP among the items, used for document-level comparisons. */
  readonly cfopPrincipal: string | null;
  readonly cfops: readonly string[];
  readonly totals: InvoiceTotals;
  readonly items: readonly InvoiceItem[];
  /** Identifier of the uploaded file this invoice was extracted from. */
  readonly fileId: string | null;
  readonly fileName: string | null;
}

export type RevenueBasis =
  | 'DOCUMENTOS_FISCAIS'
  | 'ESCRITURACAO'
  | 'DECLARACAO';

/**
 * A revenue figure attributed to a period by one specific source.
 *
 * `basis` records HOW the figure was obtained, which is what makes a
 * divergence auditable instead of a bare number.
 */
export interface RevenueRecord {
  readonly id: string;
  readonly source: DataSourceKind;
  readonly competencia: Competencia;
  readonly basis: RevenueBasis;
  readonly amount: Cents;
  /** Human-readable description of the computation (rastreabilidade, req. 21). */
  readonly description: string;
  /** Number of documents/records aggregated into `amount`, when applicable. */
  readonly documentCount: number | null;
  readonly fileId: string | null;
  readonly fileName: string | null;
}

export type TaxKind =
  | 'ICMS'
  | 'ICMS_ST'
  | 'IPI'
  | 'PIS'
  | 'COFINS'
  | 'IRPJ'
  | 'CSLL'
  | 'CPP'
  | 'ISS'
  | 'DAS_TOTAL'
  | 'OUTRO';

export const TAX_KIND_LABELS: Readonly<Record<TaxKind, string>> = {
  ICMS: 'ICMS',
  ICMS_ST: 'ICMS-ST',
  IPI: 'IPI',
  PIS: 'PIS/Pasep',
  COFINS: 'COFINS',
  IRPJ: 'IRPJ',
  CSLL: 'CSLL',
  CPP: 'CPP',
  ISS: 'ISS',
  DAS_TOTAL: 'DAS (total)',
  OUTRO: 'Outro',
};

/**
 * What a `TaxRecord` measures.
 *
 * The distinction matters: the contribution owed for the period and the amount
 * left to collect after credits, withholdings and deductions are different
 * figures, and comparing one against the other would manufacture divergences.
 */
export type TaxMetric = 'DEVIDO_PERIODO' | 'A_RECOLHER';

export const TAX_METRIC_LABELS: Readonly<Record<TaxMetric, string>> = {
  DEVIDO_PERIODO: 'Devido no período',
  A_RECOLHER: 'A recolher',
};

export interface TaxRecord {
  readonly id: string;
  readonly source: DataSourceKind;
  readonly competencia: Competencia;
  readonly tax: TaxKind;
  readonly metric: TaxMetric;
  readonly base: Cents | null;
  readonly amount: Cents;
  readonly description: string;
  readonly fileId: string | null;
  readonly fileName: string | null;
}

/** Confidence attached to a value extracted from a weakly structured source. */
export type ExtractionConfidence = 'ALTA' | 'MEDIA' | 'BAIXA' | 'NAO_IDENTIFICADO';

export interface ExtractedField<T> {
  readonly value: T | null;
  readonly confidence: ExtractionConfidence;
  /** Raw text the value was read from, kept for traceability. */
  readonly evidence: string | null;
}

export function extracted<T>(
  value: T | null,
  confidence: ExtractionConfidence,
  evidence: string | null = null,
): ExtractedField<T> {
  return { value, confidence, evidence };
}

export function notIdentified<T>(): ExtractedField<T> {
  return { value: null, confidence: 'NAO_IDENTIFICADO', evidence: null };
}

export interface DeclarationLine {
  readonly label: string;
  readonly amount: Cents;
  readonly kind: TaxKind | null;
  readonly note?: string;
}

/** A declaration delivered to a tax authority (PGDAS-D, DCTFWeb, ...). */
export interface Declaration {
  readonly id: string;
  readonly source: DataSourceKind;
  readonly competencia: Competencia | null;
  readonly taxId: string | null;
  readonly legalName: string | null;
  readonly period: DeclarationPeriod;
  readonly lines: readonly DeclarationLine[];
  /** Overall confidence of the extraction; drives manual-confirmation prompts. */
  readonly confidence: ExtractionConfidence;
  readonly unresolvedFields: readonly string[];
  readonly fileId: string | null;
  readonly fileName: string | null;
}

/** Period figures of a declaration. */
export interface DeclarationPeriod {
  readonly competencia: ExtractedField<Competencia>;
  readonly grossRevenue: ExtractedField<Cents>;
  /** Receita bruta dos 12 meses anteriores (RBT12), when the declaration states it. */
  readonly rbt12: ExtractedField<Cents>;
  readonly segregatedRevenue: readonly SegregatedRevenue[];
  readonly totalDue: ExtractedField<Cents>;
}

export interface SegregatedRevenue {
  readonly label: string;
  readonly amount: Cents;
  readonly note?: string;
}

/** Registration data of a business partner (SPED register 0150). */
export interface ParticipantRecord {
  readonly id: string;
  readonly source: DataSourceKind;
  readonly code: string;
  readonly name: string | null;
  readonly taxId: string | null;
  readonly uf: string | null;
  readonly stateRegistration: string | null;
  readonly countryCode: string | null;
}

/** Registration data declared by the audited company inside a file. */
export interface FileIdentity {
  readonly taxId: string | null;
  readonly legalName: string | null;
  readonly competencia: Competencia | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly stateRegistration: string | null;
  readonly uf: string | null;
}

export const EMPTY_IDENTITY: FileIdentity = Object.freeze({
  taxId: null,
  legalName: null,
  competencia: null,
  startDate: null,
  endDate: null,
  stateRegistration: null,
  uf: null,
});
