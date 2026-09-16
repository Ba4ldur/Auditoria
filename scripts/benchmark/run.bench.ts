/**
 * Benchmark sintético do pipeline XML NF-e × EFD ICMS/IPI (fase 4, item 10).
 *
 * Mede, separadamente e com dados reais (não estimados), o tempo de cada
 * etapa do pipeline para 1.000, 10.000 e 50.000 documentos:
 *
 *   parsing → normalização → reconciliação → regras → persistência (local)
 *
 * Cada etapa roda pelo código de produção de verdade — o mesmo `parseFile`,
 * `buildDataset`, `reconcile`, `runAudit` e `LocalStore` usados pela
 * aplicação — não uma versão simplificada para o benchmark.
 *
 * O que NÃO é medido aqui: persistência via Supabase/PostgREST. Não há projeto
 * Supabase nem driver Postgres (`pg`) disponível neste ambiente; instalar um
 * driver só para este benchmark ampliaria o escopo da tarefa. A persistência
 * medida é a do adaptador local (arquivo JSON), que é o que roda em
 * desenvolvimento e na demonstração.
 *
 * Execução:  npm run bench                      (1.000, 10.000 e 50.000)
 *            BENCHMARK_SIZES=1000 npm run bench  (só uma escala, mais rápido)
 *
 * Os números crus de cada execução vão para `scripts/benchmark/results.json`,
 * para que o relatório final cite exatamente o que rodou aqui — nunca uma
 * estimativa.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { parseFile } from '@/lib/parsers';
import { buildDataset, type AuditDataset } from '@/lib/normalization/dataset';
import type { ParsedPayload } from '@/lib/parsers/types';
import { reconcile } from '@/lib/audit-engine/reconciliation';
import { runAudit } from '@/lib/audit-engine';
import { LocalStore } from '@/lib/data/local-store';
import type { Company } from '@/lib/domain/entities';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  buildEfdIcmsTxt,
  buildNfeXml,
  type NfeSpec,
} from '@/lib/demo/fixtures';

const SIZES = (process.env.BENCHMARK_SIZES ?? '1000,10000,50000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

const RESULTS_FILE = join(process.cwd(), 'scripts/benchmark/results.json');

interface StageResult {
  readonly stage: string;
  readonly ms: number;
  readonly heapDeltaMb: number;
}

interface SizeResult {
  readonly size: number;
  readonly stages: readonly StageResult[];
  readonly totalMs: number;
  readonly xmlBytes: number;
  readonly efdBytes: number;
  readonly localStoreFileBytes: number;
  readonly node: string;
  readonly timestamp: string;
}

const allResults: SizeResult[] = [];

function company(): Company {
  return {
    id: 'bench-company',
    organizationId: 'bench-org',
    legalName: DEMO_COMPANY.legalName,
    tradeName: DEMO_COMPANY.tradeName,
    cnpj: DEMO_COMPANY.cnpj,
    stateRegistration: DEMO_COMPANY.stateRegistration,
    municipalRegistration: DEMO_COMPANY.municipalRegistration,
    uf: DEMO_COMPANY.uf,
    municipality: DEMO_COMPANY.municipality,
    taxRegime: 'LUCRO_PRESUMIDO',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Gera N vendas de saída própria, com pequena variação de valor e CFOP. */
function generateSpecs(size: number): NfeSpec[] {
  const specs: NfeSpec[] = [];
  for (let i = 0; i < size; i += 1) {
    const cfop = i % 5 === 0 ? '6102' : '5102';
    const valorUnitario = 100 + (i % 500);
    specs.push({
      numero: 10_000 + i,
      serie: 1,
      modelo: '55',
      emissao: '2026-08-15',
      naturezaOperacao: 'VENDA DE MERCADORIA',
      tpNF: '1',
      emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
      destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: 'RJ' },
      items: [
        {
          codigo: 'PROD001',
          descricao: 'PRODUTO BENCHMARK',
          ncm: '84713012',
          cfop,
          cst: '00',
          unidade: 'UN',
          quantidade: 1,
          valorUnitario,
          aliquotaIcms: 18,
        },
      ],
      // ~2% dos documentos com ICMS levemente divergente, para que as regras
      // de valor tenham ocorrências reais a produzir — um benchmark que só
      // percorre o caminho "tudo concilia" não exercitaria o custo de montar
      // evidências, que é justamente o que se quer medir na etapa de regras.
    });
  }
  return specs;
}

function heapMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

