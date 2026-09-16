/**
 * Amostragem estratificada para conferência manual (fase 4).
 *
 * Cobre o que a documentação de `sampling.ts` promete: seleção determinística,
 * nenhum número fixo quando a população não alcança a meta do estrato, e um
 * documento contribuindo para vários estratos ao mesmo tempo.
 */

import { describe, expect, it } from 'vitest';
import { runAudit } from '@/lib/audit-engine';
import { buildSample, STRATUM_LABELS, type SampleStratum } from '@/lib/validation/sampling';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  DEMO_SUPPLIER,
  buildEfdIcmsTxt,
  buildNfeXml,
  type NfeSpec,
} from '@/lib/demo/fixtures';
import { datasetFrom, textFile, type FixtureFile } from './helpers/dataset';

const ORG = { organizationId: 'org-1', auditId: 'audit-1' };

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

describe('determinismo', () => {
  it('a mesma competência produz sempre a mesma amostra, mesmo remontando o dataset do zero', async () => {
    const specs = [
      saida(1001),
      saida(1002),
      entrada(1003),
      saida(1004, { cancelada: true }),
      saida(1005, { finNFe: '4' }),
    ];
    const files = [...xmlFiles(specs), efdFile(specs.map((spec) => ({ spec })))];

    // Duas remontagens independentes do dataset, a partir dos mesmos bytes de
    // arquivo — não duas leituras do mesmo objeto (que trivialmente bateria
    // pela memoização de `reconcile`).
    const datasetA = await datasetFrom(files);
    const datasetB = await datasetFrom(files);

    const { findings: findingsA } = runAudit(datasetA, ORG);
    const { findings: findingsB } = runAudit(datasetB, ORG);

    const sampleA = buildSample(datasetA, findingsA);
    const sampleB = buildSample(datasetB, findingsB);

    expect(sampleA.population).toBe(sampleB.population);
    expect(sampleA.documents.map((doc) => doc.accessKey)).toEqual(
      sampleB.documents.map((doc) => doc.accessKey),
    );
    expect(sampleA.documents.map((doc) => doc.strata)).toEqual(
      sampleB.documents.map((doc) => doc.strata),
    );
    expect(sampleA.strata).toEqual(sampleB.strata);
  });

  it('a ordem dos documentos na amostra é sempre por chave de acesso', async () => {
    const specs = [saida(2003), saida(2001), saida(2002)];
    const dataset = await datasetFrom([...xmlFiles(specs), efdFile(specs.map((spec) => ({ spec })))]);
    const sample = buildSample(dataset, []);

    const keys = sample.documents.map((doc) => doc.accessKey);
    expect(keys).toEqual([...keys].sort());
  });
});

describe('população menor que a meta do estrato', () => {
  it('não preenche a amostra com repetição quando a população é insuficiente', async () => {
    // Só uma devolução em toda a competência; a meta do estrato é 3.
    const specs = [saida(3001), saida(3002), saida(3003, { finNFe: '4' })];
    const dataset = await datasetFrom([...xmlFiles(specs), efdFile(specs.map((spec) => ({ spec })))]);
    const sample = buildSample(dataset, []);

    const devolucao = sample.strata.find((entry) => entry.stratum === 'DEVOLUCAO');
    expect(devolucao).toBeDefined();
    expect(devolucao?.population).toBe(1);
    expect(devolucao?.selected).toBe(1);
    expect(devolucao?.target).toBe(3);
    expect(devolucao?.selected).toBeLessThan(devolucao!.target);
  });

  it('estrato com população zero aparece no resumo como inexistente, não é omitido', async () => {
    // Nenhuma entrada nesta competência.
    const specs = [saida(3101), saida(3102)];
    const dataset = await datasetFrom([...xmlFiles(specs), efdFile(specs.map((spec) => ({ spec })))]);
    const sample = buildSample(dataset, []);

    const entradaStratum = sample.strata.find((entry) => entry.stratum === 'ENTRADA');
    expect(entradaStratum).toBeDefined();
    expect(entradaStratum?.population).toBe(0);
    expect(entradaStratum?.selected).toBe(0);
  });

  it('todos os 10 estratos declarados sempre aparecem no resumo, mesmo vazios', async () => {
    const specs = [saida(3201)];
    const dataset = await datasetFrom([...xmlFiles(specs), efdFile(specs.map((spec) => ({ spec })))]);
    const sample = buildSample(dataset, []);

    expect(sample.strata).toHaveLength(Object.keys(STRATUM_LABELS).length);
    for (const label of Object.values(STRATUM_LABELS)) {
      expect(sample.strata.some((entry) => entry.label === label)).toBe(true);
    }
  });
});

