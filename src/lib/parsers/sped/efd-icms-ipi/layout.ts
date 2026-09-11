/**
 * EFD ICMS/IPI register layout.
 *
 * Positions follow the Guia Pratico da EFD ICMS/IPI. Each mapping is written as
 * `field(record, N) // NOME_DO_CAMPO` so a layout revision can be verified
 * against the official document without reading the surrounding logic.
 *
 * The parser records the declared layout version (`COD_VER` of register 0000)
 * and surfaces it to the auditor: the system does not silently assume that a
 * future version keeps the same field order.
 */

import { field, type SpedRecord } from '../reader';
import { defineLayout, type RegisterHandler } from '../layout';
import { parseDecimalToCents, parseDecimalToCentsOrZero, ZERO, type Cents } from '@/lib/core/money';
import { onlyDigits } from '@/lib/core/cnpj';
import { spedDateToIso } from '@/lib/core/dates';

/** Document situation codes of field COD_SIT (register C100). */
export const COD_SIT_LABELS: Readonly<Record<string, string>> = {
  '00': 'Documento regular',
  '01': 'Escrituração extemporanea de documento regular',
  '02': 'Documento cancelado',
  '03': 'Escrituração extemporanea de documento cancelado',
  '04': 'NF-e ou CT-e denegado',
  '05': 'NF-e ou CT-e com numeracao inutilizada',
  '06': 'Documento fiscal complementar',
  '07': 'Escrituração extemporanea de documento complementar',
  '08': 'Documento fiscal emitido com base em regime especial ou norma específica',
};

export const CANCELLED_COD_SIT = new Set(['02', '03']);
export const DENIED_COD_SIT = new Set(['04']);
export const VOID_COD_SIT = new Set(['05']);

export interface EfdIcmsDocument {
  readonly indOper: string | null;
  readonly indEmit: string | null;
  readonly codPart: string | null;
  readonly codMod: string | null;
  readonly codSit: string | null;
  readonly serie: string | null;
  readonly numDoc: string | null;
  readonly chvNfe: string | null;
  readonly dtDoc: string | null;
  readonly dtEntSai: string | null;
  readonly vlDoc: Cents;
  readonly vlDesc: Cents;
  readonly vlMerc: Cents;
  readonly vlFrt: Cents;
  readonly vlSeg: Cents;
  readonly vlOutDa: Cents;
  readonly vlBcIcms: Cents;
  readonly vlIcms: Cents;
  readonly vlBcIcmsSt: Cents;
  readonly vlIcmsSt: Cents;
  readonly vlIpi: Cents;
  readonly vlPis: Cents;
  readonly vlCofins: Cents;
  readonly line: number;
  items: EfdIcmsItem[];
  analytics: EfdIcmsAnalytic[];
}

export interface EfdIcmsItem {
  readonly numItem: string | null;
  readonly codItem: string | null;
  readonly descrCompl: string | null;
  readonly qtd: number | null;
  readonly unid: string | null;
  readonly vlItem: Cents;
  readonly vlDesc: Cents;
  readonly cstIcms: string | null;
  readonly cfop: string | null;
  readonly vlBcIcms: Cents;
  readonly aliqIcms: number | null;
  readonly vlIcms: Cents;
  readonly vlBcIcmsSt: Cents;
  readonly vlIcmsSt: Cents;
  readonly cstIpi: string | null;
  readonly vlIpi: Cents;
  readonly cstPis: string | null;
  readonly vlBcPis: Cents;
  readonly vlPis: Cents;
  readonly cstCofins: string | null;
  readonly vlBcCofins: Cents;
  readonly vlCofins: Cents;
}

/** Register C190 — analytic consolidation by CST/CFOP/aliquot. */
export interface EfdIcmsAnalytic {
  readonly cstIcms: string | null;
  readonly cfop: string | null;
  readonly aliqIcms: number | null;
  readonly vlOpr: Cents;
  readonly vlBcIcms: Cents;
  readonly vlIcms: Cents;
  readonly vlBcIcmsSt: Cents;
  readonly vlIcmsSt: Cents;
  readonly vlRedBc: Cents;
  readonly vlIpi: Cents;
}

