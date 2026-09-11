import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { assertProductionSecurity } from '@/lib/config/env';
import { buildCsv, csvMoney } from '@/lib/reports/csv';
import { parseFile } from '@/lib/parsers';
import { runAudit } from '@/lib/audit-engine';
import { policyFromRules } from '@/lib/audit-engine/revenue-composition';
import { summariseSped } from '@/lib/parsers/sped/inspect';
import { cents } from '@/lib/core/money';
import type { CfopRule } from '@/lib/domain/entities';
import { buildTextPdf } from '@/lib/demo/pdf-writer';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  buildEfdIcmsTxt,
  buildNfeXml,
  buildPgdasdText,
  type NfeSpec,
} from '@/lib/demo/fixtures';
import { datasetFrom, textFile, type FixtureFile } from './helpers/dataset';

function sale(numero: number, valorUnitario = 1000): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-09',
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
  };
}

const INCLUDE_5102 = policyFromRules([
  {
    id: 'r1',
    organizationId: 'org-1',
    cfop: '5102',
    description: null,
    treatment: 'INCLUIR',
    reason: null,
    ruleSource: 'CONFIGURADO',
    updatedBy: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  } satisfies CfopRule,
]);

describe('segurança de produção', () => {
  const production = { mode: 'local' as const };

  it('não interfere fora de produção', () => {
    expect(() =>
      assertProductionSecurity({ ...production, authSecret: null, localPassword: null }),
    ).not.toThrow();
  });

  it('recusa segredo padrão e senha de demonstração em produção', () => {
    const original = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true,
      writable: true,
      enumerable: true,
    });
    try {
      expect(() =>
        assertProductionSecurity({ ...production, authSecret: null, localPassword: null }),
      ).toThrow(/ATTIVARE_AUTH_SECRET/);

      expect(() =>
        assertProductionSecurity({
          ...production,
          authSecret: 'attivare-desenvolvimento-local',
          localPassword: 'senha-propria-longa',
        }),
      ).toThrow(/ATTIVARE_AUTH_SECRET/);

      expect(() =>
        assertProductionSecurity({
          ...production,
          authSecret: 'x'.repeat(40),
          localPassword: 'attivare',
        }),
      ).toThrow(/ATTIVARE_AUTH_PASSWORD/);

      expect(() =>
        assertProductionSecurity({ ...production, authSecret: 'curto', localPassword: 'outra' }),
      ).toThrow(/ao menos 32/);

      // Configuração adequada passa.
      expect(() =>
        assertProductionSecurity({
          ...production,
          authSecret: 'x'.repeat(40),
          localPassword: 'senha-propria-longa',
        }),
      ).not.toThrow();

      // No modo Supabase a autenticação é do Supabase Auth.
      expect(() =>
        assertProductionSecurity({ mode: 'supabase', authSecret: null, localPassword: null }),
      ).not.toThrow();

      // A compilação não é uma inicialização: a máquina de build não tem o
      // segredo da instalação e não deve precisar dele.
      expect(() =>
        assertProductionSecurity({
          ...production,
          authSecret: null,
          localPassword: null,
          phase: 'phase-production-build',
        }),
      ).not.toThrow();

      // Qualquer outra fase continua sujeita à trava.
      expect(() =>
        assertProductionSecurity({
          ...production,
          authSecret: null,
          localPassword: null,
          phase: 'phase-production-server',
        }),
      ).toThrow(/ATTIVARE_AUTH_SECRET/);
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: original,
        configurable: true,
        writable: true,
        enumerable: true,
      });
    }
  });
});

