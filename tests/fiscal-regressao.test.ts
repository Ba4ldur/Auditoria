/**
 * Regressão dos falsos positivos corrigidos na fase 3.
 *
 * Cada cenário aqui reproduz, com arquivos, um caso em que a implementação
 * anterior acusava divergência onde não havia erro. Não são testes de detalhe
 * de implementação: são o contrato com o auditor. Se um destes ficar vermelho,
 * o sistema voltou a acusar uma empresa por algo que a legislação permite.
 *
 * Todos exercitam o pipeline real — parser, normalização, reconciliação e
 * motor de regras — a partir de arquivos gerados, nunca de objetos montados à
 * mão: um falso positivo que só aparece depois do parser não seria pego de
 * outro jeito.
 */

import { describe, expect, it } from 'vitest';
import { runAudit } from '@/lib/audit-engine';
import type { AuditFinding } from '@/lib/domain/entities';
import {
  DEMO_COMPANY,
  DEMO_SUPPLIER,
  buildEfdIcmsTxt,
  buildNfeXml,
  computeNfeTotals,
  type NfeSpec,
} from '@/lib/demo/fixtures';
import { datasetFrom, textFile, type FixtureFile } from './helpers/dataset';

const ORG = { organizationId: 'org-1', auditId: 'audit-1' };

/**
 * Compra de fornecedor de outra UF: o emitente classifica como saída
 * interestadual (6102) e destaca ICMS de 12%.
 */
function compraInterestadual(numero: number): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-14',
    naturezaOperacao: 'VENDA DE MERCADORIA',
    tpNF: '1',
    emitente: { cnpj: DEMO_SUPPLIER.cnpj, nome: DEMO_SUPPLIER.legalName, uf: 'MG' },
    destinatario: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
    items: [
      {
        codigo: 'PROD001',
        descricao: 'PRODUTO PARA REVENDA',
        ncm: '84713012',
        cfop: '6102',
        cst: '00',
        unidade: 'UN',
        quantidade: 10,
        valorUnitario: 500,
        aliquotaIcms: 12,
      },
    ],
  };
}

function efdFile(documents: { spec: NfeSpec; override?: Record<string, unknown> }[]): FixtureFile {
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

const xmlFile = (spec: NfeSpec): FixtureFile => textFile('nfe.xml', buildNfeXml(spec));

function divergencias(findings: readonly AuditFinding[], codigo: string): AuditFinding[] {
  return findings.filter((finding) => finding.ruleCode === codigo && finding.status === 'DIVERGENCIA');
}

describe('regressão: CFOP de entrada não pode gerar ATT-FIS-006', () => {
  it('6102 no XML do fornecedor e 1102 na escrituração do destinatário', async () => {
    const spec = compraInterestadual(9001);
    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec, override: { cfop: '1102' } }])]);
    const { findings } = runAudit(dataset, ORG);

    // O par existe e foi conferido; o que não pode existir é a divergência.
    expect(divergencias(findings, 'ATT-FIS-006')).toHaveLength(0);

    const naoAplicavel = findings.find(
      (finding) => finding.ruleCode === 'ATT-FIS-006' && finding.status === 'NAO_APLICAVEL',
    );
    expect(naoAplicavel).toBeDefined();
    expect(naoAplicavel?.description).toContain('ótica');
    expect(naoAplicavel?.evidence.find((item) => item.label === 'Documentos abrangidos')?.value).toBe('1');
  });

  it('2102 na escrituração, o equivalente interestadual, também não gera divergência', async () => {
    const spec = compraInterestadual(9002);
    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec, override: { cfop: '2102' } }])]);

    expect(divergencias(runAudit(dataset, ORG).findings, 'ATT-FIS-006')).toHaveLength(0);
  });
});

describe('regressão: ICMS de entrada não pode gerar ATT-FIS-005', () => {
  it('ICMS destacado no XML e crédito zero na escrituração', async () => {
    // Operação sem direito a crédito: o destinatário escritura VL_ICMS zerado
    // ainda que o emitente tenha destacado o imposto.
    const spec = compraInterestadual(9101);
    const totals = computeNfeTotals(spec);
    expect(totals.icms).toBeGreaterThan(0);

    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec, override: { icms: 0 } }])]);
    const { findings } = runAudit(dataset, ORG);

    expect(divergencias(findings, 'ATT-FIS-005')).toHaveLength(0);

    const naoAplicavel = findings.find(
      (finding) => finding.ruleCode === 'ATT-FIS-005' && finding.status === 'NAO_APLICAVEL',
    );
    expect(naoAplicavel).toBeDefined();
    expect(naoAplicavel?.description).toContain('crédito');
  });

  it('crédito parcial, inferior ao destaque, também não gera divergência', async () => {
    const spec = compraInterestadual(9102);
    const totals = computeNfeTotals(spec);

    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { icms: totals.icms / 2 } }]),
    ]);

    expect(divergencias(runAudit(dataset, ORG).findings, 'ATT-FIS-005')).toHaveLength(0);
  });
});

