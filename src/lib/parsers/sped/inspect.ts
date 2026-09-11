/**
 * Inspeção técnica de arquivos SPED (fase 2, requisitos 2, 4 e 9).
 *
 * A inspeção é feita sob demanda a partir dos bytes do arquivo já armazenado:
 * nada é persistido além do resumo. Um EFD com 14 mil registros C170 não cabe
 * em memória do navegador nem faz sentido guardar duplicado no banco — a
 * paginação percorre o arquivo e devolve apenas a página pedida.
 */

import { addCents, parseDecimalToCentsOrZero, ZERO, type Cents } from '@/lib/core/money';
import { spedDateToIso } from '@/lib/core/dates';
import { decodeSped, field, readSpedRecords } from './reader';
import { catalogueFor, type SpedCatalogue, type SpedFieldSpec } from './fields';

export type SpedObligation = 'EFD_ICMS_IPI' | 'EFD_CONTRIBUICOES';

export interface RegisterCount {
  readonly code: string;
  readonly description: string | null;
  readonly count: number;
  /** Falso quando o registro existe no arquivo mas não é lido pelo parser. */
  readonly supported: boolean;
}

export interface SpedSummary {
  readonly obligation: SpedObligation;
  readonly totalLines: number;
  readonly totalRecords: number;
  readonly registers: readonly RegisterCount[];
  readonly supportedRecords: number;
  readonly unsupportedRecords: number;
  readonly unsupportedCodes: readonly string[];
}

/** Percorre o arquivo uma única vez e conta os registros. */
export function summariseSped(content: string, obligation: SpedObligation): SpedSummary {
  const catalogue = catalogueFor(obligation);
  const counts = new Map<string, number>();
  let totalRecords = 0;
  let lastLine = 0;

  for (const record of readSpedRecords(content)) {
    totalRecords += 1;
    lastLine = record.line;
    counts.set(record.code, (counts.get(record.code) ?? 0) + 1);
  }

  const registers: RegisterCount[] = [...counts.entries()]
    .map(([code, count]) => {
      const spec = catalogue.get(code);
      return {
        code,
        description: spec?.description ?? null,
        count,
        supported: spec !== undefined,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const supportedRecords = registers
    .filter((entry) => entry.supported)
    .reduce((sum, entry) => sum + entry.count, 0);

  return {
    obligation,
    // A última linha lida é o melhor indicador do tamanho do arquivo, já que
    // linhas em branco são descartadas pelo leitor.
    totalLines: lastLine,
    totalRecords,
    registers,
    supportedRecords,
    unsupportedRecords: totalRecords - supportedRecords,
    unsupportedCodes: registers.filter((entry) => !entry.supported).map((entry) => entry.code),
  };
}

export interface InterpretedField {
  readonly position: number;
  readonly name: string;
  readonly label: string;
  readonly type: SpedFieldSpec['type'];
  /** Conteúdo bruto da posição, exatamente como está no arquivo. */
  readonly raw: string | null;
  /** Leitura do sistema: valor em centavos, data ISO, ou o próprio texto. */
  readonly interpreted: string | null;
}

export interface InspectedRecord {
  readonly line: number;
  readonly code: string;
  /** Linha original do arquivo, reconstruída a partir das posições lidas. */
  readonly rawLine: string;
  readonly fields: readonly InterpretedField[];
  /** Posições presentes na linha e ausentes do catálogo deste parser. */
  readonly extraPositions: number;
}

export interface SpedPage {
  readonly code: string;
  readonly description: string | null;
  readonly supported: boolean;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly records: readonly InspectedRecord[];
  readonly fields: readonly SpedFieldSpec[];
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/**
 * Interpreta um valor conforme o tipo declarado no catálogo.
 *
 * A interpretação apresentada é a mesma que o parser aplica, para que a
 * conferência compare o que o sistema realmente entendeu — e não uma
 * formatação inventada para a tela.
 */
export function interpretValue(raw: string | null, type: SpedFieldSpec['type']): string | null {
  if (raw === null) return null;
  switch (type) {
    case 'VALOR': {
      const cents = parseDecimalToCentsOrZero(raw);
      return `${(cents / 100).toFixed(2).replace('.', ',')} (${cents} centavos)`;
    }
    case 'DATA': {
      const iso = spedDateToIso(raw);
      return iso === null ? 'data não reconhecida' : iso;
    }
    case 'QUANTIDADE': {
      const value = Number(raw.replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(value) ? String(value) : 'quantidade não reconhecida';
    }
    case 'ALIQUOTA': {
      const value = Number(raw.replace(',', '.'));
      return Number.isFinite(value) ? String(value) : 'alíquota não reconhecida';
    }
    default:
      return raw;
  }
}

function interpretRecord(
  parts: readonly string[],
  line: number,
  code: string,
  fields: readonly SpedFieldSpec[],
): InspectedRecord {
  const record = { code, parts, line };
  const interpreted = fields.map((spec) => {
    const raw = field(record, spec.position);
    return {
      position: spec.position,
      name: spec.name,
      label: spec.label,
      type: spec.type,
      raw,
      interpreted: interpretValue(raw, spec.type),
    };
  });

  // `parts` tem uma entrada vazia antes do primeiro `|` e outra depois do
  // último, portanto o número de posições úteis é length - 2.
  const usefulPositions = Math.max(0, parts.length - 2);
  const known = fields.length > 0 ? Math.max(...fields.map((spec) => spec.position)) : 0;

  return {
    line,
    code,
    rawLine: parts.join('|'),
    fields: interpreted,
    extraPositions: Math.max(0, usefulPositions - known + 1),
  };
}

/** Devolve uma página de registros de um código específico. */
export function readSpedPage(
  content: string,
  obligation: SpedObligation,
  options: { code: string; page?: number; pageSize?: number },
): SpedPage {
  const catalogue: SpedCatalogue = catalogueFor(obligation);
  const spec = catalogue.get(options.code);
  const fields = spec?.fields ?? [];
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));

  const from = (page - 1) * pageSize;
  const to = from + pageSize;

  const records: InspectedRecord[] = [];
  let total = 0;

  for (const record of readSpedRecords(content)) {
    if (record.code !== options.code) continue;
    const index = total;
    total += 1;
    if (index < from || index >= to) continue;
    records.push(
      interpretRecord(
        record.parts,
        record.line,
        record.code,
        // Registros fora do catálogo são mostrados posição a posição, para que
        // o conteúdo continue conferível mesmo sem mapeamento.
        fields.length > 0 ? fields : genericFields(record.parts.length),
      ),
    );
  }

  return {
    code: options.code,
    description: spec?.description ?? null,
    supported: spec !== undefined,
    page,
    pageSize,
    total,
    records,
    fields: fields.length > 0 ? fields : genericFields(0),
  };
}

function genericFields(partsLength: number): SpedFieldSpec[] {
  const count = Math.max(1, partsLength - 2);
  return Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    name: `POS_${String(index + 1).padStart(2, '0')}`,
    label: 'Posição não mapeada por este parser',
    type: 'TEXTO' as const,
  }));
}

