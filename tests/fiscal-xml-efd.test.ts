/**
 * Cruzamento XML de NF-e/NFC-e × EFD ICMS/IPI (fase 3).
 *
 * Os cenários aqui não verificam apenas que uma divergência é acusada: verificam
 * que ela NÃO é acusada onde a comparação não é válida. Um sistema que aponta
 * diferença em toda entrada, porque confronta o destaque do emitente com o
 * crédito do destinatário, produz ruído e destrói a confiança no resultado.
 */

import { describe, expect, it } from 'vitest';
import { runAudit } from '@/lib/audit-engine';
import { reconcile } from '@/lib/audit-engine/reconciliation';
import { attFis004 } from '@/lib/audit-engine/rules/fiscal';
import type { AuditFinding } from '@/lib/domain/entities';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  DEMO_SUPPLIER,
  buildEfdIcmsTxt,
  buildNfeXml,
  computeNfeTotals,
  nfeAccessKey,
  type NfeSpec,
} from '@/lib/demo/fixtures';
import { datasetFrom, textFile, type FixtureFile } from './helpers/dataset';

const ORG = { organizationId: 'org-1', auditId: 'audit-1' };

function item(cfop: string, valorUnitario: number) {
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

/** NF-e emitida pela empresa auditada. */
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
    items: [item('5102', 1000)],
    ...overrides,
  };
}

/** NF-e emitida por fornecedor contra a empresa auditada. */
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
    items: [item('6102', 1000)],
    ...overrides,
  };
}

interface EfdEntry {
  spec: NfeSpec;
  override?: Record<string, unknown>;
}

function efdFile(documents: EfdEntry[], name = 'efd-icms.txt'): FixtureFile {
  return textFile(
    name,
    buildEfdIcmsTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: documents as never,
      icmsARecolher: 1080,
    }),
    'latin1',
  );
}

function xmlFiles(specs: readonly NfeSpec[]): FixtureFile[] {
  return specs.map((spec, index) => textFile(`nfe-${index}.xml`, buildNfeXml(spec)));
}

function byRule(findings: readonly AuditFinding[], codigo: string): AuditFinding[] {
  return findings.filter((finding) => finding.ruleCode === codigo);
}

describe('escopo do cruzamento: entrada de terceiro', () => {
  // O fornecedor destaca ICMS de 18%; a empresa escritura crédito zero, o que é
  // legítimo em operação sem direito a crédito.
  const spec = entrada(201);
  const totals = computeNfeTotals(spec);

  async function dataset() {
    return datasetFrom([
      ...xmlFiles([spec]),
      efdFile([{ spec, override: { baseIcms: 0, icms: 0 } }]),
    ]);
  }

  it('ATT-FIS-004 não acusa divergência de base de ICMS em entrada', async () => {
    const { findings } = runAudit(await dataset(), ORG);
    const fis004 = byRule(findings, 'ATT-FIS-004');

    expect(fis004.filter((finding) => finding.status === 'DIVERGENCIA')).toHaveLength(0);
    expect(fis004.map((finding) => finding.status)).toContain('NAO_APLICAVEL');
    expect(fis004[0]?.title).toContain('fora do escopo');
  });

  it('ATT-FIS-005 não acusa divergência de ICMS em entrada e diz por quê', async () => {
    const { findings } = runAudit(await dataset(), ORG);
    const fis005 = byRule(findings, 'ATT-FIS-005');
    const naoAplicavel = fis005.find((finding) => finding.status === 'NAO_APLICAVEL');

    expect(fis005.filter((finding) => finding.status === 'DIVERGENCIA')).toHaveLength(0);
    expect(naoAplicavel).toBeDefined();
    expect(naoAplicavel?.description).toContain('crédito');
    expect(naoAplicavel?.humanReviewNote).toBeTruthy();
  });

  it('ATT-FIS-006 não compara CFOP de entrada, porque a ótica é outra', async () => {
    // Saída 6102 no emitente, entrada 2102 no destinatário: divergiria sempre.
    const dados = await datasetFrom([
      ...xmlFiles([spec]),
      efdFile([{ spec, override: { cfop: '2102' } }]),
    ]);

    const fis006 = byRule(runAudit(dados, ORG).findings, 'ATT-FIS-006');
    expect(fis006.filter((finding) => finding.status === 'DIVERGENCIA')).toHaveLength(0);
    expect(fis006.map((finding) => finding.status)).toContain('NAO_APLICAVEL');
  });

  it('ATT-FIS-003 continua comparando o total, que não muda com o declarante', async () => {
    const dados = await datasetFrom([
      ...xmlFiles([spec]),
      efdFile([{ spec, override: { valorDocumento: totals.total - 100 } }]),
    ]);

    const fis003 = byRule(runAudit(dados, ORG).findings, 'ATT-FIS-003');
    expect(fis003.filter((finding) => finding.status === 'DIVERGENCIA')).toHaveLength(1);
    expect(fis003[0]?.difference).toBe(10000);
  });
});