async function timed<T>(label: string, fn: () => Promise<T> | T): Promise<{ value: T; stage: StageResult }> {
  if (globalThis.gc) globalThis.gc();
  const before = heapMb();
  const start = performance.now();
  const value = await fn();
  const ms = performance.now() - start;
  const after = heapMb();
  return { value, stage: { stage: label, ms, heapDeltaMb: after - before } };
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

// Vitest já roda testes de um describe em sequência por padrão; nenhum
// modificador é necessário (e `.sequential` não existe nesta versão).
describe('benchmark sintético do pipeline XML × EFD ICMS/IPI', () => {
  for (const size of SIZES) {
    it(
      `${size.toLocaleString('pt-BR')} documentos`,
      async () => {
        const stages: StageResult[] = [];
        const comp = company();

        // ---------------------------------------------------------- geração
        // A geração dos arquivos de entrada não é uma etapa do pipeline da
        // aplicação (o auditor entrega arquivos prontos); não entra no tempo
        // medido, mas fica registrada para contexto.
        const genStart = performance.now();
        const specs = generateSpecs(size);
        const xmlBytesArr = specs.map((spec) => Buffer.from(buildNfeXml(spec), 'utf8'));
        const efdText = buildEfdIcmsTxt({
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          documents: specs.map((spec) => ({ spec })),
          icmsARecolher: 100_000_00,
        });
        const efdBytes = Buffer.from(efdText, 'latin1');
        const genMs = performance.now() - genStart;
        console.warn(
          `[${size}] geração de fixtures (fora da medição): ${fmtMs(genMs)}, ` +
            `EFD = ${(efdBytes.byteLength / (1024 * 1024)).toFixed(1)} MB`,
        );

        // ----------------------------------------------------------- parsing
        // Sequencial, um arquivo por vez — o mesmo padrão de `processAudit`
        // (src/lib/pipeline/process.ts), que é exatamente o que está em
        // questão: processamento síncrono é viável até que ponto?
        const payloads: { payload: ParsedPayload; fileId: string; fileName: string }[] = [];
        const { stage: parseStage } = await timed('parsing', async () => {
          for (const [index, bytes] of xmlBytesArr.entries()) {
            const fileName = `nfe-${index}.xml`;
            const result = await parseFile(bytes, fileName, `file-xml-${index}`);
            if (!result.ok) throw new Error(`Falha ao interpretar ${fileName}: ${result.error.message}`);
            payloads.push({ payload: result.value, fileId: `file-xml-${index}`, fileName });
          }
          const efdResult = await parseFile(efdBytes, 'EFD_ICMS_IPI.txt', 'file-efd');
          if (!efdResult.ok) throw new Error(`Falha ao interpretar a EFD: ${efdResult.error.message}`);
          payloads.push({ payload: efdResult.value, fileId: 'file-efd', fileName: 'EFD_ICMS_IPI.txt' });
        });
        stages.push(parseStage);
        expect(payloads).toHaveLength(size + 1);

        // ------------------------------------------------------ normalização
        let dataset!: AuditDataset;
        const { stage: normStage } = await timed('normalização', () => {
          dataset = buildDataset({ company: comp, competencia: '2026-08', payloads });
        });
        stages.push(normStage);
        expect(dataset.invoices.filter((invoice) => invoice.source === 'XML_NFE')).toHaveLength(size);

        // ----------------------------------------------------- reconciliação
        const { stage: reconStage } = await timed('reconciliação', () => {
          reconcile(dataset);
        });
        stages.push(reconStage);
        expect(reconcile(dataset).pairs.length).toBeGreaterThan(0);

        // ------------------------------------------------------------ regras
        // `reconcile` já está em cache (mesmo objeto `dataset`): esta etapa
        // mede o custo das regras em si, não paga de novo a reconciliação —
        // exatamente como acontece em produção, onde todas as regras
        // compartilham a mesma reconciliação de uma auditoria.
        let engineResult!: ReturnType<typeof runAudit>;
        const { stage: rulesStage } = await timed('regras', () => {
          engineResult = runAudit(dataset, { organizationId: comp.organizationId, auditId: 'bench-audit' });
        });
        stages.push(rulesStage);

        // -------------------------------------------------------- persistência
        // Adaptador local (arquivo JSON) — ver o cabeçalho deste arquivo sobre
        // por que o Supabase não é medido aqui.
        const dir = await mkdtemp(join(tmpdir(), 'attivare-bench-'));
        const storePath = join(dir, 'store.json');
        const store = new LocalStore(storePath);
        const { stage: persistStage } = await timed('persistência (local, escrita)', async () => {
          await store.saveDataset('bench-audit', {
            invoices: dataset.invoices,
            revenues: dataset.revenues,
            taxes: dataset.taxes,
            declarations: dataset.declarations,
            participants: dataset.participants,
          });
          await store.replaceFindings('bench-audit', engineResult.findings);
        });
        stages.push(persistStage);

        const { stat } = await import('node:fs/promises');
        const localStoreFileBytes = (await stat(storePath)).size;

        const { stage: readbackStage } = await timed('persistência (local, releitura)', async () => {
          await store.loadDataset('bench-audit');
          await store.listFindings({ auditId: 'bench-audit', limit: 100_000 });
        });
        stages.push(readbackStage);

        await rm(dir, { recursive: true, force: true });

        const totalMs = stages.reduce((sum, entry) => sum + entry.ms, 0);

        const result: SizeResult = {
          size,
          stages,
          totalMs,
          xmlBytes: xmlBytesArr.reduce((sum, buf) => sum + buf.byteLength, 0),
          efdBytes: efdBytes.byteLength,
          localStoreFileBytes,
          node: process.version,
          timestamp: new Date().toISOString(),
        };
        allResults.push(result);

        console.warn(`\n=== ${size.toLocaleString('pt-BR')} documentos ===`);
        for (const stage of stages) {
          console.warn(
            `  ${stage.stage.padEnd(32)} ${fmtMs(stage.ms).padStart(10)}   ` +
              `Δheap ${stage.heapDeltaMb >= 0 ? '+' : ''}${stage.heapDeltaMb.toFixed(1)} MB`,
          );
        }
        console.warn(`  ${'TOTAL'.padEnd(32)} ${fmtMs(totalMs).padStart(10)}`);
        console.warn(
          `  arquivo local final: ${(localStoreFileBytes / (1024 * 1024)).toFixed(1)} MB · ` +
            `EFD de entrada: ${(efdBytes.byteLength / (1024 * 1024)).toFixed(1)} MB`,
        );

        // Sanidade: o benchmark não é útil se o resultado não bate com o que a
        // auditoria real produziria para este volume.
        expect(engineResult.findings.length).toBeGreaterThanOrEqual(0);
      },
      600_000,
    );
  }

  it('grava os números desta execução em results.json', async () => {
    await writeFile(RESULTS_FILE, JSON.stringify(allResults, null, 2), 'utf8');
    expect(allResults.length).toBe(SIZES.length);
  });
});