describe('documento pertencendo a mais de um estrato', () => {
  it('uma entrada devolvida conta para ENTRADA e DEVOLUCAO ao mesmo tempo', async () => {
    const devolucaoEntrada = entrada(4001, { finNFe: '4' });
    const dataset = await datasetFrom([
      ...xmlFiles([devolucaoEntrada]),
      efdFile([{ spec: devolucaoEntrada }]),
    ]);
    const { findings } = runAudit(dataset, ORG);
    const sample = buildSample(dataset, findings);

    const documento = sample.documents[0];
    expect(documento?.strata).toContain('ENTRADA');
    expect(documento?.strata).toContain('DEVOLUCAO');
    // A meta de contribuição não é exclusiva: o mesmo documento não é contado
    // duas vezes na população total.
    expect(sample.population).toBe(1);
  });

  it('um documento cancelado e de devolução conta para os dois estratos', async () => {
    const spec = saida(4101, { finNFe: '4', cancelada: true });
    const dataset = await datasetFrom([...xmlFiles([spec]), efdFile([{ spec, override: { codSit: '02' } }])]);
    const sample = buildSample(dataset, []);

    const documento = sample.documents.find((doc) => doc.strata.includes('CANCELADA'));
    expect(documento).toBeDefined();
    expect(documento?.strata).toEqual(
      expect.arrayContaining<SampleStratum>(['CANCELADA', 'DEVOLUCAO']),
    );
  });

  it('a chave de amostragem por regra registra os códigos que se pronunciaram sobre o documento', async () => {
    // Divergência de ICMS na saída própria: ATT-FIS-005 se pronuncia.
    const spec = saida(4201);
    const { totals } = await import('@/lib/demo/fixtures').then((mod) => ({
      totals: mod.computeNfeTotals(spec),
    }));
    const dataset = await datasetFrom([
      ...xmlFiles([spec]),
      efdFile([{ spec, override: { icms: totals.icms - 100 } }]),
    ]);
    const { findings } = runAudit(dataset, ORG);
    const sample = buildSample(dataset, findings);

    const documento = sample.documents.find((doc) => doc.accessKey);
    expect(documento?.ruleCodes).toContain('ATT-FIS-005');
    expect(documento?.strata).toContain('COM_DIVERGENCIA');
  });
});

describe('estratos sem documento correspondente na população', () => {
  it('sem entradas nem XML de terceiro na competência, o estrato SEM_XML e SEM_ESCRITURACAO ficam vazios quando tudo casa', async () => {
    const specs = [saida(5001), saida(5002)];
    const dataset = await datasetFrom([...xmlFiles(specs), efdFile(specs.map((spec) => ({ spec })))]);
    const sample = buildSample(dataset, []);

    expect(sample.strata.find((entry) => entry.stratum === 'SEM_XML')?.population).toBe(0);
    expect(sample.strata.find((entry) => entry.stratum === 'SEM_ESCRITURACAO')?.population).toBe(0);
  });

  it('XML sem escrituração contribui para a população de SEM_ESCRITURACAO e entra na amostra', async () => {
    const escriturado = saida(5101);
    const semEscrituracao = saida(5102);
    const dataset = await datasetFrom([
      ...xmlFiles([escriturado, semEscrituracao]),
      efdFile([{ spec: escriturado }]),
    ]);
    const { findings } = runAudit(dataset, ORG);
    const sample = buildSample(dataset, findings);

    const stratum = sample.strata.find((entry) => entry.stratum === 'SEM_ESCRITURACAO');
    expect(stratum?.population).toBe(1);

    // O documento entra na amostra com o rótulo SEM_ESCRITURACAO — ainda que o
    // "selected" daquele estrato específico possa ser 0 quando outro estrato
    // (aqui, COM_DIVERGENCIA: ATT-FIS-001 acusa a ausência) já tiver
    // reivindicado o mesmo documento antes, na ordem de varredura dos
    // estratos. O que a amostra garante é que o documento apareça uma vez,
    // com todos os estratos a que pertence — não que cada estrato "gaste" uma
    // vaga própria nele.
    const documento = sample.documents.find((doc) => doc.strata.includes('SEM_ESCRITURACAO'));
    expect(documento).toBeDefined();
    expect(documento?.strata).toContain('COM_DIVERGENCIA');
  });
});
