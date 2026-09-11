/**
 * NF-e (model 55) and NFC-e (model 65) XML parser.
 *
 * Reads the layout described by the Manual de Orientacao do Contribuinte
 * (versions 3.10 and 4.00 share the element names used here). Values are kept
 * as text until they reach `parseDecimalToCents`, so no precision is lost.
 *
 * The parser is deliberately tolerant: an unknown ICMS group or a missing
 * optional element produces a `null` field, never an exception.
 */

import { XMLParser } from 'fast-xml-parser';
import { addCents, parseDecimalToCents, parseDecimalToCentsOrZero, sumCents, type Cents } from '@/lib/core/money';
import { onlyDigits } from '@/lib/core/cnpj';
import { nfeDateToIso } from '@/lib/core/dates';
import { competenciaFromDate } from '@/lib/core/competencia';
import { isValidNfeKey, normalizeNfeKey, splitNfeKey, ufFromCode } from '@/lib/core/nfe-key';
import { deterministicId } from '@/lib/core/hash';
import { failWith, ok, type Result } from '@/lib/core/result';
import {
  EMPTY_IDENTITY,
  recordOrigin,
  type DocumentStatus,
  type Invoice,
  type InvoiceItem,
  type InvoiceTotals,
  type OperationDirection,
} from '@/lib/domain/model';
import type { FileMessage } from '@/lib/domain/entities';
import type { DataSourceKind } from '@/lib/domain/sources';
import { asArray, attr, findText, firstChild, node, text, type XmlNode } from './node';
import { EMPTY_PARSE_LOG, type DetectionHint, type DetectionInput, type FileParser, type ParsedPayload, type ParserInput } from '../types';
import { XML_PARSER_VERSION } from '../versions';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep every value as text: `1.0000` must not become the number 1.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true,
  ignoreDeclaration: true,
  processEntities: true,
});

export interface NfeParseResult {
  readonly invoice: Invoice;
  readonly messages: readonly FileMessage[];
}

const AUTHORIZED_STATUS = new Set(['100', '150']);
const CANCELLED_STATUS = new Set(['101', '135', '151', '155']);
const DENIED_STATUS = new Set(['110', '301', '302', '303']);

