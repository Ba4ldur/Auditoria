import { describe, expect, it } from 'vitest';
import { decodeSped, field, looksLikeSped, readSpedRecords } from '@/lib/parsers/sped/reader';
import { efdIcmsIpiParser } from '@/lib/parsers/sped/efd-icms-ipi';
import { efdContribuicoesParser } from '@/lib/parsers/sped/efd-contribuicoes';
import { detectParser } from '@/lib/parsers';
import { identifyFile } from '@/lib/parsers/identify';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  buildEfdContribTxt,
  buildEfdIcmsTxt,
  computeNfeTotals,
  nfeAccessKey,
  type NfeSpec,
} from '@/lib/demo/fixtures';

function saleSpec(numero: number, overrides: Partial<NfeSpec> = {}): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-12',
    naturezaOperacao: 'VENDA DE MERCADORIA',
    tpNF: '1',
    emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: DEMO_COMPANY.uf },
    destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: DEMO_CUSTOMER.uf },
    items: [
      {
        codigo: 'PROD001',
        descricao: 'PRODUTO DEMONSTRAÇÃO A',
        ncm: '84713012',
        cfop: '5102',
        cst: '00',
        unidade: 'UN',
        quantidade: 4,
        valorUnitario: 250,
        aliquotaIcms: 18,
      },
    ],
    ...overrides,
  };
}

const bytesOf = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'latin1'));

describe('leitor de registros SPED', () => {
  it('separa os campos pelo delimitador, e não por texto livre', () => {
    const records = [...readSpedRecords('|0000|017|0|01082026|31082026|EMPRESA|\r\n|C100|1|0|\r\n')];
    expect(records).toHaveLength(2);
    expect(records[0]?.code).toBe('0000');
    expect(field(records[0]!, 2)).toBe('017');
    expect(field(records[0]!, 6)).toBe('EMPRESA');
    expect(records[1]?.code).toBe('C100');
  });

  it('ignora linhas em branco e preserva a numeracao de linha', () => {
    const records = [...readSpedRecords('|0000|017|\n\n\n|C100|1|\n')];
    expect(records).toHaveLength(2);
    expect(records[1]?.line).toBe(4);
  });

  it('decodifica latin1 e utf-8', () => {
    expect(decodeSped(new Uint8Array(Buffer.from('|0000|CONSTRUÇÃO|', 'latin1')))).toContain('CONSTRUÇÃO');
    expect(decodeSped(new Uint8Array(Buffer.from('|0000|CONSTRUÇÃO|', 'utf8')))).toContain('CONSTRUÇÃO');
  });

  it('reconhece um arquivo SPED pelo registro de abertura', () => {
    expect(looksLikeSped('|0000|017|0|')).toBe(true);
    expect(looksLikeSped('qualquer texto')).toBe(false);
  });
});

