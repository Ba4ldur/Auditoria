/**
 * EFD-Contribuicoes parser.
 *
 * Produces:
 *  - `Invoice` records for C100 (goods) and A100 (services), so they can be
 *    cross-checked against XML documents and against the EFD ICMS/IPI;
 *  - `RevenueRecord` for the F100 operations that the file itself declares as
 *    revenue, which are not represented by any fiscal document;
 *  - `TaxRecord` for the PIS and COFINS consolidations (M200/M600).
 */

import { addCents, sumCents, ZERO, type Cents } from '@/lib/core/money';
import { competenciaFromDate } from '@/lib/core/competencia';
import { deterministicId } from '@/lib/core/hash';
import { onlyDigits } from '@/lib/core/cnpj';
import { ok, type Result } from '@/lib/core/result';
import {
  EMPTY_IDENTITY,
  recordOrigin,
  type DocumentStatus,
  type FiscalDocumentKind,
  type Invoice,
  type InvoiceItem,
  type OperationDirection,
  type ParticipantRecord,
  type RevenueRecord,
  type TaxRecord,
} from '@/lib/domain/model';
import type { FileMessage } from '@/lib/domain/entities';
import { runLayout } from '../layout';
import { decodeSped, looksLikeSped } from '../reader';
import {
  COD_INC_TRIB_LABELS,
  EFD_CONTRIB_LAYOUT,
  createContribState,
  type ContribDocument,
  type ContribState,
} from './layout';
import {
  type DetectionHint,
  type DetectionInput,
  type FileParser,
  type ParsedPayload,
  type ParserInput,
} from '../../types';
import { EFD_CONTRIB_PARSER_VERSION } from '../../versions';

const VERIFIED_VERSIONS = new Set(['005', '006']);

/**
 * Field IND_OPER of register F100. Only operations flagged as revenue are added
 * to the period revenue; acquisitions are kept out of the faturamento figure.
 */
const F100_REVENUE_IND_OPER = '2';

const MODEL_TO_KIND: Readonly<Record<string, FiscalDocumentKind>> = {
  '55': 'NFE',
  '65': 'NFCE',
};

const CANCELLED_COD_SIT = new Set(['02', '03']);
const DENIED_COD_SIT = new Set(['04']);
const VOID_COD_SIT = new Set(['05']);

function detectEfdContrib(input: DetectionInput): DetectionHint | null {
  if (input.extension !== '.txt') return null;
  if (!looksLikeSped(input.head)) return null;
  const hasMarker = /\n\|0110\|/.test(input.head) || /\n\|0140\|/.test(input.head);
  if (!hasMarker) return null;
  return {
    source: 'EFD_CONTRIBUICOES',
    confidence: 0.9,
    reason: 'Arquivo SPED com registro 0110 (regimes de apuração das contribuições).',
  };
}

function directionOf(indOper: string | null): OperationDirection {
  if (indOper === '0') return 'ENTRADA';
  if (indOper === '1') return 'SAIDA';
  return 'INDEFINIDA';
}

function statusOf(codSit: string | null): DocumentStatus {
  if (!codSit) return 'INDEFINIDA';
  if (CANCELLED_COD_SIT.has(codSit)) return 'CANCELADA';
  if (DENIED_COD_SIT.has(codSit)) return 'DENEGADA';
  if (VOID_COD_SIT.has(codSit)) return 'INUTILIZADA';
  return 'AUTORIZADA';
}

