import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/core/money';
import { compareValues } from '@/lib/audit-engine/tolerance';
import { bandFor, computeScore } from '@/lib/audit-engine/score';
import { composeRevenue, policyFromRules } from '@/lib/audit-engine/revenue-composition';
import { runAudit } from '@/lib/audit-engine';
import { AUDIT_RULES } from '@/lib/audit-engine/rules';
import { DEFAULT_SCORE_WEIGHTS, type AuditFinding, type CfopRule, type CfopTreatment } from '@/lib/domain/entities';
import { xmlInvoices } from '@/lib/normalization/dataset';
import { buildTextPdf } from '@/lib/demo/pdf-writer';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  buildEfdContribTxt,
  buildEfdIcmsTxt,
  buildNfeXml,
  buildPgdasdText,
  computeNfeTotals,
  nfeAccessKey,
  type NfeSpec,
} from '@/lib/demo/fixtures';
import { datasetFrom, textFile, type FixtureFile } from './helpers/dataset';

function sale(numero: number, valorUnitario = 1000, overrides: Partial<NfeSpec> = {}): NfeSpec {
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
        descricao: 'PRODUTO DEMONSTRAÇÃO A',
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

const ORG = { organizationId: 'org-1', auditId: 'audit-1' };

/** Política de CFOP para os cenários de teste. */
function cfopPolicy(entries: Readonly<Record<string, CfopTreatment>>) {
  const rules: CfopRule[] = Object.entries(entries).map(([cfop, treatment]) => ({
    id: `rule-${cfop}`,
    organizationId: 'org-1',
    cfop,
    description: null,
    treatment,
    reason: null,
    ruleSource: 'CONFIGURADO' as const,
    updatedBy: 'teste',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  return policyFromRules(rules);
}

/** Política que inclui todos os CFOPs usados nos cenários de faturamento. */
const FULL_POLICY = cfopPolicy({ '5102': 'INCLUIR', '6102': 'INCLUIR', '5202': 'EXCLUIR' });



function findingsByRule(findings: readonly AuditFinding[], code: string): AuditFinding[] {
  return findings.filter((finding) => finding.ruleCode === code);
}

describe('tolerância configurável', () => {
  it('trata diferença dentro da tolerância absoluta como arredondamento', () => {
    const comparison = compareValues(cents(100000), cents(100004), {
      absoluteTolerance: cents(5),
      percentageTolerance: 0,
    });
    expect(comparison.withinTolerance).toBe(true);
    expect(comparison.difference).toBe(-4);
  });

  it('acusa diferença acima da tolerância absoluta', () => {
    const comparison = compareValues(cents(100000), cents(99990), {
      absoluteTolerance: cents(5),
      percentageTolerance: 0,
    });
    expect(comparison.withinTolerance).toBe(false);
    expect(comparison.difference).toBe(10);
  });

  it('aplica tolerância percentual sobre o maior dos valores', () => {
    const comparison = compareValues(cents(100000), cents(99500), {
      absoluteTolerance: cents(5),
      percentageTolerance: 1,
    });
    expect(comparison.withinTolerance).toBe(true);
    expect(comparison.toleranceLabel).toContain('percentual');
  });
});

describe('score de conformidade', () => {
  it('parte de 100 e desconta por gravidade', () => {
    const result = computeScore(
      [
        { status: 'DIVERGENCIA', severity: 'CRITICA' },
        { status: 'DIVERGENCIA', severity: 'MEDIA' },
        { status: 'ALERTA', severity: 'BAIXA' },
        { status: 'OK', severity: 'INFO' },
      ],
      DEFAULT_SCORE_WEIGHTS,
    );
    expect(result.penalty).toBe(15 + 3 + 1);
    expect(result.score).toBe(81);
    expect(result.band).toBe('BOM');
  });

  it('nunca fica abaixo de zero', () => {
    const many = Array.from({ length: 40 }, () => ({
      status: 'DIVERGENCIA' as const,
      severity: 'CRITICA' as const,
    }));
    expect(computeScore(many).score).toBe(0);
  });

  it('não penaliza regras não verificadas ou não aplicáveis', () => {
    const result = computeScore([
      { status: 'NAO_VERIFICADO', severity: 'ALTA' },
      { status: 'NAO_APLICAVEL', severity: 'CRITICA' },
    ]);
    expect(result.score).toBe(100);
  });

  it('classifica as faixas', () => {
    expect(bandFor(100)).toBe('EXCELENTE');
    expect(bandFor(90)).toBe('EXCELENTE');
    expect(bandFor(80)).toBe('BOM');
    expect(bandFor(60)).toBe('ATENCAO');
    expect(bandFor(10)).toBe('CRITICO');
  });
});

describe('composição explícita da receita', () => {
  it('inclui apenas o que a política classifica e exclui documento sem efeito fiscal', async () => {
    const dataset = await datasetFrom([
      textFile('a.xml', buildNfeXml(sale(1, 1000))),
      textFile('b.xml', buildNfeXml(sale(2, 500))),
      textFile('c.xml', buildNfeXml(sale(3, 250, { cancelada: true }))),
    ]);

    const composition = composeRevenue(xmlInvoices(dataset), FULL_POLICY);
    expect(composition.includedAmount).toBe(150000);
    expect(composition.included).toHaveLength(2);
    expect(composition.excluded).toHaveLength(1);
    expect(composition.excludedAmount).toBe(25000);
    expect(composition.review).toHaveLength(0);
    expect(composition.hasPendingReview).toBe(false);
    expect(composition.excluded[0]?.reason).toContain('cancelada');
  });

  it('coloca em revisão o CFOP sem classificação, sem somar nem esconder', async () => {
    const dataset = await datasetFrom([
      textFile('a.xml', buildNfeXml(sale(11, 1000))),
      textFile('b.xml', buildNfeXml(sale(12, 400))),
    ]);

    const composition = composeRevenue(xmlInvoices(dataset), cfopPolicy({}));
    expect(composition.includedAmount).toBe(0);
    expect(composition.review).toHaveLength(2);
    expect(composition.reviewAmount).toBe(140000);
    expect(composition.hasPendingReview).toBe(true);
    expect(composition.review[0]?.reason).toContain('não classificado');
  });

  it('registra o motivo e a origem de cada documento da composição', async () => {
    const dataset = await datasetFrom([textFile('a.xml', buildNfeXml(sale(13, 700)))]);
    const composition = composeRevenue(xmlInvoices(dataset), FULL_POLICY);
    const entry = composition.included[0];
    expect(entry?.cfop).toBe('5102');
    expect(entry?.amount).toBe(70000);
    expect(entry?.origin.fileName).toBe('a.xml');
    expect(entry?.origin.recordCode).toBe('infNFe');
  });

  it('exclui os CFOPs configurados e informa a composição', async () => {
    const dataset = await datasetFrom([
      textFile('a.xml', buildNfeXml(sale(4, 1000))),
      textFile(
        'b.xml',
        buildNfeXml(
          sale(5, 400, {
            items: [
              {
                codigo: 'P2',
                descricao: 'DEVOLUCAO',
                ncm: '84713012',
                cfop: '5202',
                cst: '00',
                unidade: 'UN',
                quantidade: 1,
                valorUnitario: 400,
                aliquotaIcms: 18,
              },
            ],
          }),
        ),
      ),
    ]);

    const composition = composeRevenue(xmlInvoices(dataset), FULL_POLICY);
    expect(composition.includedAmount).toBe(100000);
    expect(composition.excluded).toHaveLength(1);
    expect(composition.excluded[0]?.cfop).toBe('5202');
    expect(composition.cfopBreakdown[0]?.cfop).toBe('5102');
  });
});

describe('regras ATT-FIS (XML x EFD ICMS/IPI)', () => {
  const specs = [sale(101, 1000), sale(102, 2000), sale(103, 3000)];

  function efdFile(
    documents: { spec: NfeSpec; override?: Record<string, unknown> }[],
  ): FixtureFile {
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

  it('ATT-FIS-001: acusa XML sem escrituração e traz a chave como evidência', async () => {
    const dataset = await datasetFrom([
      ...specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec))),
      // O terceiro documento nao e escriturado.
      efdFile(specs.slice(0, 2).map((spec) => ({ spec }))),
    ]);

    const { findings } = runAudit(dataset, ORG);
    const fis001 = findingsByRule(findings, 'ATT-FIS-001');
    expect(fis001).toHaveLength(1);
    expect(fis001[0]?.status).toBe('DIVERGENCIA');
    expect(fis001[0]?.nature).toBe('FATO');
    expect(fis001[0]?.documentRef).toBe(nfeAccessKey(specs[2]!));
    expect(fis001[0]?.humanReviewNote).toBeTruthy();
    expect(fis001[0]?.evidence.map((item) => item.label)).toContain('Chave de acesso');
  });

  it('ATT-FIS-002: acusa documento escriturado sem XML de origem', async () => {
    const dataset = await datasetFrom([
      textFile('nfe-0.xml', buildNfeXml(specs[0]!)),
      efdFile(specs.map((spec) => ({ spec }))),
    ]);

    const { findings } = runAudit(dataset, ORG);
    const fis002 = findingsByRule(findings, 'ATT-FIS-002');
    expect(fis002).toHaveLength(2);
    expect(fis002[0]?.status).toBe('DIVERGENCIA');
  });

  it('ATT-FIS-003: acusa valor total divergente entre XML e C100', async () => {
    const totals = computeNfeTotals(specs[0]!);
    const dataset = await datasetFrom([
      ...specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec))),
      efdFile([
        { spec: specs[0]!, override: { valorDocumento: totals.total - 250.2 } },
        { spec: specs[1]! },
        { spec: specs[2]! },
      ]),
    ]);

    const { findings } = runAudit(dataset, ORG);
    const fis003 = findingsByRule(findings, 'ATT-FIS-003');
    expect(fis003).toHaveLength(1);
    expect(fis003[0]?.difference).toBe(25020);
    expect(fis003[0]?.originValue).toBe(Math.round(totals.total * 100));
  });

  it('ATT-FIS-004 e ATT-FIS-005: acusam base e valor de ICMS divergentes', async () => {
    const totals = computeNfeTotals(specs[0]!);
    const dataset = await datasetFrom([
      ...specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec))),
      efdFile([
        { spec: specs[0]!, override: { baseIcms: totals.baseIcms - 100, icms: totals.icms - 18 } },
        { spec: specs[1]! },
        { spec: specs[2]! },
      ]),
    ]);

    const { findings } = runAudit(dataset, ORG);
    expect(findingsByRule(findings, 'ATT-FIS-004')).toHaveLength(1);
    expect(findingsByRule(findings, 'ATT-FIS-005')).toHaveLength(1);
    expect(findingsByRule(findings, 'ATT-FIS-005')[0]?.difference).toBe(1800);
  });

  it('ATT-FIS-006: acusa CFOP divergente', async () => {
    const dataset = await datasetFrom([
      ...specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec))),
      efdFile([
        { spec: specs[0]!, override: { cfop: '5405' } },
        { spec: specs[1]! },
        { spec: specs[2]! },
      ]),
    ]);

    const { findings } = runAudit(dataset, ORG);
    const fis006 = findingsByRule(findings, 'ATT-FIS-006');
    expect(fis006).toHaveLength(1);
    expect(fis006[0]?.description).toContain('5405');
  });

  it('ATT-FIS-007: acusa quantidade de documentos diferente', async () => {
    const dataset = await datasetFrom([
      ...specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec))),
      efdFile(specs.slice(0, 2).map((spec) => ({ spec }))),
    ]);

    const { findings } = runAudit(dataset, ORG);
    const fis007 = findingsByRule(findings, 'ATT-FIS-007');
    expect(fis007).toHaveLength(1);
    expect(fis007[0]?.status).toBe('ALERTA');
    expect(fis007[0]?.description).toContain('3');
  });

  it('não aponta divergência quando XML e EFD conferem', async () => {
    const dataset = await datasetFrom([
      ...specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec))),
      efdFile(specs.map((spec) => ({ spec }))),
    ]);

    const { findings, summary } = runAudit(dataset, ORG);
    const fiscal = findings.filter(
      (finding) => finding.ruleCode.startsWith('ATT-FIS') && finding.status === 'DIVERGENCIA',
    );
    expect(fiscal).toHaveLength(0);
    expect(summary.cruzamentosCorretos).toBeGreaterThan(0);
  });

  it('reporta NÃO_VERIFICADO quando a EFD não foi importada', async () => {
    const dataset = await datasetFrom([textFile('nfe.xml', buildNfeXml(specs[0]!))]);
    const { findings } = runAudit(dataset, ORG);
    const fis001 = findingsByRule(findings, 'ATT-FIS-001');
    expect(fis001[0]?.status).toBe('NAO_VERIFICADO');
    expect(fis001[0]?.severity).toBe('INFO');
  });
});

