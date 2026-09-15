/**
 * Composição do valor total do documento por exercício.
 *
 * Base normativa: Guia Prático da EFD ICMS/IPI, versão 3.2.2 (11/02/2026),
 * Seção 10 — Informações sobre a Reforma Tributária sobre o Consumo. Como
 * regra, CBS, IBS e IS são considerados no valor total escriturado; **no
 * exercício de 2026 eles não integram o `VL_DOC` do C100**.
 *
 * Os cenários fixam três coisas:
 *
 *  1. o regime aplicado é o do exercício do documento, não uma heurística;
 *  2. `vNF` e `vNFTot` são totais distintos e nunca são confundidos;
 *  3. onde o regime não pode ser aplicado, o sistema não conclui.
 */

import { describe, expect, it } from 'vitest';
import { runAudit } from '@/lib/audit-engine';
import {
  COMPOSITION_REGIMES,
  GUIA_PRATICO_322,
  REFORM_TRANSITION_YEAR,
  comparableTotal,
  regimeFor,
} from '@/lib/audit-engine/reform-transition';
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

/** Parcelas usadas nos cenários: IBS 1,00 + CBS 9,00 + IS 5,00 = 15,00. */
const PARCELAS = { ibs: 1, cbs: 9, is: 5 } as const;
const PARCELAS_CENTS = 1500;

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

function efdFile(
  documents: { spec: NfeSpec; override?: Record<string, unknown> }[],
  periodo = { startDate: '2026-08-01', endDate: '2026-08-31' },
): FixtureFile {
  return textFile(
    'efd-icms.txt',
    buildEfdIcmsTxt({ ...periodo, documents: documents as never, icmsARecolher: 1200 }),
    'latin1',
  );
}

const xmlFile = (spec: NfeSpec): FixtureFile => textFile('nfe.xml', buildNfeXml(spec));

const fis003 = (findings: readonly AuditFinding[]): AuditFinding[] =>
  findings.filter((finding) => finding.ruleCode === 'ATT-FIS-003');

/** Valor de uma linha da evidência, com o espaço fino do formatador normalizado. */
function linha(finding: AuditFinding | undefined, rotulo: string): string | undefined {
  const value = finding?.evidence.find((item) => item.label === rotulo)?.value;
  return value === null || value === undefined ? undefined : value.replace(/ /g, ' ');
}

async function invoiceOf(spec: NfeSpec, competencia = '2026-08') {
  const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec }])], { competencia });
  return dataset.invoices.find((item) => item.source === 'XML_NFE')!;
}

// -----------------------------------------------------------------------------

describe('regimes de composição por vigência', () => {
  it('seleciona o regime pelo exercício do documento', () => {
    expect(regimeFor(2025).id).toBe('SEM_REFORMA');
    expect(regimeFor(2026).id).toBe('EXCLUSAO_2026');
    expect(regimeFor(2027).id).toBe('INTEGRACAO_RTC');
    expect(regimeFor(2030).id).toBe('INTEGRACAO_RTC');
  });

  it('exercício indeterminado não recebe regime por presunção', () => {
    expect(regimeFor(null).id).toBe('SEM_REGRA_DEFINIDA');
  });

  it('o regime de 2026 vale só para 2026 e cita a fonte oficial', () => {
    const regime = COMPOSITION_REGIMES.find((item) => item.id === 'EXCLUSAO_2026');

    expect(regime?.from).toBe(REFORM_TRANSITION_YEAR);
    expect(regime?.to).toBe(REFORM_TRANSITION_YEAR);
    expect(regime?.fonte).toBe(GUIA_PRATICO_322);
    expect(regime?.fonte).toContain('3.2.2');
    expect(regime?.criterio).toContain('NÃO integram o VL_DOC');
  });

  it('cada regime declara fonte normativa', () => {
    for (const regime of COMPOSITION_REGIMES) {
      expect(regime.fonte.length).toBeGreaterThan(20);
      expect(regime.criterio.length).toBeGreaterThan(20);
    }
  });
});