function toInvoice(
  document: ContribDocument,
  state: ContribState,
  context: { fileId: string; fileName: string },
): Invoice {
  const companyTaxId = state.cnpj;
  const participant = document.codPart ? state.participants.get(document.codPart) : undefined;
  const participantTaxId = participant ? (participant.cnpj ?? participant.cpf ?? null) : null;
  const ownIssue = document.indEmit === '0';

  const items: InvoiceItem[] = document.items.map((item) => ({
    numero: item.numItem ?? '',
    codigo: item.codItem,
    descricao: item.descrCompl ?? (item.codItem ? (state.items.get(item.codItem)?.descr ?? null) : null),
    ncm: item.codItem ? (state.items.get(item.codItem)?.codNcm ?? null) : null,
    cest: item.codItem ? (state.items.get(item.codItem)?.cest ?? null) : null,
    cfop: item.cfop,
    cst: null,
    csosn: null,
    cstPis: item.cstPis,
    cstCofins: item.cstCofins,
    unidade: item.unid,
    quantidade: item.qtd,
    valorUnitario: ZERO,
    valorProduto: item.vlItem,
    desconto: item.vlDesc,
    frete: ZERO,
    seguro: ZERO,
    outrasDespesas: ZERO,
    baseIcms: ZERO,
    aliquotaIcms: null,
    icms: ZERO,
    baseIcmsSt: ZERO,
    icmsSt: ZERO,
    fcp: ZERO,
    ipi: ZERO,
    basePis: item.vlBcPis,
    pis: item.vlPis,
    baseCofins: item.vlBcCofins,
    cofins: item.vlCofins,
  }));

  const analyticPis = sumCents(document.analytics.map((a) => a.vlPis));
  const analyticCofins = sumCents(document.analytics.map((a) => a.vlCofins));
  const itemPis = sumCents(document.items.map((i) => i.vlPis));
  const itemCofins = sumCents(document.items.map((i) => i.vlCofins));

  const pis = document.vlPis !== ZERO ? document.vlPis : addCents(analyticPis, itemPis);
  const cofins = document.vlCofins !== ZERO ? document.vlCofins : addCents(analyticCofins, itemCofins);

  const basePis = document.vlBcPis !== ZERO
    ? document.vlBcPis
    : addCents(sumCents(document.analytics.map((a) => a.vlBcPis)), sumCents(document.items.map((i) => i.vlBcPis)));
  const baseCofins = document.vlBcCofins !== ZERO
    ? document.vlBcCofins
    : addCents(sumCents(document.analytics.map((a) => a.vlBcCofins)), sumCents(document.items.map((i) => i.vlBcCofins)));

  const cfops = collectCfops(document);
  const identityBase =
    document.chave ??
    `${companyTaxId ?? 'sem-cnpj'}-${document.register}-${document.codMod ?? '00'}-${document.serie ?? '0'}-${document.numDoc ?? '0'}-${document.line}`;

  return {
    id: deterministicId(`invoice:EFD_CONTRIBUICOES:${identityBase}`),
    source: 'EFD_CONTRIBUICOES',
    documentKind: document.register === 'A100' ? 'NFSE' : (MODEL_TO_KIND[document.codMod ?? ''] ?? 'OUTRO'),
    accessKey: document.chave && document.chave.length === 44 ? document.chave : null,
    model: document.codMod,
    serie: document.serie,
    number: document.numDoc,
    issueDate: document.dtDoc,
    direction: directionOf(document.indOper),
    status: statusOf(document.codSit),
    totalValue: document.vlDoc,
    emitterTaxId: ownIssue ? companyTaxId : participantTaxId,
    emitterName: ownIssue ? state.legalName : (participant?.nome ?? null),
    emitterUf: ownIssue ? state.uf : null,
    recipientTaxId: ownIssue ? participantTaxId : companyTaxId,
    recipientName: ownIssue ? (participant?.nome ?? null) : state.legalName,
    recipientUf: ownIssue ? null : state.uf,
    naturezaOperacao: document.register === 'A100' ? 'Documento de serviço (registro A100)' : null,
    cfopPrincipal: cfops.principal,
    cfops: cfops.all,
    totals: {
      produtos: document.vlMerc,
      frete: ZERO,
      seguro: ZERO,
      desconto: document.vlDesc,
      outrasDespesas: ZERO,
      total: document.vlDoc,
      baseIcms: ZERO,
      icms: ZERO,
      baseIcmsSt: ZERO,
      icmsSt: ZERO,
      fcp: ZERO,
      ipi: ZERO,
      basePis,
      pis,
      baseCofins,
      cofins,
    },
    items,
    origin: recordOrigin({
      fileId: context.fileId,
      fileName: context.fileName,
      recordCode: document.register,
      lineNumber: document.line,
    }),
  };
}

function collectCfops(document: ContribDocument): { principal: string | null; all: string[] } {
  const totals = new Map<string, Cents>();
  for (const analytic of document.analytics) {
    if (!analytic.cfop) continue;
    totals.set(analytic.cfop, addCents(totals.get(analytic.cfop) ?? ZERO, analytic.vlOpr));
  }
  if (totals.size === 0) {
    for (const item of document.items) {
      if (!item.cfop) continue;
      totals.set(item.cfop, addCents(totals.get(item.cfop) ?? ZERO, item.vlItem));
    }
  }
  if (totals.size === 0) return { principal: null, all: [] };
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { principal: sorted[0]?.[0] ?? null, all: [...totals.keys()].sort() };
}