describe('regras ATT-FAT (faturamento)', () => {
  const specs = [sale(201, 100000), sale(202, 200000)];
  const WITH_POLICY = { ...ORG, revenuePolicy: FULL_POLICY };

  function pgdasdFile(receita: number): FixtureFile {
    return {
      name: 'PGDAS_082026.pdf',
      bytes: buildTextPdf(
        buildPgdasdText({
          competenciaLabel: '08/2026',
          receitaBruta: receita,
          rbt12: receita * 12,
          valorDevido: receita * 0.06,
        }),
      ),
    };
  }

  it('ATT-FAT-001: compara documentos fiscais com a receita do PGDAS-D e mostra a origem', async () => {
    const dataset = await datasetFrom([
      ...specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec))),
      pgdasdFile(280000),
    ]);

    const { findings } = runAudit(dataset, WITH_POLICY);
    const fat001 = findingsByRule(findings, 'ATT-FAT-001');
    expect(fat001).toHaveLength(1);
    expect(fat001[0]?.status).toBe('DIVERGENCIA');
    expect(fat001[0]?.nature).toBe('INDICIO');
    expect(fat001[0]?.originValue).toBe(30000000);
    expect(fat001[0]?.targetValue).toBe(28000000);
    expect(fat001[0]?.difference).toBe(2000000);
    expect(fat001[0]?.severity).toBe('CRITICA');

    const origin = fat001[0]?.evidence[0];
    expect(origin?.origin).toContain('2 documentos XML incluídos na receita');
    const target = fat001[0]?.evidence[1];
    expect(target?.origin).toContain('Receita Bruta do PA');
    expect(target?.origin).toContain('PGDAS_082026.pdf');

    const composicao = fat001[0]?.evidence.find((item) => item.label.startsWith('Composição'));
    expect(composicao?.value).toContain('2 incluídos');
  });

  it('ATT-FAT-001: não aponta divergência quando os valores conferem', async () => {
    const dataset = await datasetFrom([
      ...specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec))),
      pgdasdFile(300000),
    ]);

    const { findings } = runAudit(dataset, WITH_POLICY);
    expect(findingsByRule(findings, 'ATT-FAT-001')).toHaveLength(0);
  });

  it('não conclui enquanto houver CFOP aguardando classificação', async () => {
    const dataset = await datasetFrom([
      ...specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec))),
      pgdasdFile(280000),
    ]);

    // Sem política configurada, os documentos ficam em revisão.
    const { findings } = runAudit(dataset, ORG);
    const fat001 = findingsByRule(findings, 'ATT-FAT-001')[0];
    expect(fat001?.status).toBe('NAO_VERIFICADO');
    expect(fat001?.description).toContain('aguardam classificação de CFOP');
    expect(fat001?.severity).toBe('INFO');
  });

  it('ATT-FAT-002: compara a EFD ICMS/IPI com o PGDAS-D', async () => {
    const dataset = await datasetFrom([
      textFile(
        'efd.txt',
        buildEfdIcmsTxt({
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          documents: specs.map((spec) => ({ spec })),
          icmsARecolher: 54000,
        }),
        'latin1',
      ),
      pgdasdFile(250000),
    ]);

    const { findings } = runAudit(dataset, WITH_POLICY);
    const fat002 = findingsByRule(findings, 'ATT-FAT-002');
    expect(fat002).toHaveLength(1);
    expect(fat002[0]?.difference).toBe(5000000);
    expect(fat002[0]?.evidence[0]?.recordCode).toBe('C100');
  });

  it('ATT-FAT-003 e ATT-FAT-004: comparam a EFD-Contribuições', async () => {
    const dataset = await datasetFrom([
      ...specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec))),
      textFile(
        'contrib.txt',
        buildEfdContribTxt({
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          documents: specs,
          pisApurado: 4950,
          cofinsApurada: 22800,
          outrasReceitas: 10000,
        }),
        'latin1',
      ),
      pgdasdFile(300000),
    ]);

    const { findings } = runAudit(dataset, WITH_POLICY);
    // Receita da EFD-Contribuições = documentos (300.000) + F100 (10.000).
    expect(findingsByRule(findings, 'ATT-FAT-003')[0]?.originValue).toBe(31000000);
    expect(findingsByRule(findings, 'ATT-FAT-004')[0]?.difference).toBe(-1000000);
  });

  it('reporta NAO_VERIFICADO quando o PGDAS-D não foi importado', async () => {
    const dataset = await datasetFrom([textFile('nfe.xml', buildNfeXml(specs[0]!))]);
    const { findings } = runAudit(dataset, WITH_POLICY);
    const fat001 = findingsByRule(findings, 'ATT-FAT-001')[0];
    expect(fat001?.status).toBe('NAO_VERIFICADO');
    expect(fat001?.description).toContain('Nenhum PGDAS-D foi importado');
  });
});

