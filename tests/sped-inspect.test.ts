import { describe, expect, it } from 'vitest';
import {
  COD_SIT_DESCRIPTIONS,
  diagnoseC100,
  interpretValue,
  readSpedLine,
  readSpedPage,
  summariseSped,
} from '@/lib/parsers/sped/inspect';
import { EFD_CONTRIB_FIELDS, EFD_ICMS_FIELDS, catalogueFor } from '@/lib/parsers/sped/fields';
import { EFD_ICMS_LAYOUT } from '@/lib/parsers/sped/efd-icms-ipi/layout';
import { EFD_CONTRIB_LAYOUT } from '@/lib/parsers/sped/efd-contribuicoes/layout';
import { readSpedRecords } from '@/lib/parsers/sped/reader';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  buildEfdContribTxt,
  buildEfdIcmsTxt,
  computeNfeTotals,
  nfeAccessKey,
  type NfeSpec,
} from '@/lib/demo/fixtures';

function sale(numero: number, valorUnitario = 1000, overrides: Partial<NfeSpec> = {}): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-10',
    naturezaOperacao: 'VENDA',
    tpNF: '1',
    emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
    destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: 'RJ' },
    items: [
      {
        codigo: 'PROD001',
        descricao: 'PRODUTO',
        ncm: '84713012',
        cfop: '5102',
        cst: '00',
        unidade: 'UN',
        quantidade: 1,
        valorUnitario,
        aliquotaIcms: 18,
      },
    ],
    ...overrides,
  };
}

const SPECS = [sale(9001, 1000), sale(9002, 2000), sale(9003, 3000, { cancelada: true })];

const ICMS_FILE = buildEfdIcmsTxt({
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  documents: SPECS.map((spec) => ({ spec })),
  icmsARecolher: 540,
});

describe('catálogo de campos oficiais do SPED', () => {
  it('descreve todo registro que o parser da EFD ICMS/IPI lê', () => {
    for (const code of EFD_ICMS_LAYOUT.keys()) {
      expect(EFD_ICMS_FIELDS.has(code), `registro ${code} sem catálogo de campos`).toBe(true);
    }
  });

  it('descreve todo registro que o parser da EFD-Contribuições lê', () => {
    for (const code of EFD_CONTRIB_LAYOUT.keys()) {
      expect(EFD_CONTRIB_FIELDS.has(code), `registro ${code} sem catálogo de campos`).toBe(true);
    }
  });

  it('usa os nomes oficiais nas posições que o parser realmente lê', () => {
    const c100 = EFD_ICMS_FIELDS.get('C100');
    const byPosition = new Map(c100?.fields.map((field) => [field.position, field.name]));
    // Posições conferidas contra o Guia Prático da EFD ICMS/IPI.
    expect(byPosition.get(2)).toBe('IND_OPER');
    expect(byPosition.get(9)).toBe('CHV_NFE');
    expect(byPosition.get(12)).toBe('VL_DOC');
    expect(byPosition.get(21)).toBe('VL_BC_ICMS');
    expect(byPosition.get(22)).toBe('VL_ICMS');
    expect(byPosition.get(27)).toBe('VL_COFINS');
  });

  it('não tem posição repetida em nenhum registro', () => {
    for (const catalogue of [EFD_ICMS_FIELDS, EFD_CONTRIB_FIELDS]) {
      for (const [code, spec] of catalogue) {
        const positions = spec.fields.map((field) => field.position);
        expect(new Set(positions).size, `posições repetidas em ${code}`).toBe(positions.length);
      }
    }
  });

  it('expõe o catálogo correto para cada obrigação', () => {
    expect(catalogueFor('EFD_ICMS_IPI')).toBe(EFD_ICMS_FIELDS);
    expect(catalogueFor('EFD_CONTRIBUICOES')).toBe(EFD_CONTRIB_FIELDS);
  });
});

describe('resumo estrutural do arquivo', () => {
  it('conta os registros presentes e identifica os não mapeados', () => {
    const summary = summariseSped(ICMS_FILE, 'EFD_ICMS_IPI');

    expect(summary.registers.find((entry) => entry.code === '0000')?.count).toBe(1);
    expect(summary.registers.find((entry) => entry.code === 'C100')?.count).toBe(3);
    expect(summary.registers.find((entry) => entry.code === 'C170')?.count).toBe(3);
    expect(summary.totalRecords).toBeGreaterThan(10);
    expect(summary.totalLines).toBeGreaterThanOrEqual(summary.totalRecords);

    // Os registros de abertura/encerramento de bloco não são lidos pelo parser
    // e precisam aparecer como não suportados, sem serem escondidos.
    const unsupported = summary.registers.filter((entry) => !entry.supported).map((e) => e.code);
    expect(unsupported).toContain('0001');
    expect(unsupported).toContain('9999');
    expect(summary.unsupportedRecords).toBeGreaterThan(0);
  });

  it('descreve os registros suportados com o texto oficial', () => {
    const summary = summariseSped(ICMS_FILE, 'EFD_ICMS_IPI');
    const c100 = summary.registers.find((entry) => entry.code === 'C100');
    expect(c100?.supported).toBe(true);
    expect(c100?.description).toContain('NF-e');
  });
});

