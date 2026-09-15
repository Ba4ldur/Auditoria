/**
 * EFD ICMS/IPI parser.
 *
 * Converts the register stream into the normalised model. Every C100 becomes an
 * `Invoice` with `source = 'EFD_ICMS_IPI'`, which is exactly the same shape the
 * XML parser produces — that symmetry is what lets a rule compare "the document
 * as issued" with "the document as booked" without any format knowledge.
 */

import { addCents, sumCents, ZERO, type Cents } from '@/lib/core/money';
import { competenciaFromDate } from '@/lib/core/competencia';
import { deterministicId } from '@/lib/core/hash';
import { onlyDigits } from '@/lib/core/cnpj';
import { ok, type Result } from '@/lib/core/result';
import {
  EMPTY_IDENTITY,
  recordOrigin,
  type DocumentPurpose,
  type DocumentStatus,
  type FiscalDocumentKind,
  type Invoice,
  type InvoiceItem,
  type OperationDirection,
  type ParticipantRecord,
  type TaxRecord,
} from '@/lib/domain/model';
import type { FileMessage } from '@/lib/domain/entities';
import { runLayout } from '../layout';
import { decodeSped, looksLikeSped } from '../reader';
import {
  CANCELLED_COD_SIT,
  COD_SIT_LABELS,
  COMPLEMENTARY_COD_SIT,
  DENIED_COD_SIT,
  EFD_ICMS_LAYOUT,
  LATE_COD_SIT,
  SPECIAL_REGIME_COD_SIT,
  VOID_COD_SIT,
  createEfdIcmsState,
  type EfdIcmsDocument,
  type EfdIcmsState,
} from './layout';
import {
  type DetectionHint,
  type DetectionInput,
  type FileParser,
  type ParsedPayload,
  type ParserInput,
} from '../../types';
import { EFD_ICMS_IPI_PARSER_VERSION } from '../../versions';

/** Layout versions (`COD_VER`) whose field positions this mapping was written against. */
const VERIFIED_VERSIONS = new Set(['015', '016', '017', '018', '019', '020']);

const MODEL_TO_KIND: Readonly<Record<string, FiscalDocumentKind>> = {
  '55': 'NFE',
  '65': 'NFCE',
  '57': 'CTE',
  '58': 'MDFE',
};

function detectEfdIcms(input: DetectionInput): DetectionHint | null {
  if (input.extension !== '.txt') return null;
  if (!looksLikeSped(input.head)) return null;
  // The EFD ICMS/IPI opening register carries UF and IE in positions 9 and 10,
  // which EFD-Contribuicoes does not; the presence of block C/E registers and
  // the absence of the 0110 register disambiguates the two obligations.
  const hasContributionsMarker = /\n\|0110\|/.test(input.head) || /\n\|0140\|/.test(input.head);
  if (hasContributionsMarker) return null;
  return {
    source: 'EFD_ICMS_IPI',
    confidence: 0.85,
    reason: 'Arquivo SPED iniciado pelo registro 0000 sem registros 0110/0140 (EFD ICMS/IPI).',
  };
}

function directionOf(indOper: string | null): OperationDirection {
  if (indOper === '0') return 'ENTRADA';
  if (indOper === '1') return 'SAIDA';
  return 'INDEFINIDA';
}

/**
 * Finalidade a partir do `COD_SIT` do registro C100 (Guia Prático da EFD
 * ICMS/IPI). Os códigos 06 e 07 identificam documento complementar, que
 * escritura apenas o valor complementado, e o 08 identifica documento emitido
 * sob regime especial. Nenhum dos dois é comparável, campo a campo, com o total
 * de um documento normal.
 */
function purposeOf(codSit: string | null): DocumentPurpose {
  if (!codSit) return 'INDEFINIDA';
  if (COMPLEMENTARY_COD_SIT.has(codSit)) return 'COMPLEMENTAR';
  if (SPECIAL_REGIME_COD_SIT.has(codSit)) return 'REGIME_ESPECIAL';
  return 'NORMAL';
}