async function parseEfdContribFile(input: ParserInput): Promise<Result<ParsedPayload>> {
  const content = decodeSped(input.bytes);
  const state = createContribState();
  const summary = runLayout(content, EFD_CONTRIB_LAYOUT, state);

  const messages: FileMessage[] = [];
  if (state.version && !VERIFIED_VERSIONS.has(state.version)) {
    messages.push({
      level: 'ALERTA',
      code: 'SPED_VERSAO_NAO_VERIFICADA',
      message:
        `Layout COD_VER=${state.version} não consta na lista de versões verificadas deste parser. ` +
        'Confira as posições dos campos antes de considerar os cruzamentos conclusivos.',
    });
  }

  if (state.codIncTrib) {
    messages.push({
      level: 'INFO',
      code: 'REGIME_APURACAO',
      message:
        `Registro 0110, COD_INC_TRIB=${state.codIncTrib}: ` +
        (COD_INC_TRIB_LABELS[state.codIncTrib] ?? 'código não catalogado por este parser.'),
    });
  }

  const context = { fileId: input.fileId, fileName: input.fileName };
  const invoices = state.documents.map((document) => toInvoice(document, state, context));
  const competencia = competenciaFromDate(state.startDate) ?? competenciaFromDate(state.endDate);

  const revenues: RevenueRecord[] = [];
  const revenueOperations = state.otherOperations.filter((op) => op.indOper === F100_REVENUE_IND_OPER);
  if (competencia && revenueOperations.length > 0) {
    revenues.push({
      id: deterministicId(`revenue:EFD_CONTRIBUICOES:F100:${input.fileId}`),
      source: 'EFD_CONTRIBUICOES',
      competencia,
      basis: 'ESCRITURACAO',
      amount: sumCents(revenueOperations.map((op) => op.vlOper)),
      description:
        `Somatório do campo VL_OPER de ${revenueOperations.length} registro(s) F100 com ` +
        `IND_OPER=${F100_REVENUE_IND_OPER} (operação representativa de receita).`,
      documentCount: revenueOperations.length,
      origin: recordOrigin({
        fileId: input.fileId,
        fileName: input.fileName,
        recordCode: 'F100',
        lineNumber: revenueOperations[0]?.line ?? null,
      }),
    });
  }

  const taxes: TaxRecord[] = [];
  const consolidations = [
    { tax: 'PIS' as const, register: 'M200', data: state.pis },
    { tax: 'COFINS' as const, register: 'M600', data: state.cofins },
  ];
  for (const { tax, register, data } of consolidations) {
    if (!competencia || !data) continue;
    // Contribution owed for the period, before credits and deductions.
    taxes.push({
      id: deterministicId(`tax:EFD_CONTRIBUICOES:${tax}:DEVIDO:${input.fileId}`),
      source: 'EFD_CONTRIBUICOES',
      competencia,
      tax,
      metric: 'DEVIDO_PERIODO',
      base: null,
      amount: addCents(data.totalNonCumulativePeriod, data.totalCumulativePeriod),
      description:
        `Registro ${register}: VL_TOT_CONT_NC_PER + VL_TOT_CONT_CUM_PER ` +
        '(contribuição apurada no período, antes de créditos, retenções e demais deduções).',
      origin: recordOrigin({
        fileId: input.fileId,
        fileName: input.fileName,
        recordCode: register,
        lineNumber: data.line,
      }),
    });
    // Amount left to collect after credits, withholdings and deductions.
    taxes.push({
      id: deterministicId(`tax:EFD_CONTRIBUICOES:${tax}:RECOLHER:${input.fileId}`),
      source: 'EFD_CONTRIBUICOES',
      competencia,
      tax,
      metric: 'A_RECOLHER',
      base: null,
      amount: data.totalToCollect,
      description: `Registro ${register}, campo VL_TOT_CONT_REC (total da contribuição a recolher no período).`,
      origin: recordOrigin({
        fileId: input.fileId,
        fileName: input.fileName,
        recordCode: register,
        lineNumber: data.line,
      }),
    });
  }

  const participants: ParticipantRecord[] = [...state.participants.values()].map((participant) => ({
    id: deterministicId(`participant:EFD_CONTRIBUICOES:${input.fileId}:${participant.codPart}`),
    source: 'EFD_CONTRIBUICOES',
    code: participant.codPart,
    name: participant.nome,
    taxId: participant.cnpj ?? participant.cpf,
    uf: null,
    stateRegistration: participant.ie,
    countryCode: null,
    origin: recordOrigin({
      fileId: input.fileId,
      fileName: input.fileName,
      recordCode: '0150',
      lineNumber: participant.line,
    }),
  }));

  messages.push({
    level: 'INFO',
    code: 'SPED_RESUMO',
    message:
      `${summary.totalRecords} registros lidos; ${state.documents.length} documentos (C100/A100); ` +
      `${state.otherOperations.length} operações F100; ${summary.unhandled.size} tipos de registro não mapeados.`,
  });

  const unsupportedRecords = [...summary.unhandled.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  const unsupportedLayout =
    state.version && !VERIFIED_VERSIONS.has(state.version)
      ? { declaredVersion: state.version, verifiedVersions: [...VERIFIED_VERSIONS].sort() }
      : null;

  return ok({
    source: 'EFD_CONTRIBUICOES',
    parserVersion: EFD_CONTRIB_PARSER_VERSION,
    log: {
      warnings: messages.filter((message) => message.level === 'ALERTA'),
      errors: messages.filter((message) => message.level === 'ERRO'),
      unsupportedRecords,
      unsupportedLayout,
    },
    identity: {
      ...EMPTY_IDENTITY,
      taxId: onlyDigits(state.cnpj ?? '') || null,
      legalName: state.legalName,
      competencia,
      startDate: state.startDate,
      endDate: state.endDate,
      uf: state.uf,
    },
    invoices,
    revenues,
    taxes,
    declarations: [],
    participants,
    messages,
    stats: {
      found: state.documents.length,
      processed: invoices.length,
      duplicated: 0,
      invalid: 0,
      ignored: 0,
    },
  });
}

export const efdContribuicoesParser: FileParser = {
  source: 'EFD_CONTRIBUICOES',
  detect: detectEfdContrib,
  parse: parseEfdContribFile,
};
