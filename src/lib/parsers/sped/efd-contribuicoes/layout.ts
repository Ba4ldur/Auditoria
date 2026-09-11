/**
 * EFD-Contribuicoes register layout.
 *
 * Independent from the EFD ICMS/IPI layout: register 0000 has a different field
 * order in the two obligations, so sharing the mapping would silently read the
 * wrong columns. Positions follow the Guia Pratico da EFD-Contribuicoes and are
 * annotated with the official field names.
 */

import { field, type SpedRecord } from '../reader';
import { defineLayout, type RegisterHandler } from '../layout';
import { parseDecimalToCentsOrZero, ZERO, type Cents } from '@/lib/core/money';
import { onlyDigits } from '@/lib/core/cnpj';
import { spedDateToIso } from '@/lib/core/dates';

/** Field COD_INC_TRIB of register 0110 — the taxation regime of the period. */
export const COD_INC_TRIB_LABELS: Readonly<Record<string, string>> = {
  '1': 'Escrituração de operações com incidência exclusivamente no regime não-cumulativo',
  '2': 'Escrituração de operações com incidência exclusivamente no regime cumulativo',
  '3': 'Escrituração de operações com incidência nos regimes não-cumulativo e cumulativo',
};

export interface ContribDocument {
  readonly register: 'C100' | 'A100';
  readonly indOper: string | null;
  readonly indEmit: string | null;
  readonly codPart: string | null;
  readonly codMod: string | null;
  readonly codSit: string | null;
  readonly serie: string | null;
  readonly numDoc: string | null;
  readonly chave: string | null;
  readonly dtDoc: string | null;
  readonly vlDoc: Cents;
  readonly vlDesc: Cents;
  readonly vlMerc: Cents;
  readonly vlBcPis: Cents;
  readonly vlPis: Cents;
  readonly vlBcCofins: Cents;
  readonly vlCofins: Cents;
  readonly line: number;
  items: ContribItem[];
  analytics: ContribAnalytic[];
}

export interface ContribItem {
  readonly numItem: string | null;
  readonly codItem: string | null;
  readonly descrCompl: string | null;
  readonly qtd: number | null;
  readonly unid: string | null;
  readonly vlItem: Cents;
  readonly vlDesc: Cents;
  readonly cfop: string | null;
  readonly cstPis: string | null;
  readonly vlBcPis: Cents;
  readonly vlPis: Cents;
  readonly cstCofins: string | null;
  readonly vlBcCofins: Cents;
  readonly vlCofins: Cents;
}

/** Register C175 — analytic consolidation of the document for PIS/COFINS. */
export interface ContribAnalytic {
  readonly cfop: string | null;
  readonly vlOpr: Cents;
  readonly vlDesc: Cents;
  readonly cstPis: string | null;
  readonly vlBcPis: Cents;
  readonly vlPis: Cents;
  readonly cstCofins: string | null;
  readonly vlBcCofins: Cents;
  readonly vlCofins: Cents;
}

/** Register F100 — other documents and operations. */
export interface ContribOtherOperation {
  readonly indOper: string | null;
  readonly codPart: string | null;
  readonly codItem: string | null;
  readonly dtOper: string | null;
  readonly vlOper: Cents;
  readonly cstPis: string | null;
  readonly vlBcPis: Cents;
  readonly vlPis: Cents;
  readonly cstCofins: string | null;
  readonly vlBcCofins: Cents;
  readonly vlCofins: Cents;
  readonly descricao: string | null;
}

/** Registers M200/M600 — consolidation of the contribution for the period. */
export interface ContribConsolidation {
  readonly totalNonCumulativePeriod: Cents;
  readonly totalCreditsDiscounted: Cents;
  readonly totalNonCumulativeDue: Cents;
  readonly withholdingsNonCumulative: Cents;
  readonly otherDeductionsNonCumulative: Cents;
  readonly nonCumulativeToCollect: Cents;
  readonly totalCumulativePeriod: Cents;
  readonly withholdingsCumulative: Cents;
  readonly otherDeductionsCumulative: Cents;
  readonly cumulativeToCollect: Cents;
  readonly totalToCollect: Cents;
}

export interface ContribParticipant {
  readonly codPart: string;
  readonly nome: string | null;
  readonly cnpj: string | null;
  readonly cpf: string | null;
  readonly ie: string | null;
}

export interface ContribItemRegister {
  readonly codItem: string;
  readonly descr: string | null;
  readonly codNcm: string | null;
  readonly cest: string | null;
}

export interface ContribState {
  version: string | null;
  escrituracaoType: string | null;
  startDate: string | null;
  endDate: string | null;
  legalName: string | null;
  cnpj: string | null;
  uf: string | null;
  codIncTrib: string | null;
  indRegCum: string | null;
  establishments: { codEst: string | null; nome: string | null; cnpj: string | null; uf: string | null }[];
  participants: Map<string, ContribParticipant>;
  items: Map<string, ContribItemRegister>;
  documents: ContribDocument[];
  otherOperations: ContribOtherOperation[];
  pis: ContribConsolidation | null;
  cofins: ContribConsolidation | null;
  currentDocument: ContribDocument | null;
}