/** Parses a single NF-e/NFC-e XML document. */
export function parseNfeXml(
  xml: string,
  context: { fileId: string | null; fileName: string; entryName?: string | null },
): Result<NfeParseResult> {
  let tree: unknown;
  try {
    tree = parser.parse(xml);
  } catch (error) {
    return failWith('XML_MALFORMADO', 'XML não pode ser interpretado.', String(error));
  }

  const root = tree as XmlNode;
  const infNFe =
    node(root, 'nfeProc', 'NFe', 'infNFe') ??
    node(root, 'NFe', 'infNFe') ??
    node(root, 'infNFe') ??
    node(root, 'nfeProc', 'infNFe');

  if (!infNFe) {
    return failWith('XML_NAO_E_NFE', 'O arquivo não contem um documento NF-e/NFC-e (infNFe ausente).');
  }

  const messages: FileMessage[] = [];
  const ide = node(infNFe, 'ide');
  const emit = node(infNFe, 'emit');
  const dest = node(infNFe, 'dest');
  const icmsTot = node(infNFe, 'total', 'ICMSTot');

  const rawKey = attr(infNFe, 'Id') ?? findText(root, 'chNFe', 4);
  const accessKey = normalizeNfeKey(rawKey?.replace(/^NFe/i, '') ?? null);
  if (rawKey && !accessKey) {
    messages.push({
      level: 'ALERTA',
      code: 'CHAVE_FORMATO',
      message: `Chave de acesso com formato inesperado em ${context.fileName}.`,
    });
  } else if (accessKey && !isValidNfeKey(accessKey)) {
    messages.push({
      level: 'ALERTA',
      code: 'CHAVE_DV_INVALIDO',
      message: `Dígito verificador da chave de acesso inválido em ${context.fileName}.`,
      detail: accessKey,
    });
  }

  const keyParts = accessKey ? splitNfeKey(accessKey) : null;
  const modelo = text(ide, 'mod') ?? keyParts?.modelo ?? null;
  const serie = text(ide, 'serie') ?? (keyParts ? String(Number(keyParts.serie)) : null);
  const numero = text(ide, 'nNF') ?? (keyParts ? String(Number(keyParts.numero)) : null);
  const issueDate = nfeDateToIso(text(ide, 'dhEmi') ?? text(ide, 'dEmi'));

  const emitterTaxId = onlyDigits(text(emit, 'CNPJ') ?? text(emit, 'CPF') ?? '') || null;
  const recipientTaxId = onlyDigits(text(dest, 'CNPJ') ?? text(dest, 'CPF') ?? '') || null;
  const emitterUf = text(emit, 'enderEmit', 'UF') ?? ufFromCode(text(ide, 'cUF'));
  const recipientUf = text(dest, 'enderDest', 'UF') ?? null;

  const items = readItems(infNFe);
  const totals = readTotals(icmsTot, items);
  const cfops = collectCfops(items);
  const status = readStatus(root);
  const direction = readDirection(text(ide, 'tpNF'));

  const documentKind = modelo === '65' ? 'NFCE' : 'NFE';
  const source: DataSourceKind = modelo === '65' ? 'XML_NFCE' : 'XML_NFE';

  const identityBase = accessKey ?? `${emitterTaxId ?? 'sem-cnpj'}-${modelo ?? '00'}-${serie ?? '0'}-${numero ?? '0'}`;

  const invoice: Invoice = {
    id: deterministicId(`invoice:${source}:${identityBase}`),
    source,
    documentKind,
    accessKey,
    model: modelo,
    serie,
    number: numero,
    issueDate,
    direction,
    status,
    totalValue: totals.total,
    emitterTaxId,
    emitterName: text(emit, 'xNome'),
    emitterUf,
    recipientTaxId,
    recipientName: text(dest, 'xNome'),
    recipientUf,
    naturezaOperacao: text(ide, 'natOp'),
    cfopPrincipal: cfops.principal,
    cfops: cfops.all,
    totals,
    items,
    origin: recordOrigin({
      fileId: context.fileId,
      fileName: context.fileName,
      // O XML não é orientado a linha: o elemento lido identifica a origem.
      recordCode: 'infNFe',
      entryName: context.entryName ?? null,
    }),
  };

  return ok({ invoice, messages });
}

function readDirection(tpNF: string | null): OperationDirection {
  if (tpNF === '1') return 'SAIDA';
  if (tpNF === '0') return 'ENTRADA';
  return 'INDEFINIDA';
}

function readStatus(root: unknown): DocumentStatus {
  const eventStatus = findText(node(root, 'nfeProc', 'procEventoNFe') ?? null, 'tpEvento', 6);
  if (eventStatus === '110111') return 'CANCELADA';

  const cStat =
    text(root, 'nfeProc', 'protNFe', 'infProt', 'cStat') ??
    findText(root, 'cStat', 6);
  if (!cStat) return 'INDEFINIDA';
  if (CANCELLED_STATUS.has(cStat)) return 'CANCELADA';
  if (DENIED_STATUS.has(cStat)) return 'DENEGADA';
  if (AUTHORIZED_STATUS.has(cStat)) return 'AUTORIZADA';
  return 'INDEFINIDA';
}

function readItems(infNFe: XmlNode): InvoiceItem[] {
  const dets = asArray(infNFe['det']);
  return dets.map((det, index) => readItem(det, index));
}