describe('regressão: base de ICMS de entrada não pode gerar ATT-FIS-004', () => {
  it('base destacada no XML e base apropriável diferente na escrituração', async () => {
    const spec = compraInterestadual(9201);
    const totals = computeNfeTotals(spec);

    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { baseIcms: totals.baseIcms / 2, icms: totals.icms / 2 } }]),
    ]);
    const { findings } = runAudit(dataset, ORG);

    expect(divergencias(findings, 'ATT-FIS-004')).toHaveLength(0);

    const naoAplicavel = findings.find(
      (finding) => finding.ruleCode === 'ATT-FIS-004' && finding.status === 'NAO_APLICAVEL',
    );
    expect(naoAplicavel).toBeDefined();
    expect(naoAplicavel?.humanReviewNote).toContain('não significa conformidade');
  });

  it('base zerada na entrada, caso de operação sem direito a crédito', async () => {
    const spec = compraInterestadual(9202);
    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { baseIcms: 0, icms: 0 } }]),
    ]);

    expect(divergencias(runAudit(dataset, ORG).findings, 'ATT-FIS-004')).toHaveLength(0);
  });
});

describe('regressão: as exclusões por escopo não reduzem o score', () => {
  it('auditoria só com entradas fora de escopo mantém o score intacto', async () => {
    const spec = compraInterestadual(9301);
    const totals = computeNfeTotals(spec);

    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { cfop: '1102', baseIcms: 0, icms: 0, valorDocumento: totals.total } }]),
    ]);
    const { findings, score } = runAudit(dataset, ORG);

    const foraDeEscopo = findings.filter((finding) => finding.status === 'NAO_APLICAVEL');
    expect(foraDeEscopo.length).toBeGreaterThan(0);
    expect(score.penalty).toBe(0);
    expect(score.score).toBe(100);
  });
});

describe('regressão: a saída própria continua sendo conferida', () => {
  it('ICMS divergente em saída própria ainda é divergência', async () => {
    // O contraponto necessário: afrouxar a entrada não pode afrouxar a saída.
    const venda: NfeSpec = {
      numero: 9401,
      serie: 1,
      modelo: '55',
      emissao: '2026-08-14',
      naturezaOperacao: 'VENDA DE MERCADORIA',
      tpNF: '1',
      emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
      destinatario: { cnpj: DEMO_SUPPLIER.cnpj, nome: DEMO_SUPPLIER.legalName, uf: 'MG' },
      items: [
        {
          codigo: 'PROD001',
          descricao: 'PRODUTO',
          ncm: '84713012',
          cfop: '6102',
          cst: '00',
          unidade: 'UN',
          quantidade: 10,
          valorUnitario: 500,
          aliquotaIcms: 12,
        },
      ],
    };
    const totals = computeNfeTotals(venda);

    const dataset = await datasetFrom([
      xmlFile(venda),
      efdFile([{ spec: venda, override: { icms: totals.icms - 120 } }]),
    ]);
    const { findings } = runAudit(dataset, ORG);

    const fis005 = divergencias(findings, 'ATT-FIS-005');
    expect(fis005).toHaveLength(1);
    expect(fis005[0]?.difference).toBe(12000);
    expect(fis005[0]?.nature).toBe('FATO');
  });

  it('CFOP divergente em saída própria ainda é divergência', async () => {
    const venda: NfeSpec = {
      numero: 9402,
      serie: 1,
      modelo: '55',
      emissao: '2026-08-14',
      naturezaOperacao: 'VENDA DE MERCADORIA',
      tpNF: '1',
      emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
      destinatario: { cnpj: DEMO_SUPPLIER.cnpj, nome: DEMO_SUPPLIER.legalName, uf: 'MG' },
      items: [
        {
          codigo: 'PROD001',
          descricao: 'PRODUTO',
          ncm: '84713012',
          cfop: '6102',
          cst: '00',
          unidade: 'UN',
          quantidade: 1,
          valorUnitario: 1000,
          aliquotaIcms: 12,
        },
      ],
    };

    const dataset = await datasetFrom([xmlFile(venda), efdFile([{ spec: venda, override: { cfop: '6404' } }])]);
    const fis006 = divergencias(runAudit(dataset, ORG).findings, 'ATT-FIS-006');

    expect(fis006).toHaveLength(1);
    expect(fis006[0]?.description).toContain('6102');
    expect(fis006[0]?.description).toContain('6404');
  });
});