describe('leitura dos totais no XML', () => {
  it('vNF e vNFTot são lidos como campos distintos', async () => {
    const spec = venda(8001, { reforma: PARCELAS });
    const invoice = await invoiceOf(spec);

    expect(invoice.totals.total).toBe(100000);
    expect(invoice.reformTaxes?.totalWithReformTaxes).toBe(101500);
    // O total RTC é o tradicional acrescido das parcelas — nunca o mesmo número.
    expect(invoice.reformTaxes?.totalWithReformTaxes).not.toBe(invoice.totals.total);
  });

  it('lê IBS, CBS, IS e vNFTot e registra exatamente o que encontrou', async () => {
    const invoice = await invoiceOf(venda(8002, { reforma: PARCELAS }));

    expect(invoice.reformTaxes?.ibs).toBe(100);
    expect(invoice.reformTaxes?.cbs).toBe(900);
    expect(invoice.reformTaxes?.is).toBe(500);
    expect(invoice.reformTaxes?.readFields).toEqual([
      'vIBS=1.00',
      'vCBS=9.00',
      'vIS=5.00',
      'vNFTot=1015.00',
    ]);
  });

  it('documento que declara as parcelas sem o total consolidado', async () => {
    const invoice = await invoiceOf(venda(8003, { reforma: { ...PARCELAS, semTotalRtc: true } }));

    expect(invoice.reformTaxes?.ibs).toBe(100);
    expect(invoice.reformTaxes?.totalWithReformTaxes).toBeNull();
  });

  it('XML sem os grupos declara ausência, e não zero', async () => {
    const invoice = await invoiceOf(venda(8004));
    expect(invoice.reformTaxes).toBeNull();
  });

  it('o C100 não declara os novos tributos: nulo, nunca presumido', async () => {
    const spec = venda(8005, { reforma: PARCELAS });
    const dataset = await datasetFrom([xmlFile(spec), efdFile([{ spec }])]);
    expect(dataset.invoices.find((item) => item.source === 'EFD_ICMS_IPI')?.reformTaxes).toBeNull();
  });
});

describe('valor comparável por exercício', () => {
  it('2025: comparação direta pelo total tradicional', async () => {
    const invoice = await invoiceOf(venda(8101, { emissao: '2025-11-20' }), '2025-11');
    const composition = comparableTotal(invoice, '2025-11');

    expect(composition.regime.id).toBe('SEM_REFORMA');
    expect(composition.status).toBe('DETERMINADA');
    expect(composition.comparavel).toBe(invoice.totals.total);
    expect(composition.origemDoComparavel).toBe('total/ICMSTot/vNF');
  });

  it('2026: o comparável é o vNF, e o vNFTot fica fora', async () => {
    const invoice = await invoiceOf(venda(8201, { reforma: PARCELAS }));
    const composition = comparableTotal(invoice, '2026-08');

    expect(composition.regime.id).toBe('EXCLUSAO_2026');
    expect(composition.status).toBe('DETERMINADA');
    expect(composition.comparavel).toBe(invoice.totals.total);
    expect(composition.origemDoComparavel).toBe('total/ICMSTot/vNF');
    // O campo foi lido e preservado, apenas não entra na conta deste exercício.
    expect(composition.vNFTot).toBe(101500);
    expect(composition.comparavel).not.toBe(composition.vNFTot);
    expect(composition.explicacao).toContain('não integram o VL_DOC');
  });

  it('2026 sem os grupos no XML: o comparável continua sendo o vNF', async () => {
    // O regime não exige os grupos: ele os exclui. Ausência não impede aplicar.
    const invoice = await invoiceOf(venda(8301));
    const composition = comparableTotal(invoice, '2026-08');

    expect(composition.status).toBe('DETERMINADA');
    expect(composition.comparavel).toBe(invoice.totals.total);
    expect(composition.vNFTot).toBeNull();
  });

  it('2027: o comparável é o vNFTot, quando declarado', async () => {
    const invoice = await invoiceOf(venda(8401, { emissao: '2027-03-10', reforma: PARCELAS }), '2027-03');
    const composition = comparableTotal(invoice, '2027-03');

    expect(composition.regime.id).toBe('INTEGRACAO_RTC');
    expect(composition.comparavel).toBe(101500);
    expect(composition.origemDoComparavel).toBe('total/vNFTot');
  });

  it('2027 sem vNFTot: soma as parcelas declaradas e diz que fez isso', async () => {
    const invoice = await invoiceOf(
      venda(8501, { emissao: '2027-03-10', reforma: { ...PARCELAS, semTotalRtc: true } }),
      '2027-03',
    );
    const composition = comparableTotal(invoice, '2027-03');

    expect(composition.comparavel).toBe(invoice.totals.total + PARCELAS_CENTS);
    expect(composition.origemDoComparavel).toBe('total/ICMSTot/vNF + vIBS + vCBS + vIS');
  });

  it('2027 sem nenhum campo da reforma: composição não apurada', async () => {
    const invoice = await invoiceOf(venda(8601, { emissao: '2027-03-10' }), '2027-03');
    const composition = comparableTotal(invoice, '2027-03');

    expect(composition.status).toBe('INDETERMINADA');
    expect(composition.explicacao).toContain('não pôde ser formado');
  });
});

