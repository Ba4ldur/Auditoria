/**
 * Matriz da reconciliação XML de NF-e/NFC-e × EFD ICMS/IPI.
 *
 * Um caso por situação que o pareamento precisa distinguir. A matriz existe
 * porque todas as regras fiscais leem esta camada: um erro de classificação
 * aqui não aparece como um teste vermelho isolado — aparece como uma auditoria
 * inteira concluindo a coisa errada de forma consistente.
 */

import { describe, expect, it } from 'vitest';
import { reconcile, scopeOf } from '@/lib/audit-engine/reconciliation';
import { buildDataset } from '@/lib/normalization/dataset';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  DEMO_SUPPLIER,
  buildEfdIcmsTxt,
  buildNfeXml,
  type NfeSpec,
} from '@/lib/demo/fixtures';
import { datasetFrom, demoCompany, textFile, type FixtureFile } from './helpers/dataset';

function item(cfop: string, valorUnitario = 1000) {
  return {
    codigo: 'PROD001',
    descricao: 'PRODUTO DEMONSTRAÇÃO A',
    ncm: '84713012',
    cfop,
    cst: '00',
    unidade: 'UN',
    quantidade: 1,
    valorUnitario,
    aliquotaIcms: 18,
  };
}

function saida(numero: number, overrides: Partial<NfeSpec> = {}): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-14',
    naturezaOperacao: 'VENDA DE MERCADORIA',
    tpNF: '1',
    emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
    destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: 'RJ' },
    items: [item('5102')],
    ...overrides,
  };
}

function entrada(numero: number, overrides: Partial<NfeSpec> = {}): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-14',
    naturezaOperacao: 'COMPRA PARA COMERCIALIZACAO',
    tpNF: '1',
    emitente: { cnpj: DEMO_SUPPLIER.cnpj, nome: DEMO_SUPPLIER.legalName, uf: 'MG' },
    destinatario: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
    items: [item('6102')],
    ...overrides,
  };
}

interface EfdEntry {
  spec: NfeSpec;
  override?: Record<string, unknown>;
}

function efdFile(documents: EfdEntry[]): FixtureFile {
  return textFile(
    'efd-icms.txt',
    buildEfdIcmsTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: documents as never,
      icmsARecolher: 1080,
    }),
    'latin1',
  );
}

const xmlFiles = (specs: readonly NfeSpec[]): FixtureFile[] =>
  specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec)));

describe('pareamento por chave', () => {
  it('uma chave no XML e um C100: um par, nada sobrando', async () => {
    const spec = saida(1001);
    const recon = reconcile(await datasetFrom([...xmlFiles([spec]), efdFile([{ spec }])]));

    expect(recon.pairs).toHaveLength(1);
    expect(recon.xmlOnly).toHaveLength(0);
    expect(recon.efdOnly).toHaveLength(0);
    expect(recon.pairs[0]?.ressalvas).toHaveLength(0);
    expect(recon.totals).toEqual({ xmlConsiderados: 1, efdConsiderados: 1 });
  });

  it('XML sem C100 correspondente', async () => {
    const escriturado = saida(1101);
    const ausente = saida(1102);
    const recon = reconcile(
      await datasetFrom([...xmlFiles([escriturado, ausente]), efdFile([{ spec: escriturado }])]),
    );

    expect(recon.pairs).toHaveLength(1);
    expect(recon.xmlOnly).toHaveLength(1);
    expect(recon.xmlOnly[0]?.number).toBe('1102');
    expect(recon.efdOnly).toHaveLength(0);
  });

  it('C100 sem XML correspondente', async () => {
    const comXml = saida(1201);
    const semXml = saida(1202);
    const recon = reconcile(
      await datasetFrom([...xmlFiles([comXml]), efdFile([{ spec: comXml }, { spec: semXml }])]),
    );

    expect(recon.pairs).toHaveLength(1);
    expect(recon.efdOnly).toHaveLength(1);
    expect(recon.efdOnly[0]?.number).toBe('1202');
    expect(recon.xmlOnly).toHaveLength(0);
  });

  it('dois C100 com a mesma chave: pareia uma vez e registra a duplicidade', async () => {
    const spec = saida(1301);
    const recon = reconcile(
      await datasetFrom([...xmlFiles([spec]), efdFile([{ spec, override: { duplicado: true } }])]),
    );

    expect(recon.pairs).toHaveLength(1);
    expect(recon.efdDuplicates).toHaveLength(1);
    expect(recon.efdDuplicates[0]?.occurrences).toHaveLength(2);

    const linhas = recon.efdDuplicates[0]?.occurrences.map((occurrence) => occurrence.origin.lineNumber) ?? [];
    expect(new Set(linhas).size).toBe(2);
    expect(recon.efdDuplicates[0]?.occurrences.every((occurrence) => occurrence.purposeCode === '00')).toBe(true);
  });

  it('XML repetido entre arquivos não é duplicidade de escrituração', async () => {
    // O mesmo documento entregue solto e dentro de outro arquivo é o caso que a
    // deduplicação existe para resolver; não deve virar ocorrência.
    const spec = saida(1401);
    const recon = reconcile(
      await datasetFrom([
        textFile('nfe-a.xml', buildNfeXml(spec)),
        textFile('nfe-b.xml', buildNfeXml(spec)),
        efdFile([{ spec }]),
      ]),
    );

    expect(recon.pairs).toHaveLength(1);
    expect(recon.efdDuplicates).toHaveLength(0);
  });
});

