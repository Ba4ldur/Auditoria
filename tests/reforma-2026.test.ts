/**
 * Composição do valor total no período de transição da reforma tributária.
 *
 * O que estes cenários fixam é o comportamento diante da **incerteza**, não uma
 * tese sobre a composição correta do `VL_DOC`. O sistema:
 *
 *  - compara diretamente o que é anterior à transição;
 *  - calcula o valor comparável quando o XML declara IBS, CBS e IS, e conclui
 *    apenas quando as duas leituras (bruta e líquida) divergem;
 *  - recusa-se a concluir quando o XML não declara os grupos.
 *
 * Qual composição a legislação exige é matéria do Guia Prático em vigor e não
 * está decidida no código: `REFORM_TRANSITION_YEAR` é parâmetro, e a evidência
 * sempre diz qual composição foi usada para chegar ao número.
 */

import { describe, expect, it } from 'vitest';
import { runAudit } from '@/lib/audit-engine';
import { REFORM_TRANSITION_YEAR, comparableTotal } from '@/lib/audit-engine/reform-transition';
import { attFis003 } from '@/lib/audit-engine/rules/fiscal';
import type { AuditFinding } from '@/lib/domain/entities';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  buildEfdIcmsTxt,
  buildNfeXml,
  computeNfeTotals,
  type NfeSpec,
} from '@/lib/demo/fixtures';
import { datasetFrom, textFile, type FixtureFile } from './helpers/dataset';

const ORG = { organizationId: 'org-1', auditId: 'audit-1' };

function venda(numero: number, overrides: Partial<NfeSpec> = {}): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-14',
    naturezaOperacao: 'VENDA DE MERCADORIA',
    tpNF: '1',
    emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
    destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: 'RJ' },
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
    ...overrides,
  };
}

function efdFile(documents: { spec: NfeSpec; override?: Record<string, unknown> }[]): FixtureFile {
  return textFile(
    'efd-icms.txt',
    buildEfdIcmsTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: documents as never,
      icmsARecolher: 1200,
    }),
    'latin1',
  );
}

const xmlFile = (spec: NfeSpec): FixtureFile => textFile('nfe.xml', buildNfeXml(spec));

const fis003 = (findings: readonly AuditFinding[]): AuditFinding[] =>
  findings.filter((finding) => finding.ruleCode === 'ATT-FIS-003');

/**
 * Valor de uma linha da composição, com o espaço fino do formatador monetário
 * normalizado — `Intl.NumberFormat` usa espaço não separável, que não coincide
 * com o espaço escrito no literal do teste.
 */
function composicao(finding: AuditFinding | undefined, rotulo: string): string | undefined {
  const value = finding?.evidence.find((item) => item.label === rotulo)?.value;
  return value === null || value === undefined ? undefined : value.replace(/\u00a0/g, ' ');
}

describe('leitura dos tributos da reforma no XML', () => {
  it('lê vIBS, vCBS e vIS do grupo de totais e registra o que leu', async () => {
    const spec = venda(8001, { reforma: { ibs: 1, cbs: 9, is: 5 } });
    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec }])]);
    const invoice = dataset.invoices.find((item) => item.source === 'XML_NFE');

    expect(invoice?.reformTaxes).not.toBeNull();
    expect(invoice?.reformTaxes?.ibs).toBe(100);
    expect(invoice?.reformTaxes?.cbs).toBe(900);
    expect(invoice?.reformTaxes?.is).toBe(500);
    expect(invoice?.reformTaxes?.readFields).toEqual(['vIBS=1.00', 'vCBS=9.00', 'vIS=5.00']);
  });

  it('XML sem os grupos declara ausência, e não zero', async () => {
    const spec = venda(8002);
    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec }])]);
    const invoice = dataset.invoices.find((item) => item.source === 'XML_NFE');

    // A distinção é o que sustenta a recusa em concluir.
    expect(invoice?.reformTaxes).toBeNull();
  });

  it('o C100 não declara os novos tributos: nulo, nunca presumido', async () => {
    const spec = venda(8003, { reforma: { ibs: 1, cbs: 9 } });
    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec }])]);
    const escriturado = dataset.invoices.find((item) => item.source === 'EFD_ICMS_IPI');

    expect(escriturado?.reformTaxes).toBeNull();
  });
});

