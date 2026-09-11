import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { buildDataset, resolveDirection, xmlInvoices } from '@/lib/normalization/dataset';
import { assessIdentity } from '@/lib/normalization/identity';
import { parseFile } from '@/lib/parsers';
import { EMPTY_IDENTITY } from '@/lib/domain/model';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  DEMO_SUPPLIER,
  buildNfeXml,
  type NfeSpec,
} from '@/lib/demo/fixtures';
import { demoCompany, textFile } from './helpers/dataset';

function sale(numero: number): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-05',
    naturezaOperacao: 'VENDA',
    tpNF: '1',
    emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
    destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: 'RJ' },
    items: [
      {
        codigo: 'P1',
        descricao: 'PRODUTO',
        ncm: '84713012',
        cfop: '6102',
        cst: '00',
        unidade: 'UN',
        quantidade: 1,
        valorUnitario: 100,
        aliquotaIcms: 12,
      },
    ],
  };
}

function purchase(numero: number): NfeSpec {
  return {
    ...sale(numero),
    emitente: { cnpj: DEMO_SUPPLIER.cnpj, nome: DEMO_SUPPLIER.legalName, uf: 'MG' },
    destinatario: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
  };
}

describe('direcao da operação relativa a empresa auditada', () => {
  it('trata como saída o documento emitido pela empresa', async () => {
    const dataset = await datasetOf([textFile('venda.xml', buildNfeXml(sale(1)))]);
    expect(xmlInvoices(dataset)[0]?.direction).toBe('SAIDA');
  });

  it('trata como entrada o documento emitido por terceiro contra a empresa', async () => {
    const dataset = await datasetOf([textFile('compra.xml', buildNfeXml(purchase(2)))]);
    expect(xmlInvoices(dataset)[0]?.direction).toBe('ENTRADA');
  });

  it('resolve a direcao pelo CNPJ, e não pelo tpNF do emitente', () => {
    const invoice = {
      direction: 'SAIDA' as const,
      emitterTaxId: DEMO_SUPPLIER.cnpj,
      recipientTaxId: DEMO_COMPANY.cnpj,
    };
    expect(resolveDirection(invoice as never, DEMO_COMPANY.cnpj)).toBe('ENTRADA');
  });
});

describe('deduplicação entre arquivos', () => {
  it('conta uma única vez o documento presente no ZIP e também avulso', async () => {
    const xml = buildNfeXml(sale(10));
    const archive = zipSync({ 'nfe.xml': Buffer.from(xml, 'utf8') });

    const dataset = await datasetOf([
      textFile('avulso.xml', xml),
      { name: 'lote.zip', bytes: archive },
    ]);

    expect(xmlInvoices(dataset)).toHaveLength(1);
  });
});

describe('verificação de identidade do arquivo', () => {
  const company = demoCompany();

  it('aceita arquivo do CNPJ cadastrado', () => {
    const assessment = assessIdentity(
      { ...EMPTY_IDENTITY, taxId: DEMO_COMPANY.cnpj, competencia: '2026-08' },
      company,
      '2026-08',
    );
    expect(assessment.check).toBe('COMPATIVEL');
    expect(assessment.blocking).toBe(false);
  });

  it('bloqueia arquivo de outro CNPJ e explica a diferença', () => {
    const assessment = assessIdentity(
      { ...EMPTY_IDENTITY, taxId: DEMO_SUPPLIER.cnpj, legalName: DEMO_SUPPLIER.legalName },
      company,
      '2026-08',
    );
    expect(assessment.check).toBe('INCOMPATIVEL');
    expect(assessment.blocking).toBe(true);
    const message = assessment.messages[0];
    expect(message?.code).toBe('ARQUIVO_INCOMPATIVEL');
    expect(message?.detail).toContain('Empresa selecionada');
    expect(message?.detail).toContain('CNPJ encontrado');
  });

  it('sinaliza competência divergente sem bloquear', () => {
    const assessment = assessIdentity(
      { ...EMPTY_IDENTITY, taxId: DEMO_COMPANY.cnpj, competencia: '2026-07' },
      company,
      '2026-08',
    );
    expect(assessment.check).toBe('COMPATIVEL');
    expect(assessment.blocking).toBe(false);
    expect(assessment.messages[0]?.code).toBe('COMPETENCIA_DIVERGENTE');
  });

  it('não bloqueia quando o CNPJ não pode ser identificado', () => {
    const assessment = assessIdentity(EMPTY_IDENTITY, company, '2026-08');
    expect(assessment.check).toBe('NAO_IDENTIFICADO');
    expect(assessment.blocking).toBe(false);
  });
});

async function datasetOf(files: { name: string; bytes: Uint8Array }[]) {
  const payloads = [];
  for (const [index, file] of files.entries()) {
    const result = await parseFile(file.bytes, file.name, `f${index}`);
    if (!result.ok) throw new Error(result.error.message);
    payloads.push({ payload: result.value, fileId: `f${index}`, fileName: file.name });
  }
  return buildDataset({ company: demoCompany(), competencia: '2026-08', payloads });
}
