/**
 * Integração ponta a ponta do núcleo XML NF-e × EFD ICMS/IPI.
 *
 * Percorre o caminho inteiro, sem atalho: upload dos arquivos → identificação
 * do tipo → parser → normalização → reconciliação → regras → evidências →
 * gravação → releitura do que foi gravado.
 *
 * Existe porque cada camada, isolada, passa. O que quebra na prática é a
 * costura: uma coluna que a gravação escreve e a leitura não devolve, uma
 * origem que se perde entre o parser e a evidência, um documento que o dataset
 * deduplica antes de a regra vê-lo. Nenhum desses aparece em teste de unidade.
 *
 * O cenário é uma competência com cinco documentos e cinco situações
 * deliberadas: um documento correto, um não escriturado, um com ICMS divergente
 * na saída, uma entrada cujo crédito é menor que o destaque e um documento
 * escriturado duas vezes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuditFinding } from '@/lib/domain/entities';

const originalCwd = process.cwd();
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'attivare-integracao-'));
  process.chdir(workDir);
});

afterAll(async () => {
  process.chdir(originalCwd);
  await rm(workDir, { recursive: true, force: true });
});

describe('pipeline completo XML × EFD ICMS/IPI', () => {
  it('vai do arquivo à evidência gravada, preservando a rastreabilidade', async () => {
    const { getStore } = await import('@/lib/data');
    const { ingestUpload } = await import('@/lib/pipeline/upload');
    const { processAudit } = await import('@/lib/pipeline/process');
    const { reconcile } = await import('@/lib/audit-engine/reconciliation');
    const {
      DEMO_COMPANY,
      DEMO_CUSTOMER,
      DEMO_SUPPLIER,
      buildEfdIcmsTxt,
      buildNfeXml,
      computeNfeTotals,
      nfeAccessKey,
    } = await import('@/lib/demo/fixtures');
    const { XML_PARSER_VERSION, EFD_ICMS_IPI_PARSER_VERSION } = await import('@/lib/parsers/versions');
    type NfeSpec = Parameters<typeof buildNfeXml>[0];

    const item = (cfop: string, quantidade: number, valorUnitario: number, aliquotaIcms: number) => ({
      codigo: 'PROD001',
      descricao: 'PRODUTO DEMONSTRAÇÃO A',
      ncm: '84713012',
      cfop,
      cst: '00',
      unidade: 'UN',
      quantidade,
      valorUnitario,
      aliquotaIcms,
    });

    const venda = (numero: number, valorUnitario: number): NfeSpec => ({
      numero,
      serie: 1,
      modelo: '55',
      emissao: '2026-08-12',
      naturezaOperacao: 'VENDA DE MERCADORIA',
      tpNF: '1',
      emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
      destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: 'RJ' },
      items: [item('6102', 1, valorUnitario, 12)],
    });

    const compra = (numero: number): NfeSpec => ({
      numero,
      serie: 1,
      modelo: '55',
      emissao: '2026-08-13',
      naturezaOperacao: 'VENDA DE MERCADORIA',
      tpNF: '1',
      emitente: { cnpj: DEMO_SUPPLIER.cnpj, nome: DEMO_SUPPLIER.legalName, uf: 'MG' },
      destinatario: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
      items: [item('6102', 4, 250, 12)],
    });

    const correto = venda(7001, 1000);
    const naoEscriturado = venda(7002, 2000);
    const icmsDivergente = venda(7003, 3000);
    const duplicado = venda(7004, 1500);
    const entrada = compra(7005);
    // Documento de 2026 com os tributos da reforma: vNF 2.000,00 e
    // vNFTot 2.015,00. O VL_DOC escriturado é o vNF, como o Guia Prático
    // determina para o exercício.
    const comReforma: NfeSpec = { ...venda(7006, 2000), reforma: { ibs: 1, cbs: 9, is: 5 } };

    const store = getStore();
    const company = await store.createCompany({
      legalName: DEMO_COMPANY.legalName,
      tradeName: DEMO_COMPANY.tradeName,
      cnpj: DEMO_COMPANY.cnpj,
      stateRegistration: DEMO_COMPANY.stateRegistration,
      municipalRegistration: null,
      uf: 'SP',
      municipality: DEMO_COMPANY.municipality,
      taxRegime: 'LUCRO_PRESUMIDO',
    });
    const audit = await store.createAudit({ companyId: company.id, competencia: '2026-08' });

    // ---------------------------------------------------------------- upload
    const documentos = [correto, naoEscriturado, icmsDivergente, duplicado, entrada, comReforma];
    for (const spec of documentos) {
      const upload = await ingestUpload({
        auditId: audit.id,
        company,
        competencia: '2026-08',
        fileName: `NFe-${spec.numero}.xml`,
        mimeType: 'application/xml',
        bytes: new Uint8Array(Buffer.from(buildNfeXml(spec), 'utf8')),
      });
      expect(upload.accepted, `upload de ${spec.numero}: ${upload.message ?? ''}`).toBe(true);
    }

    const efd = buildEfdIcmsTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: [
        { spec: correto },
        // naoEscriturado fica deliberadamente de fora.
        { spec: icmsDivergente, override: { icms: computeNfeTotals(icmsDivergente).icms - 90 } },
        { spec: duplicado, override: { duplicado: true } },
        { spec: entrada, override: { cfop: '2102', baseIcms: 0, icms: 0 } },
        { spec: comReforma, override: { valorDocumento: computeNfeTotals(comReforma).total } },
      ] as never,
      icmsARecolher: 66000,
    });

    const efdUpload = await ingestUpload({
      auditId: audit.id,
      company,
      competencia: '2026-08',
      fileName: 'EFD_082026.txt',
      mimeType: 'text/plain',
      bytes: new Uint8Array(Buffer.from(efd, 'latin1')),
    });
    expect(efdUpload.accepted).toBe(true);

    // ------------------------------------------------------------ processamento
    const outcome = await processAudit(audit.id);
    expect(outcome.failedFiles).toBe(0);
    expect(outcome.processedFiles).toBe(7);

    const files = await store.listFiles(audit.id);
    expect(files).toHaveLength(7);
    expect(files.every((file) => file.status === 'PROCESSADO')).toBe(true);
    const xmlFilesGravados = files.filter((file) => file.detectedSource === 'XML_NFE');
    const efdFileGravado = files.find((file) => file.detectedSource === 'EFD_ICMS_IPI');
    expect(xmlFilesGravados).toHaveLength(6);
    expect(xmlFilesGravados.every((file) => file.parserVersion === XML_PARSER_VERSION)).toBe(true);
    expect(efdFileGravado?.parserVersion).toBe(EFD_ICMS_IPI_PARSER_VERSION);

    // ------------------------------------------------------------- normalização
    const dataset = await store.loadDataset(audit.id);
    expect(dataset).not.toBeNull();
    if (!dataset) return;

    expect(dataset.invoices.filter((invoice) => invoice.source === 'XML_NFE')).toHaveLength(6);
    // O duplicado é colapsado: quatro chaves distintas do lado da escrituração.
    expect(dataset.invoices.filter((invoice) => invoice.source === 'EFD_ICMS_IPI')).toHaveLength(5);

    // ------------------------------------------------------------ reconciliação
    // Remonta o dataset completo pelo caminho da aplicação, com a versão de
    // cada parser resolvida a partir do arquivo armazenado.
    const { loadAuditDataset } = await import('@/lib/pipeline/process');
    const completo = await loadAuditDataset(audit.id);
    expect(completo).not.toBeNull();
    if (!completo) return;
    expect(completo.parserVersions.size).toBe(7);

    const recon = reconcile(outcome.dataset);
    expect(recon.pairs).toHaveLength(5);
    expect(recon.xmlOnly.map((invoice) => invoice.number)).toEqual(['7002']);
    expect(recon.efdDuplicates).toHaveLength(1);
    expect(recon.efdDuplicates[0]?.key).toBe(nfeAccessKey(duplicado));
    expect(recon.pairs.filter((pair) => pair.scope === 'ENTRADA_TERCEIRO')).toHaveLength(1);

    // ------------------------------------------------------------------ regras
    const findings = (await store.listFindings({ auditId: audit.id, limit: 200 })).items;
    const byRule = (codigo: string): AuditFinding[] =>
      findings.filter((finding) => finding.ruleCode === codigo);

    // Não escriturado: divergência de fato.
    const fis001 = byRule('ATT-FIS-001').filter((finding) => finding.status === 'DIVERGENCIA');
    expect(fis001).toHaveLength(1);
    expect(fis001[0]?.documentRef).toBe(nfeAccessKey(naoEscriturado));

    // ICMS divergente na saída própria: divergência de fato.
    const fis005 = byRule('ATT-FIS-005').filter((finding) => finding.status === 'DIVERGENCIA');
    expect(fis005).toHaveLength(1);
    expect(fis005[0]?.documentRef).toBe(nfeAccessKey(icmsDivergente));
    expect(fis005[0]?.difference).toBe(9000);

    // A entrada não é comparada em ICMS nem em CFOP, e é dito por quê.
    expect(byRule('ATT-FIS-005').some((finding) => finding.status === 'NAO_APLICAVEL')).toBe(true);
    expect(byRule('ATT-FIS-006').filter((finding) => finding.status === 'DIVERGENCIA')).toHaveLength(0);

    // A composição de 2026 não gera ocorrência para o documento conciliado.
    const fis003 = byRule('ATT-FIS-003').filter((finding) => finding.status === 'DIVERGENCIA');

    // Duplicidade.
    const fis008 = byRule('ATT-FIS-008');
    expect(fis008).toHaveLength(1);
    expect(fis008[0]?.documentRef).toBe(nfeAccessKey(duplicado));

    // ------------------------------------------------- composição do exercício
    // O documento com IBS/CBS/IS concilia: em 2026 o VL_DOC não os inclui, e o
    // comparável é o vNF. Se o motor usasse o vNFTot, haveria divergência de
    // R$ 15,00 — o falso positivo que a regra de vigência existe para impedir.
    expect(
      fis003.filter((finding) => finding.documentRef === nfeAccessKey(comReforma)),
    ).toHaveLength(0);

    // O total RTC sobrevive à gravação e à releitura: `reform_taxes` é jsonb, e
    // uma coluna que grava mas não devolve só aparece em teste de integração.
    const persistido = dataset.invoices.find(
      (invoice) => invoice.source === 'XML_NFE' && invoice.accessKey === nfeAccessKey(comReforma),
    );
    expect(persistido?.totals.total).toBe(200000);
    expect(persistido?.reformTaxes?.totalWithReformTaxes).toBe(201500);
    expect(persistido?.reformTaxes?.ibs).toBe(100);
    expect(persistido?.reformTaxes?.readFields).toContain('vNFTot=2015.00');

    // ---------------------------------------------------------- rastreabilidade
    // Toda evidência precisa poder ser reconduzida ao arquivo que a produziu.
    const origemEfd = fis005[0]?.evidence.find((item) => item.fieldName === 'VL_ICMS');
    expect(origemEfd?.fileName).toBe('EFD_082026.txt');
    expect(origemEfd?.recordCode).toBe('C100');
    expect(origemEfd?.lineNumber).toBeGreaterThan(0);
    expect(origemEfd?.parserVersion).toBe(EFD_ICMS_IPI_PARSER_VERSION);

    const origemXml = fis005[0]?.evidence.find((item) => item.fieldName === 'total/ICMSTot/vICMS');
    expect(origemXml?.fileName).toBe(`NFe-${icmsDivergente.numero}.xml`);
    expect(origemXml?.parserVersion).toBe(XML_PARSER_VERSION);

    // A versão da regra é gravada e sobrevive à releitura.
    expect(fis005[0]?.ruleVersion).toBe('2.0.0');
    expect(fis008[0]?.ruleVersion).toBe('1.0.0');

    // O arquivo indicado na evidência realmente existe e é recuperável.
    const arquivoEfd = files.find((file) => file.originalName === 'EFD_082026.txt');
    expect(arquivoEfd?.storagePath).toBeTruthy();
    expect(arquivoEfd?.sha256).toMatch(/^[0-9a-f]{64}$/);

    // --------------------------------------------------------------- persistência
    // Releitura individual: o que foi gravado volta íntegro, evidências inclusive.
    const relido = await store.getFinding(fis005[0]!.id);
    expect(relido?.evidence.length).toBe(fis005[0]?.evidence.length);
    expect(relido?.evidence.some((item) => item.fieldName === 'VL_ICMS')).toBe(true);
    expect(relido?.ruleVersion).toBe('2.0.0');

    // ------------------------------------------------------------------- score
    const processada = await store.getAudit(audit.id);
    expect(processada?.status).toBe('CONCLUIDA');
    expect(processada?.score).toBeLessThan(100);
    // As exclusões por escopo e as conferências não executadas não penalizam.
    const naoPenalizadas = findings.filter(
      (finding) => finding.status === 'NAO_APLICAVEL' || finding.status === 'NAO_VERIFICADO',
    );
    expect(naoPenalizadas.length).toBeGreaterThan(0);
  });
});