export function createContribState(): ContribState {
  return {
    version: null,
    escrituracaoType: null,
    startDate: null,
    endDate: null,
    legalName: null,
    cnpj: null,
    uf: null,
    codIncTrib: null,
    indRegCum: null,
    establishments: [],
    participants: new Map(),
    items: new Map(),
    documents: [],
    otherOperations: [],
    pis: null,
    cofins: null,
    currentDocument: null,
  };
}

function money(record: SpedRecord, position: number): Cents {
  return parseDecimalToCentsOrZero(field(record, position));
}

function quantity(record: SpedRecord, position: number): number | null {
  const raw = field(record, position);
  if (raw === null) return null;
  const value = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** M200 and M600 share the same field order, differing only in the tax. */
function readConsolidation(record: SpedRecord): ContribConsolidation {
  return {
    totalNonCumulativePeriod: money(record, 2), // VL_TOT_CONT_NC_PER
    totalCreditsDiscounted: money(record, 3), // VL_TOT_CRED_DESC
    totalNonCumulativeDue: money(record, 5), // VL_TOT_CONT_NC_DEV
    withholdingsNonCumulative: money(record, 6), // VL_RET_NC
    otherDeductionsNonCumulative: money(record, 7), // VL_OUT_DED_NC
    nonCumulativeToCollect: money(record, 8), // VL_CONT_NC_REC
    totalCumulativePeriod: money(record, 9), // VL_TOT_CONT_CUM_PER
    withholdingsCumulative: money(record, 10), // VL_RET_CUM
    otherDeductionsCumulative: money(record, 11), // VL_OUT_DED_CUM
    cumulativeToCollect: money(record, 12), // VL_CONT_CUM_REC
    totalToCollect: money(record, 13), // VL_TOT_CONT_REC
  };
}

const handlers: RegisterHandler<ContribState>[] = [
  {
    code: '0000',
    description: 'Abertura do arquivo digital e identificação da pessoa jurídica',
    handle(record, state) {
      state.version = field(record, 2); // COD_VER
      state.escrituracaoType = field(record, 3); // TIPO_ESCRIT
      state.startDate = spedDateToIso(field(record, 6)); // DT_INI
      state.endDate = spedDateToIso(field(record, 7)); // DT_FIN
      state.legalName = field(record, 8); // NOME
      state.cnpj = onlyDigits(field(record, 9)) || null; // CNPJ
      state.uf = field(record, 10); // UF
    },
  },
  {
    code: '0110',
    description: 'Regimes de apuração da contribuição social e de apropriacao de crédito',
    handle(record, state) {
      state.codIncTrib = field(record, 2); // COD_INC_TRIB
      state.indRegCum = field(record, 5); // IND_REG_CUM
    },
  },
  {
    code: '0140',
    description: 'Tabela de cadastro de estabelecimento',
    handle(record, state) {
      state.establishments.push({
        codEst: field(record, 2), // COD_EST
        nome: field(record, 3), // NOME
        cnpj: onlyDigits(field(record, 4)) || null, // CNPJ
        uf: field(record, 5), // UF
      });
    },
  },
  {
    code: '0150',
    description: 'Tabela de cadastro do participante',
    handle(record, state) {
      const codPart = field(record, 2); // COD_PART
      if (!codPart) return;
      state.participants.set(codPart, {
        codPart,
        nome: field(record, 3), // NOME
        cnpj: onlyDigits(field(record, 5)) || null, // CNPJ
        cpf: onlyDigits(field(record, 6)) || null, // CPF
        ie: field(record, 7), // IE
      });
    },
  },
  {
    code: '0200',
    description: 'Tabela de identificação do item',
    handle(record, state) {
      const codItem = field(record, 2); // COD_ITEM
      if (!codItem) return;
      state.items.set(codItem, {
        codItem,
        descr: field(record, 3), // DESCR_ITEM
        codNcm: field(record, 8), // COD_NCM
        cest: field(record, 13), // CEST
      });
    },
  },
  {
    code: 'A100',
    description: 'Documento - nota fiscal de serviço',
    handle(record, state) {
      const document: ContribDocument = {
        register: 'A100',
        indOper: field(record, 2), // IND_OPER
        indEmit: field(record, 3), // IND_EMIT
        codPart: field(record, 4), // COD_PART
        codMod: null,
        codSit: field(record, 5), // COD_SIT
        serie: field(record, 6), // SER
        numDoc: field(record, 8), // NUM_DOC
        chave: onlyDigits(field(record, 9)) || null, // CHV_NFSE
        dtDoc: spedDateToIso(field(record, 10)), // DT_DOC
        vlDoc: money(record, 12), // VL_DOC
        vlDesc: money(record, 14), // VL_DESC
        vlMerc: money(record, 12), // servicos: o valor do documento e a propria base
        vlBcPis: money(record, 15), // VL_BC_PIS
        vlPis: money(record, 16), // VL_PIS
        vlBcCofins: money(record, 17), // VL_BC_COFINS
        vlCofins: money(record, 18), // VL_COFINS
        line: record.line,
        items: [],
        analytics: [],
      };
      state.documents.push(document);
      state.currentDocument = document;
    },
  },
  {
    code: 'C100',
    description: 'Documento - nota fiscal, NF-e e NFC-e',
    handle(record, state) {
      const document: ContribDocument = {
        register: 'C100',
        indOper: field(record, 2), // IND_OPER
        indEmit: field(record, 3), // IND_EMIT
        codPart: field(record, 4), // COD_PART
        codMod: field(record, 5), // COD_MOD
        codSit: field(record, 6), // COD_SIT
        serie: field(record, 7), // SER
        numDoc: field(record, 8), // NUM_DOC
        chave: onlyDigits(field(record, 9)) || null, // CHV_NFE
        dtDoc: spedDateToIso(field(record, 10)), // DT_DOC
        vlDoc: money(record, 12), // VL_DOC
        vlDesc: money(record, 14), // VL_DESC
        vlMerc: money(record, 16), // VL_MERC
        // O C100 nao carrega base de PIS/COFINS: ela e informada nos registros
        // filhos (C170 ou C175) e consolidada durante a normalizacao.
        vlBcPis: ZERO,
        vlPis: money(record, 26), // VL_PIS
        vlBcCofins: ZERO,
        vlCofins: money(record, 27), // VL_COFINS
        line: record.line,
        items: [],
        analytics: [],
      };
      state.documents.push(document);
      state.currentDocument = document;
    },
  },
  {
    code: 'C170',
    description: 'Complemento do documento - itens',
    handle(record, state) {
      const current = state.currentDocument;
      if (!current) return;
      current.items.push({
        numItem: field(record, 2), // NUM_ITEM
        codItem: field(record, 3), // COD_ITEM
        descrCompl: field(record, 4), // DESCR_COMPL
        qtd: quantity(record, 5), // QTD
        unid: field(record, 6), // UNID
        vlItem: money(record, 7), // VL_ITEM
        vlDesc: money(record, 8), // VL_DESC
        cfop: field(record, 11), // CFOP
        cstPis: field(record, 25), // CST_PIS
        vlBcPis: money(record, 26), // VL_BC_PIS
        vlPis: money(record, 30), // VL_PIS
        cstCofins: field(record, 31), // CST_COFINS
        vlBcCofins: money(record, 32), // VL_BC_COFINS
        vlCofins: money(record, 36), // VL_COFINS
      });
    },
  },
  {
    code: 'C175',
    description: 'Registro analitico do documento',
    handle(record, state) {
      const current = state.currentDocument;
      if (!current) return;
      current.analytics.push({
        cfop: field(record, 2), // CFOP
        vlOpr: money(record, 3), // VL_OPR
        vlDesc: money(record, 4), // VL_DESC
        cstPis: field(record, 5), // CST_PIS
        vlBcPis: money(record, 6), // VL_BC_PIS
        vlPis: money(record, 8), // VL_PIS
        cstCofins: field(record, 9), // CST_COFINS
        vlBcCofins: money(record, 10), // VL_BC_COFINS
        vlCofins: money(record, 12), // VL_COFINS
      });
    },
  },
  {
    code: 'F100',
    description: 'Demais documentos e operações geradoras de contribuição e crédito',
    handle(record, state) {
      state.otherOperations.push({
        indOper: field(record, 2), // IND_OPER
        codPart: field(record, 3), // COD_PART
        codItem: field(record, 4), // COD_ITEM
        dtOper: spedDateToIso(field(record, 5)), // DT_OPER
        vlOper: money(record, 6), // VL_OPER
        cstPis: field(record, 7), // CST_PIS
        vlBcPis: money(record, 8), // VL_BC_PIS
        vlPis: money(record, 10), // VL_PIS
        cstCofins: field(record, 11), // CST_COFINS
        vlBcCofins: money(record, 12), // VL_BC_COFINS
        vlCofins: money(record, 14), // VL_COFINS
        descricao: field(record, 19), // DESC_DOC_OPER
      });
    },
  },
  {
    code: 'M200',
    description: 'Consolidação da contribuição para o PIS/Pasep do período',
    handle(record, state) {
      state.pis = readConsolidation(record);
    },
  },
  {
    code: 'M600',
    description: 'Consolidação da COFINS do período',
    handle(record, state) {
      state.cofins = readConsolidation(record);
    },
  },
];

export const EFD_CONTRIB_LAYOUT = defineLayout(handlers);