describe('parser da EFD ICMS/IPI', () => {
  const specs = [saleSpec(5001), saleSpec(5002)];
  const content = buildEfdIcmsTxt({
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    documents: specs.map((spec) => ({ spec })),
    icmsARecolher: 360,
  });

  it('identifica a entidade e o período pelo registro 0000', async () => {
    const result = await efdIcmsIpiParser.parse({
      bytes: bytesOf(content),
      fileName: 'efd.txt',
      fileId: 'f1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.identity.taxId).toBe(DEMO_COMPANY.cnpj);
    expect(result.value.identity.legalName).toBe(DEMO_COMPANY.legalName);
    expect(result.value.identity.competencia).toBe('2026-08');
    expect(result.value.identity.uf).toBe('SP');
    expect(result.value.identity.stateRegistration).toBe(DEMO_COMPANY.stateRegistration);
  });

  it('converte cada C100 em documento normalizado com os campos do layout', async () => {
    const result = await efdIcmsIpiParser.parse({
      bytes: bytesOf(content),
      fileName: 'efd.txt',
      fileId: 'f1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.invoices).toHaveLength(2);
    const invoice = result.value.invoices.find(
      (candidate) => candidate.accessKey === nfeAccessKey(specs[0]!),
    );
    expect(invoice).toBeDefined();
    const totals = computeNfeTotals(specs[0]!);
    expect(invoice?.model).toBe('55');
    expect(invoice?.number).toBe('5001');
    expect(invoice?.issueDate).toBe('2026-08-12');
    expect(invoice?.direction).toBe('SAIDA');
    expect(invoice?.status).toBe('AUTORIZADA');
    expect(invoice?.totals.total).toBe(Math.round(totals.total * 100));
    expect(invoice?.totals.baseIcms).toBe(Math.round(totals.baseIcms * 100));
    expect(invoice?.totals.icms).toBe(Math.round(totals.icms * 100));
    expect(invoice?.source).toBe('EFD_ICMS_IPI');
  });

  it('relaciona C100 com C170 e C190', async () => {
    const result = await efdIcmsIpiParser.parse({
      bytes: bytesOf(content),
      fileName: 'efd.txt',
      fileId: 'f1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const invoice = result.value.invoices[0]!;
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0]?.codigo).toBe('PROD001');
    expect(invoice.items[0]?.cfop).toBe('5102');
    // O NCM vem da tabela 0200, relacionada pelo COD_ITEM.
    expect(invoice.items[0]?.ncm).toBe('84713012');
    // O CFOP predominante vem do registro analitico C190.
    expect(invoice.cfopPrincipal).toBe('5102');
  });

  it('extrai a apuração do ICMS do registro E110', async () => {
    const result = await efdIcmsIpiParser.parse({
      bytes: bytesOf(content),
      fileName: 'efd.txt',
      fileId: 'f1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const icms = result.value.taxes.find((tax) => tax.tax === 'ICMS');
    expect(icms?.amount).toBe(36000);
    expect(icms?.metric).toBe('A_RECOLHER');
    expect(icms?.competencia).toBe('2026-08');
  });

  it('mapeia os participantes do registro 0150', async () => {
    const result = await efdIcmsIpiParser.parse({
      bytes: bytesOf(content),
      fileName: 'efd.txt',
      fileId: 'f1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.participants.map((p) => p.taxId)).toContain(DEMO_CUSTOMER.cnpj);
  });

  it('marca documento cancelado pelo COD_SIT', async () => {
    const cancelledContent = buildEfdIcmsTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: [{ spec: saleSpec(5003), override: { codSit: '02' } }],
      icmsARecolher: 0,
    });
    const result = await efdIcmsIpiParser.parse({
      bytes: bytesOf(cancelledContent),
      fileName: 'efd.txt',
      fileId: 'f1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invoices[0]?.status).toBe('CANCELADA');
  });
});

describe('parser da EFD-Contribuições', () => {
  const specs = [saleSpec(6001), saleSpec(6002)];
  const content = buildEfdContribTxt({
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    documents: specs,
    pisApurado: 165,
    cofinsApurada: 760,
    outrasReceitas: 1000,
  });

  it('le o registro 0000 no layout próprio da obrigação', async () => {
    const result = await efdContribuicoesParser.parse({
      bytes: bytesOf(content),
      fileName: 'contrib.txt',
      fileId: 'f2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.identity.taxId).toBe(DEMO_COMPANY.cnpj);
    expect(result.value.identity.competencia).toBe('2026-08');
  });

  it('extrai documentos, receitas do F100 e a apuração do M200/M600', async () => {
    const result = await efdContribuicoesParser.parse({
      bytes: bytesOf(content),
      fileName: 'contrib.txt',
      fileId: 'f2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.invoices).toHaveLength(2);
    expect(result.value.invoices[0]?.source).toBe('EFD_CONTRIBUICOES');

    const revenue = result.value.revenues[0];
    expect(revenue?.amount).toBe(100000);
    expect(revenue?.description).toContain('F100');

    const pisDevido = result.value.taxes.find(
      (tax) => tax.tax === 'PIS' && tax.metric === 'DEVIDO_PERIODO',
    );
    const pisRecolher = result.value.taxes.find(
      (tax) => tax.tax === 'PIS' && tax.metric === 'A_RECOLHER',
    );
    expect(pisDevido?.amount).toBe(16500);
    expect(pisRecolher?.amount).toBe(16500);

    const cofins = result.value.taxes.find(
      (tax) => tax.tax === 'COFINS' && tax.metric === 'DEVIDO_PERIODO',
    );
    expect(cofins?.amount).toBe(76000);
  });

  it('registra o regime de apuração informado no 0110', async () => {
    const result = await efdContribuicoesParser.parse({
      bytes: bytesOf(content),
      fileName: 'contrib.txt',
      fileId: 'f2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messages.some((message) => message.code === 'REGIME_APURACAO')).toBe(true);
  });
});

describe('distincao entre as duas EFD', () => {
  const icms = buildEfdIcmsTxt({
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    documents: [{ spec: saleSpec(7001) }],
    icmsARecolher: 180,
  });
  const contrib = buildEfdContribTxt({
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    documents: [saleSpec(7002)],
    pisApurado: 100,
    cofinsApurada: 500,
  });

  it('não confunde EFD ICMS/IPI com EFD-Contribuições', () => {
    expect(detectParser(bytesOf(icms), 'efd.txt')?.hint.source).toBe('EFD_ICMS_IPI');
    expect(detectParser(bytesOf(contrib), 'contrib.txt')?.hint.source).toBe('EFD_CONTRIBUICOES');
  });

  it('identifica o CNPJ na posição correta de cada layout', async () => {
    const identifiedIcms = await identifyFile(bytesOf(icms), 'efd.txt', 'f1');
    const identifiedContrib = await identifyFile(bytesOf(contrib), 'contrib.txt', 'f2');
    expect(identifiedIcms.ok && identifiedIcms.value.identity.taxId).toBe(DEMO_COMPANY.cnpj);
    expect(identifiedContrib.ok && identifiedContrib.value.identity.taxId).toBe(DEMO_COMPANY.cnpj);
  });
});