function readItem(det: XmlNode, index: number): InvoiceItem {
  const prod = node(det, 'prod');
  const imposto = node(det, 'imposto');
  const icmsGroup = firstChild(node(imposto, 'ICMS'), (tag) => tag.startsWith('ICMS'));
  const ipiGroup = firstChild(node(imposto, 'IPI'), (tag) => tag.startsWith('IPI'));
  const pisGroup = firstChild(node(imposto, 'PIS'), (tag) => tag.startsWith('PIS'));
  const cofinsGroup = firstChild(node(imposto, 'COFINS'), (tag) => tag.startsWith('COFINS'));
  const icmsUfDest = node(imposto, 'ICMSUFDest');

  const quantidadeRaw = text(prod, 'qCom');
  const quantidade = quantidadeRaw === null ? null : Number(quantidadeRaw.replace(',', '.'));

  const fcp = addCents(
    parseDecimalToCentsOrZero(text(icmsGroup, 'vFCP')),
    parseDecimalToCentsOrZero(text(icmsGroup, 'vFCPST')),
    parseDecimalToCentsOrZero(text(icmsUfDest, 'vFCPUFDest')),
  );

  return {
    numero: attr(det, 'nItem') ?? String(index + 1),
    codigo: text(prod, 'cProd'),
    descricao: text(prod, 'xProd'),
    ncm: text(prod, 'NCM'),
    cest: text(prod, 'CEST'),
    cfop: text(prod, 'CFOP'),
    cst: text(icmsGroup, 'CST'),
    csosn: text(icmsGroup, 'CSOSN'),
    cstPis: text(pisGroup, 'CST'),
    cstCofins: text(cofinsGroup, 'CST'),
    unidade: text(prod, 'uCom'),
    quantidade: quantidade !== null && Number.isFinite(quantidade) ? quantidade : null,
    valorUnitario: parseDecimalToCentsOrZero(text(prod, 'vUnCom')),
    valorProduto: parseDecimalToCentsOrZero(text(prod, 'vProd')),
    desconto: parseDecimalToCentsOrZero(text(prod, 'vDesc')),
    frete: parseDecimalToCentsOrZero(text(prod, 'vFrete')),
    seguro: parseDecimalToCentsOrZero(text(prod, 'vSeg')),
    outrasDespesas: parseDecimalToCentsOrZero(text(prod, 'vOutro')),
    baseIcms: parseDecimalToCentsOrZero(text(icmsGroup, 'vBC')),
    aliquotaIcms: parseRate(text(icmsGroup, 'pICMS')),
    icms: parseDecimalToCentsOrZero(text(icmsGroup, 'vICMS')),
    baseIcmsSt: parseDecimalToCentsOrZero(text(icmsGroup, 'vBCST')),
    icmsSt: parseDecimalToCentsOrZero(text(icmsGroup, 'vICMSST')),
    fcp,
    ipi: parseDecimalToCentsOrZero(text(ipiGroup, 'vIPI')),
    basePis: parseDecimalToCentsOrZero(text(pisGroup, 'vBC')),
    pis: parseDecimalToCentsOrZero(text(pisGroup, 'vPIS')),
    baseCofins: parseDecimalToCentsOrZero(text(cofinsGroup, 'vBC')),
    cofins: parseDecimalToCentsOrZero(text(cofinsGroup, 'vCOFINS')),
  };
}