describe('ATT-FIS-003 no exercício de 2026', () => {
  it('VL_DOC sem os novos tributos concilia — o caso normativamente correto', async () => {
    const spec = venda(8701, { reforma: PARCELAS });
    const totals = computeNfeTotals(spec);

    // VL_DOC = vNF, como o Guia Prático determina para 2026.
    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { valorDocumento: totals.total } }]),
    ]);

    expect(fis003(runAudit(dataset, ORG).findings)).toHaveLength(0);
  });

  it('VL_DOC com os novos tributos diverge, porque em 2026 não deveria incluí-los', async () => {
    const spec = venda(8801, { reforma: PARCELAS });
    const totals = computeNfeTotals(spec);

    // O contribuinte escriturou o total RTC no VL_DOC: é diferença real.
    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { valorDocumento: totals.total + 15 } }]),
    ]);
    const finding = fis003(runAudit(dataset, ORG).findings)[0];

    expect(finding?.status).toBe('DIVERGENCIA');
    expect(finding?.nature).toBe('FATO');
    expect(finding?.difference).toBe(-PARCELAS_CENTS);
  });

  it('a evidência mostra a composição inteira, com a fonte normativa', async () => {
    const spec = venda(8901, { reforma: PARCELAS });
    const totals = computeNfeTotals(spec);

    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { valorDocumento: totals.total - 400 } }]),
    ]);
    const finding = fis003(runAudit(dataset, ORG).findings)[0];

    expect(linha(finding, 'Exercício')).toBe('2026');
    expect(linha(finding, 'vNF')).toBe('R$ 1.000,00');
    expect(linha(finding, 'vNFTot')).toContain('R$ 1.015,00');
    expect(linha(finding, 'vNFTot')).toContain('fora da comparação neste exercício');
    expect(linha(finding, 'IBS')).toBe('R$ 1,00');
    expect(linha(finding, 'CBS')).toBe('R$ 9,00');
    expect(linha(finding, 'IS')).toBe('R$ 5,00');
    expect(linha(finding, 'Regra de composição aplicada')).toContain('NÃO integram o VL_DOC');
    expect(linha(finding, 'Valor comparável')).toContain('R$ 1.000,00');
    expect(linha(finding, 'Valor comparável')).toContain('total/ICMSTot/vNF');
    expect(linha(finding, 'C100.VL_DOC')).toBe('R$ 600,00');
    expect(linha(finding, 'Diferença')).toBe('R$ 400,00');
    expect(linha(finding, 'Fonte normativa')).toBe(GUIA_PRATICO_322);
    expect(linha(finding, 'Tolerância aplicada')).toContain('Tolerância');

    // Cada linha aponta o campo do leiaute de onde saiu.
    const campos = finding?.evidence.map((item) => item.fieldName) ?? [];
    expect(campos).toContain('total/ICMSTot/vNF');
    expect(campos).toContain('total/vNFTot');
    expect(campos).toContain('VL_DOC');
  });

  it('antes da transição, sem linhas de reforma na composição', async () => {
    const spec = venda(9001, { emissao: '2025-11-20' });
    const totals = computeNfeTotals(spec);

    const dataset = await datasetFrom(
      [
        xmlFile(spec),
        efdFile([{ spec, override: { valorDocumento: totals.total - 400 } }], {
          startDate: '2025-11-01',
          endDate: '2025-11-30',
        }),
      ],
      { competencia: '2025-11' },
    );
    const finding = fis003(runAudit(dataset, ORG).findings)[0];

    expect(finding?.status).toBe('DIVERGENCIA');
    expect(linha(finding, 'Exercício')).toBe('2025');
    expect(linha(finding, 'vNFTot')).toBe('não declarado no XML');
    expect(linha(finding, 'Regra de composição aplicada')).toContain('Anterior à reforma');
  });

  it('a regra declara o critério e a limitação no contrato exibido ao auditor', () => {
    expect(attFis003.versao).toBe('4.0.0');
    expect(attFis003.limitacoes).toContain('não integram o VL_DOC');
    expect(attFis003.limitacoes).toContain('vNFTot');
    expect(attFis003.limitacoes).toContain('profissional habilitado');
  });
});