describe('ressalvas por finalidade', () => {
  it('documento complementar é ressalvado dos dois lados', async () => {
    const spec = saida(2001, { finNFe: '2' });
    const recon = reconcile(
      await datasetFrom([...xmlFiles([spec]), efdFile([{ spec, override: { codSit: '06' } }])]),
    );

    const codes = recon.pairs[0]?.ressalvas.map((item) => item.code) ?? [];
    expect(codes).toEqual(['DOCUMENTO_COMPLEMENTAR', 'DOCUMENTO_COMPLEMENTAR']);
    const campos = recon.pairs[0]?.ressalvas.map((item) => item.campo).sort() ?? [];
    expect(campos).toEqual(['COD_SIT', 'finNFe']);
  });

  it('documento de devolução é ressalvado pelo finNFe', async () => {
    const spec = saida(2101, { finNFe: '4' });
    const recon = reconcile(await datasetFrom([...xmlFiles([spec]), efdFile([{ spec }])]));

    expect(recon.pairs[0]?.ressalvas.map((item) => item.code)).toEqual(['DOCUMENTO_DEVOLUCAO']);
    expect(recon.pairs[0]?.ressalvas[0]?.valor).toBe('4');
  });

  it('documento de ajuste é ressalvado pelo finNFe', async () => {
    const spec = saida(2201, { finNFe: '3' });
    const recon = reconcile(await datasetFrom([...xmlFiles([spec]), efdFile([{ spec }])]));

    expect(recon.pairs[0]?.ressalvas.map((item) => item.code)).toEqual(['DOCUMENTO_AJUSTE']);
  });

  it('regime especial é ressalvado pelo COD_SIT 08', async () => {
    const spec = saida(2301);
    const recon = reconcile(
      await datasetFrom([...xmlFiles([spec]), efdFile([{ spec, override: { codSit: '08' } }])]),
    );

    expect(recon.pairs[0]?.ressalvas.map((item) => item.code)).toEqual(['REGIME_ESPECIAL']);
  });

  it('escrituração extemporânea é ressalva informativa e não bloqueia a conclusão', async () => {
    const spec = saida(2401);
    const recon = reconcile(
      await datasetFrom([...xmlFiles([spec]), efdFile([{ spec, override: { codSit: '01' } }])]),
    );

    const pair = recon.pairs[0];
    expect(pair?.ressalvas.map((item) => item.code)).toEqual(['ESCRITURACAO_EXTEMPORANEA']);
    // Desloca a competência, não o valor: a regra segue podendo afirmar o fato.
    expect(pair?.efd.extemporaneous).toBe(true);
  });
});

describe('escopo', () => {
  it('saída própria: a empresa é a emitente', async () => {
    const spec = saida(3001);
    const recon = reconcile(await datasetFrom([...xmlFiles([spec]), efdFile([{ spec }])]));
    expect(recon.pairs[0]?.scope).toBe('SAIDA_PROPRIA');
  });

  it('entrada de terceiro: a empresa é a destinatária', async () => {
    const spec = entrada(3101);
    const recon = reconcile(await datasetFrom([...xmlFiles([spec]), efdFile([{ spec }])]));
    expect(recon.pairs[0]?.scope).toBe('ENTRADA_TERCEIRO');
  });

  it('indefinido quando nenhum dos CNPJ concilia com a empresa auditada', async () => {
    // Nota entre dois terceiros. O `tpNF` diz "saída" — mas sob a ótica do
    // emitente, não da empresa auditada. Aceitá-lo aqui faria o documento ser
    // conferido pelos critérios de saída própria.
    const alheio = saida(3201, {
      emitente: { cnpj: DEMO_SUPPLIER.cnpj, nome: DEMO_SUPPLIER.legalName, uf: 'MG' },
      destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: 'RJ' },
    });
    const dataset = await datasetFrom([...xmlFiles([alheio])]);
    expect(dataset.invoices[0]?.direction).toBe('SAIDA');
    expect(scopeOf(DEMO_COMPANY.cnpj, dataset.invoices[0] ?? null, null)).toBe('INDEFINIDO');
  });

  it('o IND_OPER da escrituração decide quando o XML não identifica a empresa', async () => {
    const alheio = saida(3301, {
      emitente: { cnpj: DEMO_SUPPLIER.cnpj, nome: DEMO_SUPPLIER.legalName, uf: 'MG' },
      destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: 'RJ' },
    });
    const dataset = await datasetFrom([...xmlFiles([alheio]), efdFile([{ spec: alheio }])]);
    const recon = reconcile(dataset);

    // O C100 do fixture declara IND_OPER de entrada para documento de terceiro.
    expect(recon.pairs[0]?.scope).toBe('ENTRADA_TERCEIRO');
  });
});