function statusOf(codSit: string | null): DocumentStatus {
  if (!codSit) return 'INDEFINIDA';
  if (CANCELLED_COD_SIT.has(codSit)) return 'CANCELADA';
  if (DENIED_COD_SIT.has(codSit)) return 'DENEGADA';
  if (VOID_COD_SIT.has(codSit)) return 'INUTILIZADA';
  return 'AUTORIZADA';
}

function toInvoice(
  document: EfdIcmsDocument,
  state: EfdIcmsState,
  context: { fileId: string; fileName: string },
): Invoice {
  const companyTaxId = state.cnpj ?? state.cpf ?? null;
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
    cst: item.cstIcms,
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
    baseIcms: item.vlBcIcms,
    aliquotaIcms: item.aliqIcms,
    icms: item.vlIcms,
    baseIcmsSt: item.vlBcIcmsSt,
    icmsSt: item.vlIcmsSt,
    fcp: ZERO,
    ipi: item.vlIpi,
    basePis: item.vlBcPis,
    pis: item.vlPis,
    baseCofins: item.vlBcCofins,
    cofins: item.vlCofins,
  }));

  const cfops = collectCfops(document);
  const identityBase =
    document.chvNfe ?? `${companyTaxId ?? 'sem-cnpj'}-${document.codMod ?? '00'}-${document.serie ?? '0'}-${document.numDoc ?? '0'}-${document.line}`;

  return {
    id: deterministicId(`invoice:EFD_ICMS_IPI:${identityBase}`),
    source: 'EFD_ICMS_IPI',
    documentKind: MODEL_TO_KIND[document.codMod ?? ''] ?? 'OUTRO',
    accessKey: document.chvNfe && document.chvNfe.length === 44 ? document.chvNfe : null,
    model: document.codMod,
    serie: document.serie,
    number: document.numDoc,
    issueDate: document.dtDoc,
    direction: directionOf(document.indOper),
    status: statusOf(document.codSit),
    purpose: purposeOf(document.codSit),
    extemporaneous: document.codSit !== null && LATE_COD_SIT.has(document.codSit),
    purposeCode: document.codSit,
    purposeField: document.codSit ? 'COD_SIT' : null,
    totalValue: document.vlDoc,
    emitterTaxId: ownIssue ? companyTaxId : participantTaxId,
    emitterName: ownIssue ? state.legalName : (participant?.nome ?? null),
    emitterUf: ownIssue ? state.uf : null,
    recipientTaxId: ownIssue ? participantTaxId : companyTaxId,
    recipientName: ownIssue ? (participant?.nome ?? null) : state.legalName,
    recipientUf: ownIssue ? null : state.uf,
    naturezaOperacao: document.codSit ? (COD_SIT_LABELS[document.codSit] ?? null) : null,
    cfopPrincipal: cfops.principal,
    cfops: cfops.all,
    totals: {
      produtos: document.vlMerc,
      frete: document.vlFrt,
      seguro: document.vlSeg,
      desconto: document.vlDesc,
      outrasDespesas: document.vlOutDa,
      total: document.vlDoc,
      baseIcms: document.vlBcIcms,
      icms: document.vlIcms,
      baseIcmsSt: document.vlBcIcmsSt,
      icmsSt: document.vlIcmsSt,
      // The C100 layout has no FCP field; FCP is scattered across C101/C176 and
      // is therefore not asserted here instead of being guessed as zero-valued.
      fcp: ZERO,
      ipi: document.vlIpi,
      basePis: sumCents(document.items.map((item) => item.vlBcPis)),
      pis: document.vlPis,
      baseCofins: sumCents(document.items.map((item) => item.vlBcCofins)),
      cofins: document.vlCofins,
    },
    // O leiaute do C100 mapeado por este parser não possui campos de IBS, CBS ou
    // Imposto Seletivo. Declarar `null` mantém a distinção entre "não declarado"
    // e "zero", da qual as regras dependem para não concluir sobre o que não leram.
    reformTaxes: null,
    items,
    origin: recordOrigin({
      fileId: context.fileId,
      fileName: context.fileName,
      recordCode: 'C100',
      lineNumber: document.line,
    }),
  };
}