describe('exportação em CSV', () => {
  it('usa ponto e vírgula, BOM e vírgula decimal', () => {
    const csv = buildCsv(['Campo', 'Valor'], [['Receita', csvMoney(cents(48723042))]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Campo;Valor');
    expect(csv).toContain('Receita;487230,42');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('protege células com separador, aspas ou quebra de linha', () => {
    const csv = buildCsv(['A'], [['tem ; ponto e vírgula'], ['tem "aspas"'], [null]]);
    expect(csv).toContain('"tem ; ponto e vírgula"');
    expect(csv).toContain('"tem ""aspas"""');
    expect(csv).toContain('\r\n\r\n');
  });
});

describe('arquivos parcialmente válidos', () => {
  it('processa o que é legível e reporta o que não é, sem abortar o lote', async () => {
    const archive = zipSync({
      'ok-1.xml': new Uint8Array(Buffer.from(buildNfeXml(sale(8001)), 'utf8')),
      'ok-2.xml': new Uint8Array(Buffer.from(buildNfeXml(sale(8002)), 'utf8')),
      'quebrado.xml': new Uint8Array(Buffer.from('<<< nao e xml', 'utf8')),
      'outro-tipo.txt': new Uint8Array(Buffer.from('ignorado', 'utf8')),
    });

    const result = await parseFile(archive, 'lote.zip', 'f1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.invoices).toHaveLength(2);
    expect(result.value.stats.invalid).toBe(1);
    expect(result.value.stats.ignored).toBe(1);
    expect(result.value.log.warnings.some((w) => w.message.includes('quebrado.xml'))).toBe(true);
  });

  it('lê um SPED com linha corrompida sem perder os demais registros', async () => {
    const content = buildEfdIcmsTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: [{ spec: sale(8101) }, { spec: sale(8102) }],
      icmsARecolher: 360,
    });
    // Uma linha truncada no meio do arquivo.
    const corrupted = content.replace('|C170|1|PROD001|', '|C170|1|');

    const result = await parseFile(
      new Uint8Array(Buffer.from(corrupted, 'latin1')),
      'efd.txt',
      'f2',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.invoices).toHaveLength(2);
    const summary = summariseSped(corrupted, 'EFD_ICMS_IPI');
    expect(summary.registers.find((entry) => entry.code === 'C100')?.count).toBe(2);
  });
});

describe('bloqueio de resultado enganoso', () => {
  function pgdasd(lines: readonly string[]): FixtureFile {
    return { name: 'PGDAS.pdf', bytes: buildTextPdf(lines) };
  }

  it('não conclui quando a receita do PGDAS-D não foi identificada', async () => {
    const dataset = await datasetFrom([
      textFile('nfe.xml', buildNfeXml(sale(8201, 1000))),
      pgdasd([
        'SIMPLES NACIONAL',
        'EXTRATO DO SIMPLES NACIONAL - PGDAS-D',
        'Periodo de Apuracao (PA): 08/2026',
      ]),
    ]);

    const { findings } = runAudit(dataset, {
      organizationId: 'org-1',
      auditId: 'audit-1',
      revenuePolicy: INCLUDE_5102,
    });

    const fat001 = findings.find((finding) => finding.ruleCode === 'ATT-FAT-001');
    expect(fat001?.status).toBe('NAO_VERIFICADO');
    expect(fat001?.description).toContain('não foi identificada');
    expect(fat001?.severity).toBe('INFO');
  });

  it('conclui quando a receita foi identificada com confiança alta', async () => {
    const dataset = await datasetFrom([
      textFile('nfe.xml', buildNfeXml(sale(8301, 1000))),
      pgdasd(
        buildPgdasdText({
          competenciaLabel: '08/2026',
          receitaBruta: 900,
          rbt12: 12000,
          valorDevido: 60,
        }),
      ),
    ]);

    const { findings } = runAudit(dataset, {
      organizationId: 'org-1',
      auditId: 'audit-1',
      revenuePolicy: INCLUDE_5102,
    });

    const fat001 = findings.find((finding) => finding.ruleCode === 'ATT-FAT-001');
    expect(fat001?.status).toBe('DIVERGENCIA');
    expect(fat001?.difference).toBe(10000);
  });

  it('regra não verificada não afeta o score', async () => {
    const dataset = await datasetFrom([textFile('nfe.xml', buildNfeXml(sale(8401, 1000)))]);
    const { score } = runAudit(dataset, { organizationId: 'org-1', auditId: 'audit-1' });
    expect(score.score).toBe(100);
  });
});