/** Register C197 — ICMS adjustments tied to a document. */
export interface EfdIcmsAdjustment {
  readonly codAj: string | null;
  readonly descr: string | null;
  readonly codItem: string | null;
  readonly vlBcIcms: Cents;
  readonly aliqIcms: number | null;
  readonly vlIcms: Cents;
  readonly vlOutros: Cents;
  readonly documentKey: string | null;
}

/** Register E110 — ICMS apuration totals. */
export interface EfdIcmsApuration {
  readonly dtIni: string | null;
  readonly dtFin: string | null;
  readonly vlTotDebitos: Cents;
  readonly vlAjDebitos: Cents;
  readonly vlTotAjDebitos: Cents;
  readonly vlEstornosCred: Cents;
  readonly vlTotCreditos: Cents;
  readonly vlAjCreditos: Cents;
  readonly vlTotAjCreditos: Cents;
  readonly vlEstornosDeb: Cents;
  readonly vlSldCredorAnt: Cents;
  readonly vlSldApurado: Cents;
  readonly vlTotDed: Cents;
  readonly vlIcmsRecolher: Cents;
  readonly vlSldCredorTransportar: Cents;
  readonly debEsp: Cents;
}

export interface EfdIcmsApurationAdjustment {
  readonly codAjApur: string | null;
  readonly descr: string | null;
  readonly value: Cents;
}

export interface EfdIcmsParticipant {
  readonly codPart: string;
  readonly nome: string | null;
  readonly codPais: string | null;
  readonly cnpj: string | null;
  readonly cpf: string | null;
  readonly ie: string | null;
  readonly codMun: string | null;
}

export interface EfdIcmsItemRegister {
  readonly codItem: string;
  readonly descr: string | null;
  readonly unidInv: string | null;
  readonly tipoItem: string | null;
  readonly codNcm: string | null;
  readonly cest: string | null;
}

export interface EfdIcmsState {
  version: string | null;
  finality: string | null;
  startDate: string | null;
  endDate: string | null;
  legalName: string | null;
  cnpj: string | null;
  cpf: string | null;
  uf: string | null;
  stateRegistration: string | null;
  municipalityCode: string | null;
  tradeName: string | null;
  accountantName: string | null;
  accountantTaxId: string | null;
  units: Map<string, string>;
  participants: Map<string, EfdIcmsParticipant>;
  items: Map<string, EfdIcmsItemRegister>;
  documents: EfdIcmsDocument[];
  adjustments: EfdIcmsAdjustment[];
  observations: Map<string, string>;
  apurations: EfdIcmsApuration[];
  apurationAdjustments: EfdIcmsApurationAdjustment[];
  /** Cursor used to attach C170/C190/C197 records to the current C100. */
  currentDocument: EfdIcmsDocument | null;
  currentPeriod: { dtIni: string | null; dtFin: string | null } | null;
}

export function createEfdIcmsState(): EfdIcmsState {
  return {
    version: null,
    finality: null,
    startDate: null,
    endDate: null,
    legalName: null,
    cnpj: null,
    cpf: null,
    uf: null,
    stateRegistration: null,
    municipalityCode: null,
    tradeName: null,
    accountantName: null,
    accountantTaxId: null,
    units: new Map(),
    participants: new Map(),
    items: new Map(),
    documents: [],
    adjustments: [],
    observations: new Map(),
    apurations: [],
    apurationAdjustments: [],
    currentDocument: null,
    currentPeriod: null,
  };
}

