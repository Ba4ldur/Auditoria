/**
 * Generators for fictitious fiscal files.
 *
 * Used by the automated tests and by the demonstration dataset. No real
 * taxpayer data is used anywhere: the CNPJs are built from arbitrary bases with
 * valid check digits, which makes them structurally valid and, by construction,
 * not tied to any actual company (requirement 31).
 */

import { buildCnpjFromBase } from '@/lib/core/cnpj';
import { buildNfeKey } from '@/lib/core/nfe-key';

export const DEMO_COMPANY = {
  legalName: 'COMERCIAL DEMONSTRAÇÃO LTDA',
  tradeName: 'Comercial Demonstração',
  cnpj: buildCnpjFromBase('112223330001'),
  stateRegistration: '110042490114',
  municipalRegistration: '1234567',
  uf: 'SP',
  ufCode: '35',
  municipality: 'São Paulo',
  municipalityCode: '3550308',
} as const;

export const DEMO_SUPPLIER = {
  legalName: 'FORNECEDOR DEMONSTRAÇÃO LTDA',
  cnpj: buildCnpjFromBase('445556660001'),
  uf: 'MG',
} as const;

export const DEMO_CUSTOMER = {
  legalName: 'CLIENTE DEMONSTRAÇÃO LTDA',
  cnpj: buildCnpjFromBase('778889990001'),
  uf: 'RJ',
} as const;

export interface InvoiceItemSpec {
  readonly codigo: string;
  readonly descricao: string;
  readonly ncm: string;
  readonly cfop: string;
  readonly cst?: string;
  readonly csosn?: string;
  readonly unidade: string;
  readonly quantidade: number;
  readonly valorUnitario: number;
  readonly aliquotaIcms: number;
}

export interface NfeSpec {
  readonly numero: number;
  readonly serie: number;
  readonly modelo: '55' | '65';
  readonly emissao: string;
  readonly naturezaOperacao: string;
  readonly tpNF: '0' | '1';
  readonly emitente: { cnpj: string; nome: string; uf: string };
  readonly destinatario: { cnpj: string; nome: string; uf: string };
  readonly items: readonly InvoiceItemSpec[];
  readonly cancelada?: boolean;
  /** Finalidade da NF-e (`ide/finNFe`): 1 normal, 2 complementar, 3 ajuste, 4 devolução. */
  readonly finNFe?: '1' | '2' | '3' | '4';
}

function money(value: number): string {
  return value.toFixed(2);
}

function quantity(value: number): string {
  return value.toFixed(4);
}

export function nfeAccessKey(spec: NfeSpec, ufCode = DEMO_COMPANY.ufCode): string {
  const [year = '2026', month = '01'] = spec.emissao.split('-');
  const base =
    ufCode +
    year.slice(2) +
    month +
    spec.emitente.cnpj +
    spec.modelo +
    String(spec.serie).padStart(3, '0') +
    String(spec.numero).padStart(9, '0') +
    '1' +
    String(spec.numero).padStart(8, '0');
  return buildNfeKey(base);
}

export interface NfeTotals {
  readonly produtos: number;
  readonly baseIcms: number;
  readonly icms: number;
  readonly pis: number;
  readonly cofins: number;
  readonly total: number;
}

const PIS_RATE = 0.0165;
const COFINS_RATE = 0.076;

