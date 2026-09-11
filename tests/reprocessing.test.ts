import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Teste de integração do reprocessamento (fase 2, requisito 13).
 *
 * Roda o pipeline real contra um diretório temporário: o armazenamento local e
 * o store são resolvidos a partir de `process.cwd()`, e cada arquivo de teste
 * do Vitest executa em seu próprio worker, de modo que a troca de diretório não
 * interfere nos demais testes.
 */

const originalCwd = process.cwd();
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'attivare-test-'));
  process.chdir(workDir);
});

afterAll(async () => {
  process.chdir(originalCwd);
  await rm(workDir, { recursive: true, force: true });
});

describe('reprocessamento de arquivo', () => {
  it('reinterpreta o arquivo armazenado sem novo upload e registra a versão do parser', async () => {
    const { getStore } = await import('@/lib/data');
    const { ingestUpload } = await import('@/lib/pipeline/upload');
    const { processAudit, reprocessFile } = await import('@/lib/pipeline/process');
    const { buildEfdIcmsTxt, DEMO_COMPANY, DEMO_CUSTOMER } = await import('@/lib/demo/fixtures');
    const { EFD_ICMS_IPI_PARSER_VERSION } = await import('@/lib/parsers/versions');

    const store = getStore();
    const company = await store.createCompany({
      legalName: DEMO_COMPANY.legalName,
      tradeName: null,
      cnpj: DEMO_COMPANY.cnpj,
      stateRegistration: null,
      municipalRegistration: null,
      uf: 'SP',
      municipality: null,
      taxRegime: 'SIMPLES_NACIONAL',
    });
    const audit = await store.createAudit({ companyId: company.id, competencia: '2026-08' });

    const content = buildEfdIcmsTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: [
        {
          spec: {
            numero: 1,
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
                cfop: '5102',
                cst: '00',
                unidade: 'UN',
                quantidade: 1,
                valorUnitario: 1000,
                aliquotaIcms: 18,
              },
            ],
          },
        },
      ],
      icmsARecolher: 180,
    });

    const upload = await ingestUpload({
      auditId: audit.id,
      company,
      competencia: '2026-08',
      fileName: 'EFD_082026.txt',
      mimeType: 'text/plain',
      bytes: new Uint8Array(Buffer.from(content, 'latin1')),
    });
    expect(upload.accepted).toBe(true);
    const fileId = upload.file!.id;

    // Antes do processamento não há versão de parser registrada.
    expect((await store.getFile(fileId))?.parserVersion).toBeNull();

    await processAudit(audit.id);

    const processed = await store.getFile(fileId);
    expect(processed?.status).toBe('PROCESSADO');
    expect(processed?.parserVersion).toBe(EFD_ICMS_IPI_PARSER_VERSION);
    expect(processed?.reliability).toBe('VALIDADO');
    expect(processed?.inspection?.registers.some((entry) => entry.code === 'C100')).toBe(true);
    expect(processed?.parseLog?.unsupportedRecords.length).toBeGreaterThan(0);

    const dataset = await store.loadDataset(audit.id);
    expect(dataset?.invoices).toHaveLength(1);
    expect(dataset?.invoices[0]?.origin.recordCode).toBe('C100');
    expect(dataset?.invoices[0]?.origin.lineNumber).toBeGreaterThan(0);

    // Reprocessa sem novo upload: o objeto armazenado é o mesmo.
    const outcome = await reprocessFile(fileId);
    expect(outcome.ok).toBe(true);
    expect(outcome.file.parserVersion).toBe(EFD_ICMS_IPI_PARSER_VERSION);
    expect(outcome.file.sha256).toBe(processed?.sha256);
    expect(outcome.message).toContain('Reprocesse a auditoria');

    const after = await store.getFile(fileId);
    expect(after?.status).toBe('PROCESSADO');
    // O log reflete apenas a última leitura, sem acumular mensagens repetidas.
    expect(after?.messages.filter((message) => message.code === 'SPED_RESUMO')).toHaveLength(1);
  });

  it('bloqueia arquivo de outro CNPJ e não o inclui nos cruzamentos', async () => {
    const { getStore } = await import('@/lib/data');
    const { ingestUpload } = await import('@/lib/pipeline/upload');
    const { processAudit } = await import('@/lib/pipeline/process');
    const { buildNfeXml, DEMO_COMPANY, DEMO_SUPPLIER, DEMO_CUSTOMER } = await import(
      '@/lib/demo/fixtures'
    );

    const store = getStore();
    const company = (await store.findCompanyByCnpj(DEMO_COMPANY.cnpj))!;
    const audit = await store.createAudit({ companyId: company.id, competencia: '2026-09' });

    const alien = buildNfeXml({
      numero: 77,
      serie: 1,
      modelo: '55',
      emissao: '2026-09-03',
      naturezaOperacao: 'VENDA',
      tpNF: '1',
      emitente: { cnpj: DEMO_SUPPLIER.cnpj, nome: DEMO_SUPPLIER.legalName, uf: 'MG' },
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
          valorUnitario: 500,
          aliquotaIcms: 12,
        },
      ],
    });

    const upload = await ingestUpload({
      auditId: audit.id,
      company,
      competencia: '2026-09',
      fileName: 'alheio.xml',
      mimeType: 'application/xml',
      bytes: new Uint8Array(Buffer.from(alien, 'utf8')),
    });

    expect(upload.accepted).toBe(false);
    expect(upload.file?.identityCheck).toBe('INCOMPATIVEL');
    expect(upload.file?.reliability).toBe('INCOMPATIVEL');

    const outcome = await processAudit(audit.id);
    expect(outcome.skippedFiles).toBe(1);
    expect(outcome.dataset.invoices).toHaveLength(0);
  });
});