function collectCfops(document: EfdIcmsDocument): { principal: string | null; all: string[] } {
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

async function parseEfdIcmsFile(input: ParserInput): Promise<Result<ParsedPayload>> {
  const content = decodeSped(input.bytes);
  const state = createEfdIcmsState();
  const summary = runLayout(content, EFD_ICMS_LAYOUT, state);

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

  messages.push({
    level: 'INFO',
    code: 'SPED_RESUMO',
    message:
      `${summary.totalRecords} registros lidos; ${state.documents.length} documentos C100; ` +
      `${state.participants.size} participantes; ${summary.unhandled.size} tipos de registro não mapeados.`,
  });

  const context = { fileId: input.fileId, fileName: input.fileName };
  const invoices = state.documents.map((document) => toInvoice(document, state, context));

  const competencia =
    competenciaFromDate(state.startDate) ?? competenciaFromDate(state.endDate) ?? null;

  const taxes: TaxRecord[] = [];
  for (const [index, apuration] of state.apurations.entries()) {
    const apurationCompetencia = competenciaFromDate(apuration.dtIni) ?? competencia;
    if (!apurationCompetencia) continue;
    taxes.push({
      id: deterministicId(`tax:EFD_ICMS_IPI:ICMS:${input.fileId}:${index}`),
      source: 'EFD_ICMS_IPI',
      competencia: apurationCompetencia,
      tax: 'ICMS',
      metric: 'A_RECOLHER',
      base: null,
      amount: apuration.vlIcmsRecolher,
      description:
        `Registro E110, campo VL_ICMS_RECOLHER do período ${apuration.dtIni ?? '?'} a ${apuration.dtFin ?? '?'}.`,
      origin: recordOrigin({
        fileId: input.fileId,
        fileName: input.fileName,
        recordCode: 'E110',
        lineNumber: apuration.line,
      }),
    });
  }

  const participants: ParticipantRecord[] = [...state.participants.values()].map((participant) => ({
    id: deterministicId(`participant:EFD_ICMS_IPI:${input.fileId}:${participant.codPart}`),
    source: 'EFD_ICMS_IPI',
    code: participant.codPart,
    name: participant.nome,
    taxId: participant.cnpj ?? participant.cpf,
    uf: null,
    stateRegistration: participant.ie,
    countryCode: participant.codPais,
    origin: recordOrigin({
      fileId: input.fileId,
      fileName: input.fileName,
      recordCode: '0150',
      lineNumber: participant.line,
    }),
  }));

  if (summary.unhandled.size > 0) {
    const list = [...summary.unhandled.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([code, count]) => `${code} (${count})`)
      .join(', ');
    messages.push({
      level: 'INFO',
      code: 'SPED_REGISTROS_NAO_MAPEADOS',
      message: 'Registros presentes no arquivo e ainda não mapeados por este parser.',
      detail: list,
    });
  }

  const unsupportedRecords = [...summary.unhandled.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  const unsupportedLayout =
    state.version && !VERIFIED_VERSIONS.has(state.version)
      ? { declaredVersion: state.version, verifiedVersions: [...VERIFIED_VERSIONS].sort() }
      : null;

  return ok({
    source: 'EFD_ICMS_IPI',
    parserVersion: EFD_ICMS_IPI_PARSER_VERSION,
    log: {
      warnings: messages.filter((message) => message.level === 'ALERTA'),
      errors: messages.filter((message) => message.level === 'ERRO'),
      unsupportedRecords,
      unsupportedLayout,
    },
    identity: {
      ...EMPTY_IDENTITY,
      taxId: onlyDigits(state.cnpj ?? state.cpf ?? '') || null,
      legalName: state.legalName,
      competencia,
      startDate: state.startDate,
      endDate: state.endDate,
      stateRegistration: state.stateRegistration,
      uf: state.uf,
    },
    invoices,
    revenues: [],
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

export const efdIcmsIpiParser: FileParser = {
  source: 'EFD_ICMS_IPI',
  detect: detectEfdIcms,
  parse: parseEfdIcmsFile,
};