describe('valor comparável', () => {
  it('documento anterior à transição é comparado diretamente', async () => {
    const spec = venda(8101, { emissao: '2025-11-20' });
    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec }])]);
    const invoice = dataset.invoices.find((item) => item.source === 'XML_NFE');

    const composition = comparableTotal(invoice!, '2025-11');
    expect(composition.status).toBe('ANTERIOR_A_TRANSICAO');
    expect(composition.comparavel).toBe(invoice?.totals.total);
    expect(composition.exercicio).toBe(REFORM_TRANSITION_YEAR - 1);
  });

  it('na transição, com os grupos declarados, deduz o que o XML informa', async () => {
    const spec = venda(8201, { reforma: { ibs: 1, cbs: 9, is: 5 } });
    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec }])]);
    const invoice = dataset.invoices.find((item) => item.source === 'XML_NFE');

    const composition = comparableTotal(invoice!, '2026-08');
    expect(composition.status).toBe('DETERMINADA');
    expect(composition.deducoes).toBe(1500);
    expect(composition.comparavel).toBe((invoice?.totals.total ?? 0) - 1500);
  });

  it('na transição, sem os grupos, a composição não é apurada', async () => {
    const spec = venda(8301);
    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec }])]);
    const invoice = dataset.invoices.find((item) => item.source === 'XML_NFE');

    const composition = comparableTotal(invoice!, '2026-08');
    expect(composition.status).toBe('INDETERMINADA');
    expect(composition.deducoes).toBe(0);
    expect(composition.explicacao).toContain('não é possível determinar');
  });
});

describe('ATT-FIS-003 no exercício de transição', () => {
  it('escrituração líquida dos novos tributos concilia e não gera ocorrência', async () => {
    const spec = venda(8401, { reforma: { ibs: 1, cbs: 9, is: 5 } });
    const totals = computeNfeTotals(spec);

    // O VL_DOC corresponde ao total menos IBS, CBS e IS.
    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { valorDocumento: totals.total - 15 } }]),
    ]);

    expect(fis003(runAudit(dataset, ORG).findings)).toHaveLength(0);
  });

  it('escrituração pelo total bruto também concilia, e não vira divergência', async () => {
    // As duas composições são defensáveis enquanto o tratamento não estiver
    // confirmado; acusar erro em qualquer uma delas seria conclusão sem lastro.
    const spec = venda(8501, { reforma: { ibs: 1, cbs: 9, is: 5 } });
    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec }])]);

    expect(fis003(runAudit(dataset, ORG).findings)).toHaveLength(0);
  });

  it('diferença que nenhuma das composições explica é divergência de fato', async () => {
    const spec = venda(8601, { reforma: { ibs: 1, cbs: 9, is: 5 } });
    const totals = computeNfeTotals(spec);

    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { valorDocumento: totals.total - 400 } }]),
    ]);
    const finding = fis003(runAudit(dataset, ORG).findings)[0];

    expect(finding?.status).toBe('DIVERGENCIA');
    expect(finding?.nature).toBe('FATO');
    expect(finding?.description).toContain('total bruto');

    // A evidência mostra a conta inteira, na ordem em que se confere.
    expect(composicao(finding, 'vNF original')).toBe('R$ 1.000,00');
    expect(composicao(finding, '(-) IBS')).toBe('R$ 1,00');
    expect(composicao(finding, '(-) CBS')).toBe('R$ 9,00');
    expect(composicao(finding, '(-) IS')).toBe('R$ 5,00');
    expect(composicao(finding, 'valor comparável')).toBe('R$ 985,00');
    expect(composicao(finding, 'VL_DOC')).toBe('R$ 600,00');
    expect(composicao(finding, 'Elementos lidos do XML')).toContain('vIBS=1.00');
  });

  it('sem os grupos no XML, a mesma diferença sai como indício', async () => {
    const spec = venda(8701);
    const totals = computeNfeTotals(spec);

    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { valorDocumento: totals.total - 400 } }]),
    ]);
    const finding = fis003(runAudit(dataset, ORG).findings)[0];

    expect(finding?.status).toBe('ALERTA');
    expect(finding?.nature).toBe('INDICIO');
    expect(finding?.difference).toBe(40000);
    expect(finding?.description).toContain('composição do total não pôde ser determinada');
    expect(finding?.humanReviewNote).toContain('Guia Prático');
    expect(composicao(finding, '(-) IBS')).toBe('não declarado no XML');
    expect(composicao(finding, 'valor comparável')).toContain('composição não apurada');
  });

  it('antes da transição, a mesma diferença é divergência de fato', async () => {
    const spec = venda(8801, { emissao: '2025-11-20' });
    const totals = computeNfeTotals(spec);

    const dataset = await datasetFrom(
      [xmlFile(spec), efdFile([{ spec, override: { valorDocumento: totals.total - 400 } }])],
      { competencia: '2025-11' },
    );
    const finding = fis003(runAudit(dataset, ORG).findings)[0];

    expect(finding?.status).toBe('DIVERGENCIA');
    expect(finding?.nature).toBe('FATO');
    // Sem linhas de dedução: não há composição a ajustar.
    expect(composicao(finding, '(-) IBS')).toBeUndefined();
    expect(composicao(finding, 'Composição utilizada')).toContain('anterior à transição');
  });

  it('a regra declara que não decide o tratamento, e sim que o apresenta', () => {
    // A limitação é parte do contrato exibido ao auditor na tela de regras.
    expect(attFis003.limitacoes).toContain('NÃO afirma qual composição é a correta');
    expect(attFis003.limitacoes).toContain('profissional habilitado');
    expect(attFis003.versao).toBe('3.0.0');
  });
});