function rate(record: SpedRecord, position: number): number | null {
  const raw = field(record, position);
  if (raw === null) return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
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

const handlers: RegisterHandler<EfdIcmsState>[] = [
  {
    code: '0000',
    description: 'Abertura do arquivo digital e identificação da entidade',
    handle(record, state) {
      state.version = field(record, 2); // COD_VER
      state.finality = field(record, 3); // COD_FIN
      state.startDate = spedDateToIso(field(record, 4)); // DT_INI
      state.endDate = spedDateToIso(field(record, 5)); // DT_FIN
      state.legalName = field(record, 6); // NOME
      state.cnpj = onlyDigits(field(record, 7)) || null; // CNPJ
      state.cpf = onlyDigits(field(record, 8)) || null; // CPF
      state.uf = field(record, 9); // UF
      state.stateRegistration = field(record, 10); // IE
      state.municipalityCode = field(record, 11); // COD_MUN
    },
  },
  {
    code: '0005',
    description: 'Dados complementares da entidade',
    handle(record, state) {
      state.tradeName = field(record, 2); // FANTASIA
    },
  },
  {
    code: '0100',
    description: 'Dados do contabilista',
    handle(record, state) {
      state.accountantName = field(record, 2); // NOME
      state.accountantTaxId = onlyDigits(field(record, 3)) || null; // CPF
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
        codPais: field(record, 4), // COD_PAIS
        cnpj: onlyDigits(field(record, 5)) || null, // CNPJ
        cpf: onlyDigits(field(record, 6)) || null, // CPF
        ie: field(record, 7), // IE
        codMun: field(record, 8), // COD_MUN
      });
    },
  },
  {
    code: '0190',
    description: 'Identificação das unidades de medida',
    handle(record, state) {
      const unid = field(record, 2); // UNID
      if (unid) state.units.set(unid, field(record, 3) ?? ''); // DESCR
    },
  },
  {
    code: '0200',
    description: 'Tabela de identificação do item (produtos e serviços)',
    handle(record, state) {
      const codItem = field(record, 2); // COD_ITEM
      if (!codItem) return;
      state.items.set(codItem, {
        codItem,
        descr: field(record, 3), // DESCR_ITEM
        unidInv: field(record, 6), // UNID_INV
        tipoItem: field(record, 7), // TIPO_ITEM
        codNcm: field(record, 8), // COD_NCM
        cest: field(record, 13), // CEST
      });
    },
  },
  {
    code: 'C100',
    description: 'Nota fiscal, nota fiscal avulsa, NF-e e NFC-e',
    handle(record, state) {
      const document: EfdIcmsDocument = {
        indOper: field(record, 2), // IND_OPER
        indEmit: field(record, 3), // IND_EMIT
        codPart: field(record, 4), // COD_PART
        codMod: field(record, 5), // COD_MOD
        codSit: field(record, 6), // COD_SIT
        serie: field(record, 7), // SER
        numDoc: field(record, 8), // NUM_DOC
        chvNfe: onlyDigits(field(record, 9)) || null, // CHV_NFE
        dtDoc: spedDateToIso(field(record, 10)), // DT_DOC
        dtEntSai: spedDateToIso(field(record, 11)), // DT_E_S
        vlDoc: money(record, 12), // VL_DOC
        vlDesc: money(record, 14), // VL_DESC
        vlMerc: money(record, 16), // VL_MERC
        vlFrt: money(record, 18), // VL_FRT
        vlSeg: money(record, 19), // VL_SEG
        vlOutDa: money(record, 20), // VL_OUT_DA
        vlBcIcms: money(record, 21), // VL_BC_ICMS
        vlIcms: money(record, 22), // VL_ICMS
        vlBcIcmsSt: money(record, 23), // VL_BC_ICMS_ST
        vlIcmsSt: money(record, 24), // VL_ICMS_ST
        vlIpi: money(record, 25), // VL_IPI
        vlPis: money(record, 26), // VL_PIS
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
    description: 'Itens do documento',
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
        cstIcms: field(record, 10), // CST_ICMS
        cfop: field(record, 11), // CFOP
        vlBcIcms: money(record, 13), // VL_BC_ICMS
        aliqIcms: rate(record, 14), // ALIQ_ICMS
        vlIcms: money(record, 15), // VL_ICMS
        vlBcIcmsSt: money(record, 16), // VL_BC_ICMS_ST
        vlIcmsSt: money(record, 18), // VL_ICMS_ST
        cstIpi: field(record, 20), // CST_IPI
        vlIpi: money(record, 24), // VL_IPI
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
    code: 'C190',
    description: 'Registro analitico do documento',
    handle(record, state) {
      const current = state.currentDocument;
      if (!current) return;
      current.analytics.push({
        cstIcms: field(record, 2), // CST_ICMS
        cfop: field(record, 3), // CFOP
        aliqIcms: rate(record, 4), // ALIQ_ICMS
        vlOpr: money(record, 5), // VL_OPR
        vlBcIcms: money(record, 6), // VL_BC_ICMS
        vlIcms: money(record, 7), // VL_ICMS
        vlBcIcmsSt: money(record, 8), // VL_BC_ICMS_ST
        vlIcmsSt: money(record, 9), // VL_ICMS_ST
        vlRedBc: money(record, 10), // VL_RED_BC
        vlIpi: money(record, 11), // VL_IPI
      });
    },
  },
  {
    code: 'C195',
    description: 'Observações do lançamento fiscal',
    handle(record, state) {
      const codObs = field(record, 2); // COD_OBS
      if (codObs) state.observations.set(codObs, field(record, 3) ?? ''); // TXT_COMPL
    },
  },
  {
    code: 'C197',
    description: 'Outras obrigações tributárias, ajustes e informacoes',
    handle(record, state) {
      state.adjustments.push({
        codAj: field(record, 2), // COD_AJ
        descr: field(record, 3), // DESCR_COMPL_AJ
        codItem: field(record, 4), // COD_ITEM
        vlBcIcms: money(record, 5), // VL_BC_ICMS
        aliqIcms: rate(record, 6), // ALIQ_ICMS
        vlIcms: money(record, 7), // VL_ICMS
        vlOutros: money(record, 8), // VL_OUTROS
        documentKey: state.currentDocument?.chvNfe ?? null,
      });
    },
  },
  {
    code: 'E100',
    description: 'Período da apuração do ICMS',
    handle(record, state) {
      state.currentPeriod = {
        dtIni: spedDateToIso(field(record, 2)), // DT_INI
        dtFin: spedDateToIso(field(record, 3)), // DT_FIN
      };
    },
  },
  {
    code: 'E110',
    description: 'Apuração do ICMS - operações próprias',
    handle(record, state) {
      state.apurations.push({
        dtIni: state.currentPeriod?.dtIni ?? state.startDate,
        dtFin: state.currentPeriod?.dtFin ?? state.endDate,
        vlTotDebitos: money(record, 2), // VL_TOT_DEBITOS
        vlAjDebitos: money(record, 3), // VL_AJ_DEBITOS
        vlTotAjDebitos: money(record, 4), // VL_TOT_AJ_DEBITOS
        vlEstornosCred: money(record, 5), // VL_ESTORNOS_CRED
        vlTotCreditos: money(record, 6), // VL_TOT_CREDITOS
        vlAjCreditos: money(record, 7), // VL_AJ_CREDITOS
        vlTotAjCreditos: money(record, 8), // VL_TOT_AJ_CREDITOS
        vlEstornosDeb: money(record, 9), // VL_ESTORNOS_DEB
        vlSldCredorAnt: money(record, 10), // VL_SLD_CREDOR_ANT
        vlSldApurado: money(record, 11), // VL_SLD_APURADO
        vlTotDed: money(record, 12), // VL_TOT_DED
        vlIcmsRecolher: money(record, 13), // VL_ICMS_RECOLHER
        vlSldCredorTransportar: money(record, 14), // VL_SLD_CREDOR_TRANSPORTAR
        debEsp: money(record, 15), // DEB_ESP
      });
    },
  },
  {
    code: 'E111',
    description: 'Ajuste/benefício/incentivo da apuração do ICMS',
    handle(record, state) {
      state.apurationAdjustments.push({
        codAjApur: field(record, 2), // COD_AJ_APUR
        descr: field(record, 3), // DESCR_COMPL_AJ
        value: parseDecimalToCents(field(record, 4)) ?? ZERO, // VL_AJ_APUR
      });
    },
  },
];

export const EFD_ICMS_LAYOUT = defineLayout(handlers);