describe('ressalvas: documento complementar', () => {
  it('rebaixa a diferença a indício e registra o campo que a justifica', async () => {
    const spec = saida(301, { finNFe: '2' });
    const totals = computeNfeTotals(spec);
    const dados = await datasetFrom([
      ...xmlFiles([spec]),
      efdFile([{ spec, override: { codSit: '06', valorDocumento: totals.total - 400 } }]),
    ]);

    const fis003 = byRule(runAudit(dados, ORG).findings, 'ATT-FIS-003');
    expect(fis003).toHaveLength(1);
    expect(fis003[0]?.status).toBe('ALERTA');
    expect(fis003[0]?.nature).toBe('INDICIO');
    // A diferença continua visível: a ressalva qualifica, não esconde.
    expect(fis003[0]?.difference).toBe(40000);

    // A ressalva é citada dos dois lados: o campo do XML e o campo da EFD.
    const ressalvas = fis003[0]?.evidence.filter((item) => item.label.startsWith('Ressalva')) ?? [];
    expect(ressalvas.map((item) => item.fieldName).sort()).toEqual(['COD_SIT', 'finNFe']);
    expect(ressalvas.find((item) => item.fieldName === 'COD_SIT')?.value).toBe('COD_SIT = 06');
    expect(ressalvas.find((item) => item.fieldName === 'finNFe')?.value).toBe('finNFe = 2');
    expect(ressalvas.find((item) => item.fieldName === 'COD_SIT')?.lineNumber).toBeGreaterThan(0);
  });

  it('sem ressalva, a mesma diferença é divergência e fato', async () => {
    const spec = saida(302);
    const totals = computeNfeTotals(spec);
    const dados = await datasetFrom([
      ...xmlFiles([spec]),
      efdFile([{ spec, override: { valorDocumento: totals.total - 400 } }]),
    ]);

    const fis003 = byRule(runAudit(dados, ORG).findings, 'ATT-FIS-003');
    expect(fis003).toHaveLength(1);
    expect(fis003[0]?.status).toBe('DIVERGENCIA');
    expect(fis003[0]?.nature).toBe('FATO');
  });
});

describe('integridade da escrituração', () => {
  it('ATT-FIS-002 acusa a mesma chave escriturada duas vezes, com as duas linhas', async () => {
    const spec = saida(401);
    const dados = await datasetFrom([
      ...xmlFiles([spec]),
      efdFile([{ spec, override: { duplicado: true } }]),
    ]);

    const duplicidade = byRule(runAudit(dados, ORG).findings, 'ATT-FIS-002').find((finding) =>
      finding.title.includes('mais de uma vez'),
    );

    expect(duplicidade).toBeDefined();
    expect(duplicidade?.status).toBe('DIVERGENCIA');
    expect(duplicidade?.documentRef).toBe(nfeAccessKey(spec));

    const ocorrencias = duplicidade?.evidence.filter((item) => item.label.startsWith('Ocorrência')) ?? [];
    expect(ocorrencias).toHaveLength(2);
    expect(ocorrencias[0]?.lineNumber).not.toBe(ocorrencias[1]?.lineNumber);
    expect(ocorrencias.every((item) => item.recordCode === 'C100')).toBe(true);
  });

  it('ATT-FIS-002 agrupa entradas sem XML em vez de acusar uma divergência por documento', async () => {
    const entradas = [entrada(501), entrada(502), entrada(503)];
    const dados = await datasetFrom([efdFile(entradas.map((spec) => ({ spec }))), ...xmlFiles([saida(504)])]);

    const fis002 = byRule(runAudit(dados, ORG).findings, 'ATT-FIS-002');
    const agrupado = fis002.find((finding) => finding.title.includes('Entradas escrituradas'));

    expect(agrupado).toBeDefined();
    expect(agrupado?.status).toBe('ALERTA');
    expect(agrupado?.nature).toBe('INDICIO');
    expect(agrupado?.evidence.find((item) => item.label === 'Documentos abrangidos')?.value).toBe('3');
    expect(fis002.filter((finding) => finding.status === 'DIVERGENCIA')).toHaveLength(0);
  });
});