describe('regras ATT-PIS e ATT-COF', () => {
  const specs = [sale(301, 100000)];
  const contrib = textFile(
    'contrib.txt',
    buildEfdContribTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: specs,
      pisApurado: 1000,
      cofinsApurada: 5000,
    }),
    'latin1',
  );

  it('não se aplica a empresa do Simples Nacional e explica o motivo', async () => {
    const dataset = await datasetFrom([contrib], { taxRegime: 'SIMPLES_NACIONAL' });
    const { findings } = runAudit(dataset, ORG);

    const pis = findingsByRule(findings, 'ATT-PIS-001')[0];
    expect(pis?.status).toBe('NAO_APLICAVEL');
    expect(pis?.description).toContain('Lei Complementar 123/2006');
    expect(findingsByRule(findings, 'ATT-COF-001')[0]?.status).toBe('NAO_APLICAVEL');
  });

  it('compara com a contribuição apurada no período quando aplicável', async () => {
    const dataset = await datasetFrom([contrib], { taxRegime: 'LUCRO_PRESUMIDO' });
    const { findings } = runAudit(dataset, ORG);

    const pis = findingsByRule(findings, 'ATT-PIS-001')[0];
    expect(pis?.status).toBe('DIVERGENCIA');
    expect(pis?.nature).toBe('INDICIO');
    // PIS somado dos documentos: 1,65% de 100.000,00 = 1.650,00; apurado: 1.000,00.
    expect(pis?.originValue).toBe(165000);
    expect(pis?.targetValue).toBe(100000);
    expect(pis?.evidence[1]?.origin).toContain('VL_TOT_CONT_NC_PER');
  });
});