/** Localiza um registro por número de linha. */
export function readSpedLine(
  content: string,
  obligation: SpedObligation,
  lineNumber: number,
): InspectedRecord | null {
  const catalogue = catalogueFor(obligation);
  for (const record of readSpedRecords(content)) {
    if (record.line !== lineNumber) continue;
    const spec = catalogue.get(record.code);
    return interpretRecord(
      record.parts,
      record.line,
      record.code,
      spec?.fields ?? genericFields(record.parts.length),
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Diagnóstico do C100 (requisito 4)
// ---------------------------------------------------------------------------

export interface C100Totals {
  readonly vlDoc: Cents;
  readonly vlMerc: Cents;
  readonly vlBcIcms: Cents;
  readonly vlIcms: Cents;
  readonly vlBcIcmsSt: Cents;
  readonly vlIcmsSt: Cents;
  readonly vlIpi: Cents;
  readonly vlPis: Cents;
  readonly vlCofins: Cents;
}

const EMPTY_C100_TOTALS: C100Totals = Object.freeze({
  vlDoc: ZERO,
  vlMerc: ZERO,
  vlBcIcms: ZERO,
  vlIcms: ZERO,
  vlBcIcmsSt: ZERO,
  vlIcmsSt: ZERO,
  vlIpi: ZERO,
  vlPis: ZERO,
  vlCofins: ZERO,
});

export interface C100Group {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly totals: C100Totals;
}

export interface C100Diagnostic {
  readonly total: number;
  readonly withAccessKey: number;
  readonly withoutAccessKey: number;
  readonly cancelled: number;
  readonly regular: number;
  readonly entradas: number;
  readonly saidas: number;
  readonly undefinedDirection: number;
  readonly totals: C100Totals;
  /** Somatórios separados por IND_OPER. */
  readonly byOperation: readonly C100Group[];
  /** Somatórios separados por COD_SIT. */
  readonly bySituation: readonly C100Group[];
}

const IND_OPER_LABELS: Readonly<Record<string, string>> = {
  '0': 'Entrada / aquisição',
  '1': 'Saída / prestação',
};

/** Rótulos do campo COD_SIT, conforme o Guia Prático da EFD ICMS/IPI. */
export const COD_SIT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  '00': 'Documento regular',
  '01': 'Escrituração extemporânea de documento regular',
  '02': 'Documento cancelado',
  '03': 'Escrituração extemporânea de documento cancelado',
  '04': 'NF-e ou CT-e denegado',
  '05': 'NF-e ou CT-e com numeração inutilizada',
  '06': 'Documento fiscal complementar',
  '07': 'Escrituração extemporânea de documento complementar',
  '08': 'Documento fiscal emitido com base em regime especial ou norma específica',
};

/** Situações sem efeito de faturamento — nunca somadas automaticamente. */
export const INEFFECTIVE_COD_SIT = new Set(['02', '03', '04', '05']);

function addTotals(acc: C100Totals, parts: readonly string[]): C100Totals {
  const record = { code: 'C100', parts, line: 0 };
  const money = (position: number): Cents => parseDecimalToCentsOrZero(field(record, position));
  return {
    vlDoc: addCents(acc.vlDoc, money(12)),
    vlMerc: addCents(acc.vlMerc, money(16)),
    vlBcIcms: addCents(acc.vlBcIcms, money(21)),
    vlIcms: addCents(acc.vlIcms, money(22)),
    vlBcIcmsSt: addCents(acc.vlBcIcmsSt, money(23)),
    vlIcmsSt: addCents(acc.vlIcmsSt, money(24)),
    vlIpi: addCents(acc.vlIpi, money(25)),
    vlPis: addCents(acc.vlPis, money(26)),
    vlCofins: addCents(acc.vlCofins, money(27)),
  };
}

/**
 * Diagnóstico dos registros C100.
 *
 * Os somatórios são separados por IND_OPER e por COD_SIT e apresentados como
 * estão no arquivo. Documentos cancelados aparecem no seu próprio grupo e
 * **não** são somados ao total de operações com efeito: a composição do
 * faturamento é uma decisão posterior, feita na política de receita.
 */
export function diagnoseC100(content: string, obligation: SpedObligation): C100Diagnostic {
  let total = 0;
  let withAccessKey = 0;
  let cancelled = 0;
  let entradas = 0;
  let saidas = 0;
  let undefinedDirection = 0;
  let totals = EMPTY_C100_TOTALS;

  const byOperation = new Map<string, { count: number; totals: C100Totals }>();
  const bySituation = new Map<string, { count: number; totals: C100Totals }>();

  for (const record of readSpedRecords(content)) {
    if (record.code !== 'C100') continue;
    total += 1;

    const indOper = field(record, 2) ?? '';
    const codSit = field(record, 6) ?? '';
    const chave = field(record, 9);

    if (chave && chave.replace(/\D/g, '').length === 44) withAccessKey += 1;
    if (INEFFECTIVE_COD_SIT.has(codSit)) cancelled += 1;
    if (indOper === '0') entradas += 1;
    else if (indOper === '1') saidas += 1;
    else undefinedDirection += 1;

    totals = addTotals(totals, record.parts);

    const operKey = indOper === '' ? '—' : indOper;
    const operEntry = byOperation.get(operKey) ?? { count: 0, totals: EMPTY_C100_TOTALS };
    byOperation.set(operKey, {
      count: operEntry.count + 1,
      totals: addTotals(operEntry.totals, record.parts),
    });

    const sitKey = codSit === '' ? '—' : codSit;
    const sitEntry = bySituation.get(sitKey) ?? { count: 0, totals: EMPTY_C100_TOTALS };
    bySituation.set(sitKey, {
      count: sitEntry.count + 1,
      totals: addTotals(sitEntry.totals, record.parts),
    });
  }

  void obligation;

  return {
    total,
    withAccessKey,
    withoutAccessKey: total - withAccessKey,
    cancelled,
    regular: total - cancelled,
    entradas,
    saidas,
    undefinedDirection,
    totals,
    byOperation: [...byOperation.entries()]
      .map(([key, value]) => ({
        key,
        label: IND_OPER_LABELS[key] ?? 'IND_OPER não informado',
        count: value.count,
        totals: value.totals,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    bySituation: [...bySituation.entries()]
      .map(([key, value]) => ({
        key,
        label: COD_SIT_DESCRIPTIONS[key] ?? 'COD_SIT não catalogado',
        count: value.count,
        totals: value.totals,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export function decodeSpedBytes(bytes: Uint8Array): string {
  return decodeSped(bytes);
}