describe('NFC-e sem escrituração documento a documento', () => {
  it('ATT-FIS-001 reporta não verificado quando a EFD não escritura modelo 65', async () => {
    const nfce = saida(601, {
      modelo: '65',
      destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: 'CONSUMIDOR', uf: 'SP' },
    });
    const nfe = saida(602);

    const dados = await datasetFrom([...xmlFiles([nfce, nfe]), efdFile([{ spec: nfe }])]);
    const fis001 = byRule(runAudit(dados, ORG).findings, 'ATT-FIS-001');

    expect(fis001.filter((finding) => finding.status === 'DIVERGENCIA')).toHaveLength(0);
    const naoVerificado = fis001.find((finding) => finding.status === 'NAO_VERIFICADO');
    expect(naoVerificado?.title).toContain('modelo 65');
    expect(naoVerificado?.humanReviewNote).toBeTruthy();
  });

  it('havendo modelo 65 na EFD, a NFC-e ausente volta a ser divergência', async () => {
    const nfce = saida(611, {
      modelo: '65',
      destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: 'CONSUMIDOR', uf: 'SP' },
    });
    const outraNfce = saida(612, {
      modelo: '65',
      destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: 'CONSUMIDOR', uf: 'SP' },
    });

    const dados = await datasetFrom([...xmlFiles([nfce, outraNfce]), efdFile([{ spec: outraNfce }])]);
    const fis001 = byRule(runAudit(dados, ORG).findings, 'ATT-FIS-001');

    expect(fis001.filter((finding) => finding.status === 'DIVERGENCIA')).toHaveLength(1);
    expect(fis001[0]?.documentRef).toBe(nfeAccessKey(nfce));
  });
});

describe('ATT-FIS-006 sem CFOP', () => {
  it('reporta não verificado em vez de ignorar o documento em silêncio', async () => {
    const spec = saida(701);
    const dados = await datasetFrom([
      ...xmlFiles([spec]),
      efdFile([{ spec, override: { semCfop: true } }]),
    ]);

    const fis006 = byRule(runAudit(dados, ORG).findings, 'ATT-FIS-006');
    const naoVerificado = fis006.find((finding) => finding.status === 'NAO_VERIFICADO');

    expect(naoVerificado).toBeDefined();
    expect(naoVerificado?.description).toContain('CFOP predominante');
    expect(naoVerificado?.evidence.find((item) => item.label === 'Documentos abrangidos')?.value).toBe('1');
  });
});

describe('rastreabilidade da ocorrência', () => {
  it('leva arquivo, registro, linha, campo, valor, regra, versão e tolerância', async () => {
    const spec = saida(801);
    const totals = computeNfeTotals(spec);
    const dados = await datasetFrom([
      ...xmlFiles([spec]),
      efdFile([{ spec, override: { valorDocumento: totals.total - 500 } }]),
    ]);

    const finding = byRule(runAudit(dados, ORG).findings, 'ATT-FIS-003')[0];
    expect(finding).toBeDefined();
    expect(finding?.ruleCode).toBe('ATT-FIS-003');
    expect(finding?.ruleVersion).toBe('2.0.0');

    const chave = finding?.evidence.find((item) => item.label === 'Chave de acesso');
    expect(chave?.value).toBe(nfeAccessKey(spec));

    const origem = finding?.evidence.find((item) => item.label === 'Valor total no XML');
    expect(origem?.fieldName).toBe('total/ICMSTot/vNF');
    expect(origem?.fileName).toBe('nfe-0.xml');
    expect(origem?.recordCode).toBe('infNFe');
    expect(origem?.parserVersion).toBeTruthy();

    const destino = finding?.evidence.find((item) => item.label === 'Valor escriturado (VL_DOC)');
    expect(destino?.fieldName).toBe('VL_DOC');
    expect(destino?.fileName).toBe('efd-icms.txt');
    expect(destino?.recordCode).toBe('C100');
    expect(destino?.lineNumber).toBeGreaterThan(0);
    expect(destino?.parserVersion).toBeTruthy();

    const tolerancia = finding?.evidence.find((item) => item.label === 'Tolerância aplicada');
    expect(tolerancia?.value).toContain('Tolerância');

    const escopo = finding?.evidence.find((item) => item.label === 'Escopo do cruzamento');
    expect(escopo?.value).toBe('Saída própria');
  });
});

describe('pareamento único', () => {
  it('a reconciliação é calculada uma vez e reaproveitada pelas regras', async () => {
    const dados = await datasetFrom([
      ...xmlFiles([saida(901)]),
      efdFile([{ spec: saida(901) }]),
    ]);

    expect(reconcile(dados)).toBe(reconcile(dados));
    expect(reconcile(dados).pairs).toHaveLength(1);
  });

  it('a regra declara a própria versão, independente da versão da aplicação', () => {
    expect(attFis004.versao).toBe('2.0.0');
    expect(attFis004.limitacoes).toContain('saídas próprias');
  });
});