describe('paginação e interpretação dos registros', () => {
  it('devolve a página pedida com a linha original e os campos interpretados', () => {
    const page = readSpedPage(ICMS_FILE, 'EFD_ICMS_IPI', { code: 'C100', page: 1, pageSize: 2 });

    expect(page.total).toBe(3);
    expect(page.records).toHaveLength(2);
    expect(page.supported).toBe(true);

    const first = page.records[0]!;
    expect(first.rawLine.startsWith('|C100|')).toBe(true);
    expect(first.line).toBeGreaterThan(0);

    const chave = first.fields.find((field) => field.name === 'CHV_NFE');
    expect(chave?.raw).toBe(nfeAccessKey(SPECS[0]!));

    const valor = first.fields.find((field) => field.name === 'VL_DOC');
    const totals = computeNfeTotals(SPECS[0]!);
    expect(valor?.interpreted).toContain(String(Math.round(totals.total * 100)));

    const data = first.fields.find((field) => field.name === 'DT_DOC');
    expect(data?.interpreted).toBe('2026-08-10');
  });

  it('pagina corretamente', () => {
    const page2 = readSpedPage(ICMS_FILE, 'EFD_ICMS_IPI', { code: 'C100', page: 2, pageSize: 2 });
    expect(page2.records).toHaveLength(1);
    expect(page2.page).toBe(2);
  });

  it('exibe posição a posição um registro fora do catálogo', () => {
    const page = readSpedPage(ICMS_FILE, 'EFD_ICMS_IPI', { code: '0001' });
    expect(page.supported).toBe(false);
    expect(page.records[0]?.fields[0]?.name).toMatch(/^POS_/);
  });

  it('localiza um registro pelo número da linha', () => {
    const records = [...readSpedRecords(ICMS_FILE)];
    const target = records.find((record) => record.code === 'C100')!;
    const found = readSpedLine(ICMS_FILE, 'EFD_ICMS_IPI', target.line);
    expect(found?.code).toBe('C100');
    expect(found?.line).toBe(target.line);
    expect(found?.rawLine).toBe(target.parts.join('|'));
  });

  it('interpreta os tipos declarados no catálogo', () => {
    expect(interpretValue('1.234,56', 'VALOR')).toBe('1234,56 (123456 centavos)');
    expect(interpretValue('31082026', 'DATA')).toBe('2026-08-31');
    expect(interpretValue('99999999', 'DATA')).toBe('data não reconhecida');
    expect(interpretValue('18,00', 'ALIQUOTA')).toBe('18');
    expect(interpretValue(null, 'TEXTO')).toBeNull();
  });
});

describe('diagnóstico dos registros C100', () => {
  it('separa contagens por chave, situação e sentido da operação', () => {
    const diagnostic = diagnoseC100(ICMS_FILE, 'EFD_ICMS_IPI');

    expect(diagnostic.total).toBe(3);
    expect(diagnostic.withAccessKey).toBe(3);
    expect(diagnostic.withoutAccessKey).toBe(0);
    expect(diagnostic.cancelled).toBe(1);
    expect(diagnostic.regular).toBe(2);
    expect(diagnostic.saidas).toBe(3);
    expect(diagnostic.entradas).toBe(0);
  });

  it('não mistura documentos cancelados com os regulares nos somatórios', () => {
    const diagnostic = diagnoseC100(ICMS_FILE, 'EFD_ICMS_IPI');

    const regular = diagnostic.bySituation.find((group) => group.key === '00');
    const cancelado = diagnostic.bySituation.find((group) => group.key === '02');

    expect(regular?.count).toBe(2);
    expect(cancelado?.count).toBe(1);
    expect(cancelado?.label).toBe(COD_SIT_DESCRIPTIONS['02']);
    expect(regular?.totals.vlDoc).toBe(300000);
    expect(cancelado?.totals.vlDoc).toBe(300000);
    // O total geral inclui tudo; a separação é que permite decidir o que somar.
    expect(diagnostic.totals.vlDoc).toBe(600000);
  });

  it('agrupa por IND_OPER com os rótulos oficiais', () => {
    const diagnostic = diagnoseC100(ICMS_FILE, 'EFD_ICMS_IPI');
    const saidas = diagnostic.byOperation.find((group) => group.key === '1');
    expect(saidas?.label).toContain('Saída');
    expect(saidas?.count).toBe(3);
  });
});

describe('inspeção da EFD-Contribuições', () => {
  const file = buildEfdContribTxt({
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    documents: [sale(9101, 1500)],
    pisApurado: 100,
    cofinsApurada: 500,
    outrasReceitas: 2000,
  });

  it('conta os registros da obrigação', () => {
    const summary = summariseSped(file, 'EFD_CONTRIBUICOES');
    expect(summary.registers.find((entry) => entry.code === '0110')?.count).toBe(1);
    expect(summary.registers.find((entry) => entry.code === 'M200')?.count).toBe(1);
    expect(summary.registers.find((entry) => entry.code === 'F100')?.count).toBe(1);
  });

  it('interpreta o M200 com os nomes oficiais dos campos', () => {
    const page = readSpedPage(file, 'EFD_CONTRIBUICOES', { code: 'M200' });
    const total = page.records[0]?.fields.find((field) => field.name === 'VL_TOT_CONT_REC');
    expect(total?.raw).toBe('100,00');
    expect(total?.interpreted).toContain('10000 centavos');
  });
});