export function computeNfeTotals(spec: NfeSpec): NfeTotals {
  let produtos = 0;
  let baseIcms = 0;
  let icms = 0;
  let pis = 0;
  let cofins = 0;

  for (const item of spec.items) {
    const value = round(item.quantidade * item.valorUnitario);
    produtos += value;
    baseIcms += value;
    icms += round(value * (item.aliquotaIcms / 100));
    pis += round(value * PIS_RATE);
    cofins += round(value * COFINS_RATE);
  }

  return {
    produtos: round(produtos),
    baseIcms: round(baseIcms),
    icms: round(icms),
    pis: round(pis),
    cofins: round(cofins),
    total: round(produtos),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Builds a `nfeProc` document with the elements the parser reads. */
export function buildNfeXml(spec: NfeSpec): string {
  const key = nfeAccessKey(spec);
  const totals = computeNfeTotals(spec);

  const items = spec.items
    .map((item, index) => {
      const value = round(item.quantidade * item.valorUnitario);
      const icms = round(value * (item.aliquotaIcms / 100));
      const icmsGroup = item.csosn
        ? `<ICMSSN102><orig>0</orig><CSOSN>${item.csosn}</CSOSN></ICMSSN102>`
        : `<ICMS00><orig>0</orig><CST>${item.cst ?? '00'}</CST><modBC>3</modBC>` +
          `<vBC>${money(value)}</vBC><pICMS>${money(item.aliquotaIcms)}</pICMS>` +
          `<vICMS>${money(icms)}</vICMS></ICMS00>`;

      return `    <det nItem="${index + 1}">
      <prod>
        <cProd>${item.codigo}</cProd>
        <xProd>${item.descricao}</xProd>
        <NCM>${item.ncm}</NCM>
        <CFOP>${item.cfop}</CFOP>
        <uCom>${item.unidade}</uCom>
        <qCom>${quantity(item.quantidade)}</qCom>
        <vUnCom>${item.valorUnitario.toFixed(4)}</vUnCom>
        <vProd>${money(value)}</vProd>
        <indTot>1</indTot>
      </prod>
      <imposto>
        <ICMS>${icmsGroup}</ICMS>
        <PIS><PISAliq><CST>01</CST><vBC>${money(value)}</vBC><pPIS>1.65</pPIS><vPIS>${money(round(value * PIS_RATE))}</vPIS></PISAliq></PIS>
        <COFINS><COFINSAliq><CST>01</CST><vBC>${money(value)}</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>${money(round(value * COFINS_RATE))}</vCOFINS></COFINSAliq></COFINS>
      </imposto>
    </det>`;
    })
    .join('\n');

  const protocol = spec.cancelada
    ? `  <protNFe versao="4.00"><infProt><chNFe>${key}</chNFe><cStat>101</cStat><xMotivo>Cancelamento de NF-e homologado</xMotivo></infProt></protNFe>`
    : `  <protNFe versao="4.00"><infProt><chNFe>${key}</chNFe><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe versao="4.00" Id="NFe${key}">
      <ide>
        <cUF>${DEMO_COMPANY.ufCode}</cUF>
        <natOp>${spec.naturezaOperacao}</natOp>
        <mod>${spec.modelo}</mod>
        <serie>${spec.serie}</serie>
        <nNF>${spec.numero}</nNF>
        <dhEmi>${spec.emissao}T09:00:00-03:00</dhEmi>
        <tpNF>${spec.tpNF}</tpNF>
        <finNFe>${spec.finNFe ?? '1'}</finNFe>
        <idDest>${spec.emitente.uf === spec.destinatario.uf ? '1' : '2'}</idDest>
        <tpEmis>1</tpEmis>
      </ide>
      <emit>
        <CNPJ>${spec.emitente.cnpj}</CNPJ>
        <xNome>${spec.emitente.nome}</xNome>
        <enderEmit><UF>${spec.emitente.uf}</UF></enderEmit>
        <IE>${DEMO_COMPANY.stateRegistration}</IE>
      </emit>
      <dest>
        <CNPJ>${spec.destinatario.cnpj}</CNPJ>
        <xNome>${spec.destinatario.nome}</xNome>
        <enderDest><UF>${spec.destinatario.uf}</UF></enderDest>
      </dest>
${items}
      <total>
        <ICMSTot>
          <vBC>${money(totals.baseIcms)}</vBC>
          <vICMS>${money(totals.icms)}</vICMS>
          <vFCP>0.00</vFCP>
          <vBCST>0.00</vBCST>
          <vST>0.00</vST>
          <vProd>${money(totals.produtos)}</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>0.00</vDesc>
          <vII>0.00</vII>
          <vIPI>0.00</vIPI>
          <vPIS>${money(totals.pis)}</vPIS>
          <vCOFINS>${money(totals.cofins)}</vCOFINS>
          <vOutro>0.00</vOutro>
          <vNF>${money(totals.total)}</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
${protocol}
</nfeProc>`;
}

// ---------------------------------------------------------------------------
// SPED
// ---------------------------------------------------------------------------

function spedMoney(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

function spedDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}${month}${year}`;
}

export interface EfdDocumentSpec {
  readonly spec: NfeSpec;
  /** Overrides applied only to the booked record, to create divergences. */
  readonly override?: {
    readonly valorDocumento?: number;
    readonly baseIcms?: number;
    readonly icms?: number;
    readonly cfop?: string;
    readonly codSit?: string;
    /** Escritura o mesmo documento duas vezes, para exercitar a duplicidade. */
    readonly duplicado?: boolean;
    /** Omite o CFOP dos registros C170/C190, deixando o documento sem CFOP. */
    readonly semCfop?: boolean;
  };
}

export interface EfdIcmsSpec {
  readonly startDate: string;
  readonly endDate: string;
  readonly documents: readonly EfdDocumentSpec[];
  readonly icmsARecolher: number;
}

/** Builds an EFD ICMS/IPI file with the registers the parser maps. */
export function buildEfdIcmsTxt(spec: EfdIcmsSpec): string {
  const lines: string[] = [];
  const add = (...fields: (string | number)[]): void => {
    lines.push(`|${fields.join('|')}|`);
  };

  add(
    '0000', '017', '0', spedDate(spec.startDate), spedDate(spec.endDate),
    DEMO_COMPANY.legalName, DEMO_COMPANY.cnpj, '', DEMO_COMPANY.uf,
    DEMO_COMPANY.stateRegistration, DEMO_COMPANY.municipalityCode, '', '', 'A', '0',
  );
  add('0001', '0');
  add('0005', DEMO_COMPANY.tradeName, '01310100', 'AV PAULISTA', '1000', '', 'BELA VISTA', '', '', '');
  add('0100', 'CONTADOR DEMONSTRACAO', '11144477735', '1SP123456', '', '', '', '', '', '', '', '', '', DEMO_COMPANY.municipalityCode);
  add('0150', 'P001', DEMO_CUSTOMER.legalName, '1058', DEMO_CUSTOMER.cnpj, '', 'ISENTO', '3304557', '', 'RUA DEMO', '10', '', 'CENTRO');
  add('0150', 'P002', DEMO_SUPPLIER.legalName, '1058', DEMO_SUPPLIER.cnpj, '', 'ISENTO', '3106200', '', 'RUA DEMO', '20', '', 'CENTRO');
  add('0190', 'UN', 'UNIDADE');
  add('0190', 'CX', 'CAIXA');
  add('0200', 'PROD001', 'PRODUTO DEMONSTRACAO A', '', '', 'UN', '00', '84713012', '', '', '', '', '');
  add('0200', 'PROD002', 'PRODUTO DEMONSTRACAO B', '', '', 'CX', '00', '39269090', '', '', '', '', '');
  add('0990', String(lines.length + 1));

  const blockCStart = lines.length;
  add('C001', '0');

  for (const entry of spec.documents) {
    const { spec: nfe, override } = entry;
    const totals = computeNfeTotals(nfe);
    const key = nfeAccessKey(nfe);
    const outgoing = nfe.emitente.cnpj === DEMO_COMPANY.cnpj;

    const valorDocumento = override?.valorDocumento ?? totals.total;
    const baseIcms = override?.baseIcms ?? totals.baseIcms;
    const icms = override?.icms ?? totals.icms;

    const documentStart = lines.length;

    add(
      'C100',
      outgoing ? '1' : '0', // IND_OPER
      outgoing ? '0' : '1', // IND_EMIT
      outgoing ? 'P001' : 'P002', // COD_PART
      nfe.modelo, // COD_MOD
      override?.codSit ?? (nfe.cancelada ? '02' : '00'), // COD_SIT
      String(nfe.serie), // SER
      String(nfe.numero), // NUM_DOC
      key, // CHV_NFE
      spedDate(nfe.emissao), // DT_DOC
      spedDate(nfe.emissao), // DT_E_S
      spedMoney(valorDocumento), // VL_DOC
      '0', // IND_PGTO
      '0,00', // VL_DESC
      '', // VL_ABAT_NT
      spedMoney(totals.produtos), // VL_MERC
      '9', // IND_FRT
      '0,00', '0,00', '0,00', // VL_FRT, VL_SEG, VL_OUT_DA
      spedMoney(baseIcms), // VL_BC_ICMS
      spedMoney(icms), // VL_ICMS
      '0,00', '0,00', '0,00', // ST e IPI
      spedMoney(totals.pis), // VL_PIS
      spedMoney(totals.cofins), // VL_COFINS
      '0,00', '0,00',
    );

    for (const [index, item] of nfe.items.entries()) {
      const value = round(item.quantidade * item.valorUnitario);
      const itemIcms = round(value * (item.aliquotaIcms / 100));
      add(
        'C170',
        String(index + 1), // NUM_ITEM
        item.codigo, // COD_ITEM
        item.descricao, // DESCR_COMPL
        quantity(item.quantidade).replace('.', ','), // QTD
        item.unidade, // UNID
        spedMoney(value), // VL_ITEM
        '0,00', // VL_DESC
        '0', // IND_MOV
        item.cst ?? '00', // CST_ICMS
        override?.semCfop ? '' : (override?.cfop ?? item.cfop), // CFOP
        '', // COD_NAT
        spedMoney(value), // VL_BC_ICMS
        spedMoney(item.aliquotaIcms), // ALIQ_ICMS
        spedMoney(itemIcms), // VL_ICMS
        '0,00', '0,00', '0,00', // ST
        '0', // IND_APUR
        '', '', '0,00', '0,00', '0,00', // IPI
        '01', spedMoney(value), '1,65', '', '', spedMoney(round(value * PIS_RATE)), // PIS
        '01', spedMoney(value), '7,60', '', '', spedMoney(round(value * COFINS_RATE)), // COFINS
        '', '',
      );
    }

    add(
      'C190',
      nfe.items[0]?.cst ?? '00', // CST_ICMS
      override?.semCfop ? '' : (override?.cfop ?? nfe.items[0]?.cfop ?? '5102'), // CFOP
      spedMoney(nfe.items[0]?.aliquotaIcms ?? 0), // ALIQ_ICMS
      spedMoney(valorDocumento), // VL_OPR
      spedMoney(baseIcms), // VL_BC_ICMS
      spedMoney(icms), // VL_ICMS
      '0,00', '0,00', '0,00', '0,00', '',
    );

    // Escrituração repetida da mesma chave, quando a fixture pede duplicidade.
    if (override?.duplicado) lines.push(...lines.slice(documentStart));
  }

  add('C990', String(lines.length - blockCStart + 1));

  const blockEStart = lines.length;
  add('E001', '0');
  add('E100', spedDate(spec.startDate), spedDate(spec.endDate));
  add(
    'E110',
    spedMoney(spec.icmsARecolher), '0,00', '0,00', '0,00',
    '0,00', '0,00', '0,00', '0,00', '0,00',
    spedMoney(spec.icmsARecolher), '0,00', spedMoney(spec.icmsARecolher), '0,00', '0,00',
  );
  add('E111', 'SP000001', 'AJUSTE DEMONSTRATIVO', '0,00');
  add('E990', String(lines.length - blockEStart + 1));

  add('9999', String(lines.length + 1));

  return `${lines.join('\r\n')}\r\n`;
}

export interface EfdContribSpec {
  readonly startDate: string;
  readonly endDate: string;
  readonly documents: readonly NfeSpec[];
  readonly pisApurado: number;
  readonly cofinsApurada: number;
  readonly outrasReceitas?: number;
}

/** Builds an EFD-Contribuicoes file with the registers the parser maps. */
export function buildEfdContribTxt(spec: EfdContribSpec): string {
  const lines: string[] = [];
  const add = (...fields: (string | number)[]): void => {
    lines.push(`|${fields.join('|')}|`);
  };

  add(
    '0000', '006', '0', '0', '',
    spedDate(spec.startDate), spedDate(spec.endDate),
    DEMO_COMPANY.legalName, DEMO_COMPANY.cnpj, DEMO_COMPANY.uf,
    DEMO_COMPANY.municipalityCode, '', '00', '0',
  );
  add('0001', '0');
  add('0110', '2', '', '1', '1');
  add('0140', '001', DEMO_COMPANY.legalName, DEMO_COMPANY.cnpj, DEMO_COMPANY.uf, DEMO_COMPANY.stateRegistration, DEMO_COMPANY.municipalityCode, '', '');
  add('0150', 'P001', DEMO_CUSTOMER.legalName, '1058', DEMO_CUSTOMER.cnpj, '', 'ISENTO', '3304557', '', '', '', '', '');
  add('0200', 'PROD001', 'PRODUTO DEMONSTRACAO A', '', '', 'UN', '00', '84713012', '', '', '', '', '');
  add('0990', String(lines.length + 1));

  add('C001', '0');
  for (const nfe of spec.documents) {
    const totals = computeNfeTotals(nfe);
    add(
      'C100', '1', '0', 'P001', nfe.modelo, nfe.cancelada ? '02' : '00',
      String(nfe.serie), String(nfe.numero), nfeAccessKey(nfe),
      spedDate(nfe.emissao), spedDate(nfe.emissao),
      spedMoney(totals.total), '0', '0,00', '',
      spedMoney(totals.produtos), '9', '0,00', '0,00', '0,00',
      '0,00', '0,00', '0,00', '0,00', '0,00',
      spedMoney(totals.pis), spedMoney(totals.cofins), '0,00', '0,00',
    );
    add(
      'C175',
      nfe.items[0]?.cfop ?? '5102',
      spedMoney(totals.total), '0,00',
      '01', spedMoney(totals.total), '1,65', spedMoney(totals.pis),
      '01', spedMoney(totals.total), '7,60', spedMoney(totals.cofins),
      '', '',
    );
  }
  add('C990', String(lines.length));

  if (spec.outrasReceitas && spec.outrasReceitas > 0) {
    add('F001', '0');
    add(
      'F100', '2', '', '', spedDate(spec.endDate), spedMoney(spec.outrasReceitas),
      '01', spedMoney(spec.outrasReceitas), '1,65', spedMoney(round(spec.outrasReceitas * PIS_RATE)),
      '01', spedMoney(spec.outrasReceitas), '7,60', spedMoney(round(spec.outrasReceitas * COFINS_RATE)),
      '', '', '', '', 'RECEITA FINANCEIRA DEMONSTRATIVA',
    );
    add('F990', '3');
  }

  add('M001', '0');
  add(
    'M200', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00',
    spedMoney(spec.pisApurado), '0,00', '0,00', spedMoney(spec.pisApurado), spedMoney(spec.pisApurado),
  );
  add(
    'M600', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00',
    spedMoney(spec.cofinsApurada), '0,00', '0,00', spedMoney(spec.cofinsApurada), spedMoney(spec.cofinsApurada),
  );
  add('M990', '4');
  add('9999', String(lines.length + 1));

  return `${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// PGDAS-D
// ---------------------------------------------------------------------------

export interface PgdasdSpec {
  readonly competenciaLabel: string;
  readonly receitaBruta: number;
  readonly rbt12: number;
  readonly valorDevido: number;
  readonly segregacoes?: readonly { label: string; amount: number }[];
  readonly tributos?: readonly { label: string; amount: number }[];
}

function brMoney(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Text of a PGDAS-D extract, in the wording the parser recognises. */
export function buildPgdasdText(spec: PgdasdSpec): string[] {
  const lines: string[] = [
    'SIMPLES NACIONAL',
    'EXTRATO DO SIMPLES NACIONAL - PGDAS-D',
    '',
    `CNPJ Matriz: ${formatCnpjLabel(DEMO_COMPANY.cnpj)}`,
    `Nome Empresarial: ${DEMO_COMPANY.legalName}`,
    `Periodo de Apuracao (PA): ${spec.competenciaLabel}`,
    '',
    'RECEITAS BRUTAS DECLARADAS',
    `Receita Bruta do PA (RPA) - Competencia    ${brMoney(spec.receitaBruta)}`,
    `RBT12    ${brMoney(spec.rbt12)}`,
    '',
  ];

  if (spec.segregacoes && spec.segregacoes.length > 0) {
    lines.push('ATIVIDADES E SEGREGACOES DE RECEITA');
    for (const item of spec.segregacoes) {
      lines.push(`${item.label}    ${brMoney(item.amount)}`);
    }
    lines.push('');
  }

  if (spec.tributos && spec.tributos.length > 0) {
    lines.push('TRIBUTOS APURADOS');
    for (const item of spec.tributos) {
      lines.push(`${item.label}    ${brMoney(item.amount)}`);
    }
    lines.push('');
  }

  lines.push(`Total do Debito Exigivel    ${brMoney(spec.valorDevido)}`);
  lines.push('');
  lines.push('DOCUMENTO GERADO PARA FINS DE DEMONSTRACAO DO SISTEMA.');

  return lines;
}

function formatCnpjLabel(cnpj: string): string {
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