describe('documentos sem efeito fiscal e situação', () => {
  it('documento cancelado nos dois lados sai do cruzamento sem gerar par', async () => {
    const spec = saida(4001, { cancelada: true });
    const recon = reconcile(
      await datasetFrom([...xmlFiles([spec]), efdFile([{ spec, override: { codSit: '02' } }])]),
    );

    expect(recon.pairs).toHaveLength(0);
    expect(recon.xmlIneffective).toHaveLength(1);
    expect(recon.efdIneffective).toHaveLength(1);
    expect(recon.statusMismatches).toHaveLength(0);
  });

  it('cancelado no XML e regular na EFD é divergência de situação comparável', async () => {
    const spec = saida(4101, { cancelada: true });
    const recon = reconcile(
      await datasetFrom([...xmlFiles([spec]), efdFile([{ spec, override: { codSit: '00' } }])]),
    );

    expect(recon.statusMismatches).toHaveLength(1);
    expect(recon.statusMismatches[0]?.xml.status).toBe('CANCELADA');
    expect(recon.statusMismatches[0]?.efd.status).toBe('AUTORIZADA');
    expect(recon.statusMismatches[0]?.comparavel).toBe(true);
  });

  it('situação sem correspondência direta entre os leiautes não é comparável', async () => {
    // COD_SIT 05 (numeração inutilizada) não tem equivalente no XML autorizado.
    const spec = saida(4201);
    const recon = reconcile(
      await datasetFrom([...xmlFiles([spec]), efdFile([{ spec, override: { codSit: '05' } }])]),
    );

    expect(recon.statusMismatches).toHaveLength(1);
    expect(recon.statusMismatches[0]?.comparavel).toBe(false);
  });
});

describe('NFC-e e chaves ausentes', () => {
  it('NFC-e sem modelo 65 na EFD fica separada como não suportada', async () => {
    const nfce = saida(5001, {
      modelo: '65',
      destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: 'CONSUMIDOR', uf: 'SP' },
    });
    const nfe = saida(5002);
    const recon = reconcile(await datasetFrom([...xmlFiles([nfce, nfe]), efdFile([{ spec: nfe }])]));

    expect(recon.nfceSemModelo65NaEfd).toHaveLength(1);
    expect(recon.nfceSemModelo65NaEfd[0]?.model).toBe('65');
  });

  it('documento do XML sem chave legível fica fora do cruzamento e é contado', async () => {
    const spec = saida(5101);
    const xml = buildNfeXml(spec).replace(/Id="NFe\d+"/, 'Id=""').replace(/<chNFe>\d+<\/chNFe>/g, '');
    const recon = reconcile(
      await datasetFrom([textFile('nfe-sem-chave.xml', xml), efdFile([{ spec }])]),
    );

    expect(recon.xmlWithoutKey).toHaveLength(1);
    expect(recon.pairs).toHaveLength(0);
    expect(recon.efdOnly).toHaveLength(1);
  });
});

describe('arquivos incompletos', () => {
  it('sem EFD, a reconciliação não inventa pares', async () => {
    const recon = reconcile(await datasetFrom(xmlFiles([saida(6001)])));

    expect(recon.pairs).toHaveLength(0);
    expect(recon.xmlOnly).toHaveLength(1);
    expect(recon.efdOnly).toHaveLength(0);
    expect(recon.totals).toEqual({ xmlConsiderados: 1, efdConsiderados: 0 });
  });

  it('sem XML, a reconciliação não inventa ausências', async () => {
    const recon = reconcile(await datasetFrom([efdFile([{ spec: saida(6101) }])]));

    expect(recon.pairs).toHaveLength(0);
    expect(recon.xmlOnly).toHaveLength(0);
    expect(recon.efdOnly).toHaveLength(1);
  });

  it('dataset sem arquivo algum produz reconciliação vazia, não erro', () => {
    const dataset = buildDataset({ company: demoCompany(), competencia: '2026-08', payloads: [] });
    const recon = reconcile(dataset);

    expect(recon.pairs).toHaveLength(0);
    expect(recon.efdDuplicates).toHaveLength(0);
    expect(recon.statusMismatches).toHaveLength(0);
    expect(recon.totals).toEqual({ xmlConsiderados: 0, efdConsiderados: 0 });
  });
});