function parseRate(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads the `ICMSTot` block. When a total is absent the item sum is used as a
 * fallback, and that fact stays visible through the item-level data.
 */
function readTotals(icmsTot: XmlNode | null, items: readonly InvoiceItem[]): InvoiceTotals {
  const fromItems = (pick: (item: InvoiceItem) => Cents): Cents => sumCents(items.map(pick));

  const pick = (tag: string, fallback: () => Cents): Cents => {
    const parsed = parseDecimalToCents(text(icmsTot, tag));
    return parsed ?? fallback();
  };

  return {
    produtos: pick('vProd', () => fromItems((i) => i.valorProduto)),
    frete: pick('vFrete', () => fromItems((i) => i.frete)),
    seguro: pick('vSeg', () => fromItems((i) => i.seguro)),
    desconto: pick('vDesc', () => fromItems((i) => i.desconto)),
    outrasDespesas: pick('vOutro', () => fromItems((i) => i.outrasDespesas)),
    total: pick('vNF', () => fromItems((i) => i.valorProduto)),
    baseIcms: pick('vBC', () => fromItems((i) => i.baseIcms)),
    icms: pick('vICMS', () => fromItems((i) => i.icms)),
    baseIcmsSt: pick('vBCST', () => fromItems((i) => i.baseIcmsSt)),
    icmsSt: pick('vST', () => fromItems((i) => i.icmsSt)),
    fcp: pick('vFCP', () => fromItems((i) => i.fcp)),
    ipi: pick('vIPI', () => fromItems((i) => i.ipi)),
    // ICMSTot carries no PIS/COFINS base; the item sum is the only source.
    basePis: fromItems((i) => i.basePis),
    pis: pick('vPIS', () => fromItems((i) => i.pis)),
    baseCofins: fromItems((i) => i.baseCofins),
    cofins: pick('vCOFINS', () => fromItems((i) => i.cofins)),
  };
}

function collectCfops(items: readonly InvoiceItem[]): { principal: string | null; all: string[] } {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.cfop) continue;
    counts.set(item.cfop, (counts.get(item.cfop) ?? 0) + 1);
  }
  if (counts.size === 0) return { principal: null, all: [] };
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    principal: sorted[0]?.[0] ?? null,
    all: [...counts.keys()].sort(),
  };
}

const DECODER_UTF8 = new TextDecoder('utf-8');

/** Decodes XML bytes honouring the declared encoding (ISO-8859-1 is common). */
export function decodeXml(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const match = /encoding=["']([\w-]+)["']/i.exec(head);
  const encoding = match?.[1]?.toLowerCase() ?? 'utf-8';
  if (encoding === 'utf-8' || encoding === 'utf8') return DECODER_UTF8.decode(bytes);
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

function detectNfe(input: DetectionInput): DetectionHint | null {
  if (input.extension !== '.xml') return null;
  const head = input.head;
  if (!/<\s*(nfeProc|NFe)[\s>]/i.test(head) && !/<infNFe/i.test(head)) return null;
  const isNfce = /<mod>\s*65\s*<\/mod>/i.test(head) || /"NFe\d{20}65/.test(head);
  return {
    source: isNfce ? 'XML_NFCE' : 'XML_NFE',
    confidence: 0.95,
    reason: isNfce ? 'Elemento infNFe com modelo 65.' : 'Elemento infNFe encontrado no XML.',
  };
}

async function parseNfeFile(input: ParserInput): Promise<Result<ParsedPayload>> {
  const xml = decodeXml(input.bytes);
  const result = parseNfeXml(xml, { fileId: input.fileId, fileName: input.fileName });
  if (!result.ok) return result;

  const { invoice, messages } = result.value;
  const identity = {
    ...EMPTY_IDENTITY,
    taxId: invoice.emitterTaxId,
    legalName: invoice.emitterName,
    competencia: competenciaFromDate(invoice.issueDate),
    startDate: invoice.issueDate,
    endDate: invoice.issueDate,
    uf: invoice.emitterUf,
  };

  return ok({
    source: invoice.source,
    parserVersion: XML_PARSER_VERSION,
    log: { ...EMPTY_PARSE_LOG, warnings: messages.filter((m) => m.level === 'ALERTA') },
    identity,
    invoices: [invoice],
    revenues: [],
    taxes: [],
    declarations: [],
    participants: [],
    messages,
    stats: { found: 1, processed: 1, duplicated: 0, invalid: 0, ignored: 0 },
  });
}

export const nfeParser: FileParser = {
  source: 'XML_NFE',
  detect: detectNfe,
  parse: parseNfeFile,
};