describe('motor de auditoria', () => {
  it('isola falha de uma regra sem interromper as demais', () => {
    const brokenRule = {
      ...AUDIT_RULES[0]!,
      codigo: 'ATT-TESTE-999',
      executar: () => {
        throw new Error('falha proposital');
      },
    };

    const dataset = {
      company: { taxRegime: 'LUCRO_REAL' },
      competencia: '2026-08',
      invoices: [],
      revenues: [],
      taxes: [],
      declarations: [],
      participants: [],
      files: [],
      availableSources: new Set<never>(),
    };

    const result = runAudit(dataset as never, {
      ...ORG,
      rules: [brokenRule, AUDIT_RULES[0]!],
    });

    const broken = findingsByRule(result.findings, 'ATT-TESTE-999')[0];
    expect(broken?.status).toBe('NAO_VERIFICADO');
    expect(broken?.evidence[0]?.value).toContain('falha proposital');
    expect(result.findings.length).toBeGreaterThan(1);
  });

  it('respeita a desativacao de uma regra', async () => {
    const dataset = await datasetFrom([textFile('nfe.xml', buildNfeXml(sale(401)))]);
    const settings = new Map([
      [
        'ATT-FIS-001',
        {
          id: 's1',
          organizationId: 'org-1',
          ruleCode: 'ATT-FIS-001',
          enabled: false,
          severity: null,
          absoluteToleranceCents: null,
          percentageTolerance: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]);

    const { findings } = runAudit(dataset, { ...ORG, settings });
    expect(findingsByRule(findings, 'ATT-FIS-001')).toHaveLength(0);
  });

  it('aplica a tolerância configurada por regra', async () => {
    const spec = sale(501, 1000);
    const totals = computeNfeTotals(spec);
    const files = [
      textFile('nfe.xml', buildNfeXml(spec)),
      textFile(
        'efd.txt',
        buildEfdIcmsTxt({
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          documents: [{ spec, override: { valorDocumento: totals.total - 0.5 } }],
          icmsARecolher: 180,
        }),
        'latin1',
      ),
    ];
    const dataset = await datasetFrom(files);

    const strict = runAudit(dataset, ORG);
    expect(findingsByRule(strict.findings, 'ATT-FIS-003')).toHaveLength(1);

    const tolerant = runAudit(dataset, {
      ...ORG,
      settings: new Map([
        [
          'ATT-FIS-003',
          {
            id: 's2',
            organizationId: 'org-1',
            ruleCode: 'ATT-FIS-003',
            enabled: true,
            severity: null,
            absoluteToleranceCents: 100,
            percentageTolerance: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      ]),
    });
    expect(findingsByRule(tolerant.findings, 'ATT-FIS-003')).toHaveLength(0);
  });

  it('todas as regras declaram código, módulo, documentos e limitações', () => {
    for (const rule of AUDIT_RULES) {
      expect(rule.codigo).toMatch(/^ATT-[A-Z]{3}-\d{3}$/);
      expect(rule.nome.length).toBeGreaterThan(10);
      expect(rule.descricao.length).toBeGreaterThan(20);
      expect(rule.limitacoes.length).toBeGreaterThan(40);
      expect(rule.documentosNecessarios.length).toBeGreaterThan(0);
    }
    const codes = AUDIT_RULES.map((rule) => rule.codigo);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(
      expect.arrayContaining([
        'ATT-FIS-001', 'ATT-FIS-002', 'ATT-FIS-003', 'ATT-FIS-004', 'ATT-FIS-005',
        'ATT-FIS-006', 'ATT-FIS-007', 'ATT-FAT-001', 'ATT-FAT-002', 'ATT-FAT-003',
        'ATT-FAT-004', 'ATT-PIS-001', 'ATT-COF-001',
      ]),
    );
  });
});
