/**
 * Audit processing (requirements 8, 29 and 30).
 *
 * Files are parsed one by one and in isolation: a failure marks that file as
 * `ERRO` and the audit continues with the remaining ones. The normalised
 * dataset is assembled once and handed to the rule engine.
 *
 * Files whose CNPJ does not match the company are excluded from the dataset,
 * never merged (requirement 9).
 */

import { describeError } from '@/lib/core/result';
import type { Audit, AuditFile, FileMessage } from '@/lib/domain/entities';
import { buildDataset, type AuditDataset } from '@/lib/normalization/dataset';
import { parseFile, type ParsedPayload } from '@/lib/parsers';
import { DEFAULT_REVENUE_POLICY, runAudit, type EngineResult } from '@/lib/audit-engine';
import { getStorage, getStore } from '@/lib/data';

export interface ProcessOutcome {
  readonly audit: Audit;
  readonly engine: EngineResult;
  readonly dataset: AuditDataset;
  readonly processedFiles: number;
  readonly failedFiles: number;
  readonly skippedFiles: number;
}

export async function processAudit(auditId: string): Promise<ProcessOutcome> {
  const store = getStore();
  const storage = getStorage();

  const audit = await store.getAudit(auditId);
  if (!audit) throw new Error(`Auditoria não encontrada: ${auditId}`);

  const company = await store.getCompany(audit.companyId);
  if (!company) throw new Error(`Empresa não encontrada: ${audit.companyId}`);

  await store.updateAudit(auditId, {
    status: 'PROCESSANDO',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  const files = await store.listFiles(auditId);
  const payloads: { payload: ParsedPayload; fileId: string; fileName: string }[] = [];
  let failedFiles = 0;
  let skippedFiles = 0;

  for (const file of files) {
    if (file.identityCheck === 'INCOMPATIVEL') {
      skippedFiles += 1;
      continue;
    }
    const result = await processSingleFile(file, storage, store);
    if (result) payloads.push({ payload: result, fileId: file.id, fileName: file.originalName });
    else failedFiles += 1;
  }

  const dataset = buildDataset({ company, competencia: audit.competencia, payloads });

  await store.saveDataset(auditId, {
    invoices: dataset.invoices,
    revenues: dataset.revenues,
    taxes: dataset.taxes,
    declarations: dataset.declarations,
    participants: dataset.participants,
  });

  const settings = await store.getSettings();
  const ruleSettings = new Map((await store.listRuleSettings()).map((setting) => [setting.ruleCode, setting]));

  const engine = runAudit(dataset, {
    organizationId: audit.organizationId,
    auditId,
    settings: ruleSettings,
    scoreWeights: settings.scoreWeights,
    revenuePolicy: {
      ...DEFAULT_REVENUE_POLICY,
      cfopExclusions: settings.revenueCfopExclusions,
    },
  });

  await store.replaceFindings(auditId, engine.findings);

  const updated = await store.updateAudit(auditId, {
    status: failedFiles > 0 ? 'CONCLUIDA_COM_ERROS' : 'CONCLUIDA',
    score: engine.score.score,
    band: engine.score.band,
    documentCount: dataset.invoices.length,
    crossChecksOk: engine.summary.cruzamentosCorretos,
    finishedAt: new Date().toISOString(),
  });

  return {
    audit: updated,
    engine,
    dataset,
    processedFiles: payloads.length,
    failedFiles,
    skippedFiles,
  };
}

async function processSingleFile(
  file: AuditFile,
  storage: ReturnType<typeof getStorage>,
  store: ReturnType<typeof getStore>,
): Promise<ParsedPayload | null> {
  if (!file.storagePath) {
    await store.updateFile(file.id, {
      status: 'ERRO',
      messages: [
        ...file.messages,
        { level: 'ERRO', code: 'ARQUIVO_SEM_CAMINHO', message: 'Arquivo sem caminho de armazenamento.' },
      ],
      processedAt: new Date().toISOString(),
    });
    return null;
  }

  await store.updateFile(file.id, { status: 'PROCESSANDO' });

  try {
    const bytes = await storage.get(file.storagePath);
    const result = await parseFile(bytes, file.originalName, file.id);

    if (!result.ok) {
      await store.updateFile(file.id, {
        status: 'ERRO',
        messages: [
          ...file.messages,
          { level: 'ERRO', code: result.error.code, message: result.error.message },
        ],
        processedAt: new Date().toISOString(),
      });
      return null;
    }

    const payload = result.value;
    const messages: FileMessage[] = [...file.messages, ...payload.messages];
    const hasWarnings = messages.some((message) => message.level === 'ALERTA');

    await store.updateFile(file.id, {
      status: hasWarnings ? 'PROCESSADO_COM_ALERTAS' : 'PROCESSADO',
      detectedSource: payload.source,
      messages,
      stats: payload.stats,
      processedAt: new Date().toISOString(),
    });

    return payload;
  } catch (error) {
    await store.updateFile(file.id, {
      status: 'ERRO',
      messages: [
        ...file.messages,
        { level: 'ERRO', code: 'FALHA_PROCESSAMENTO', message: 'Falha ao processar o arquivo.', detail: describeError(error) },
      ],
      processedAt: new Date().toISOString(),
    });
    return null;
  }
}

/** Rebuilds the dataset from persisted data, without re-parsing the files. */
export async function loadAuditDataset(auditId: string): Promise<AuditDataset | null> {
  const store = getStore();
  const audit = await store.getAudit(auditId);
  if (!audit) return null;
  const company = await store.getCompany(audit.companyId);
  if (!company) return null;
  const stored = await store.loadDataset(auditId);
  if (!stored) return null;

  const availableSources = new Set([
    ...stored.invoices.map((invoice) => invoice.source),
    ...stored.revenues.map((revenue) => revenue.source),
    ...stored.taxes.map((tax) => tax.source),
    ...stored.declarations.map((declaration) => declaration.source),
  ]);

  const files = await store.listFiles(auditId);

  return {
    company,
    competencia: audit.competencia,
    invoices: stored.invoices,
    revenues: stored.revenues,
    taxes: stored.taxes,
    declarations: stored.declarations,
    participants: stored.participants,
    files: files.map((file) => ({
      fileId: file.id,
      fileName: file.originalName,
      source: file.detectedSource,
    })),
    availableSources,
  };
}