describe('regressão: vNFTot nunca é comparado com o VL_DOC de 2026', () => {
  it('NF-e 2026 com IBS/CBS/IS, vNFTot com os tributos e VL_DOC sem eles: sem divergência', async () => {
    const spec = venda(9101, { reforma: PARCELAS });
    const totals = computeNfeTotals(spec);
    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { valorDocumento: totals.total } }]),
    ]);

    const invoice = dataset.invoices.find((item) => item.source === 'XML_NFE');
    const escriturado = dataset.invoices.find((item) => item.source === 'EFD_ICMS_IPI');

    // O cenário é exatamente o que produziria o falso positivo: os dois totais
    // existem, diferem entre si, e o VL_DOC coincide apenas com o tradicional.
    expect(invoice?.reformTaxes?.totalWithReformTaxes).toBe(101500);
    expect(escriturado?.totals.total).toBe(100000);
    expect(invoice?.reformTaxes?.totalWithReformTaxes).not.toBe(escriturado?.totals.total);

    expect(fis003(runAudit(dataset, ORG).findings)).toHaveLength(0);
  });

  it('a diferença acusada nunca é exatamente o valor dos tributos da reforma', async () => {
    // Assinatura do falso positivo: se o sistema comparasse vNFTot com VL_DOC,
    // a diferença seria igual à soma de IBS, CBS e IS. Se isso reaparecer com o
    // VL_DOC correto, a regra voltou a usar o total errado.
    const spec = venda(9201, { reforma: PARCELAS });
    const totals = computeNfeTotals(spec);
    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { valorDocumento: totals.total } }]),
    ]);

    const diferencas = fis003(runAudit(dataset, ORG).findings).map((finding) => finding.difference);
    expect(diferencas).not.toContain(PARCELAS_CENTS);
    expect(diferencas).toHaveLength(0);
  });

  it('parcelas grandes não mudam a conclusão em 2026', async () => {
    // Com tributos de valor alto, um comparativo errado seria escandaloso; a
    // regra continua conciliando pelo total tradicional.
    const spec = venda(9301, { reforma: { ibs: 120, cbs: 180, is: 60 } });
    const totals = computeNfeTotals(spec);
    const dataset = await datasetFrom([
      xmlFile(spec),
      efdFile([{ spec, override: { valorDocumento: totals.total } }]),
    ]);

    const invoice = dataset.invoices.find((item) => item.source === 'XML_NFE');
    expect(invoice?.reformTaxes?.totalWithReformTaxes).toBe(136000);
    expect(fis003(runAudit(dataset, ORG).findings)).toHaveLength(0);
  });

  it('em 2027 o mesmo documento é comparado pelo vNFTot, e aí o VL_DOC tradicional diverge', async () => {
    // Prova que a diferença de tratamento é do exercício, não do campo.
    const spec = venda(9401, { emissao: '2027-03-10', reforma: PARCELAS });
    const totals = computeNfeTotals(spec);
    const dataset = await datasetFrom(
      [
        xmlFile(spec),
        efdFile([{ spec, override: { valorDocumento: totals.total } }], {
          startDate: '2027-03-01',
          endDate: '2027-03-31',
        }),
      ],
      { competencia: '2027-03' },
    );
    const finding = fis003(runAudit(dataset, ORG).findings)[0];

    expect(finding?.status).toBe('DIVERGENCIA');
    expect(finding?.difference).toBe(PARCELAS_CENTS);
    expect(linha(finding, 'Valor comparável')).toContain('total/vNFTot');
  });
});
