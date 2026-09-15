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
import type { Audit, AuditFile, FileInspection, FileMessage } from '@/lib/domain/entities';
import { buildDataset, type AuditDataset } from '@/lib/normalization/dataset';
import { parseFile, type ParsedPayload } from '@/lib/parsers';
import { policyFromRules, runAudit, type EngineResult } from '@/lib/audit-engine';
import { getStorage, getStore } from '@/lib/data';
import { summariseSped } from '@/lib/parsers/sped/inspect';
import { decodeSped } from '@/lib/parsers/sped/reader';
import { classifyReliability, toFileParseLog } from './reliability';
import { applyFieldConfirmations } from './confirmations';

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

  const confirmations = await store.listFieldConfirmations(auditId);

  for (const file of files) {
    // Arquivo de outro CNPJ nunca alimenta os cruzamentos. Um arquivo que
    // falhou antes é reprocessado: o parser pode ter sido corrigido desde então.
    if (file.identityCheck === 'INCOMPATIVEL') {
      skippedFiles += 1;
      continue;
    }
    const result = await processSingleFile(file, storage, store);
    if (!result) {
      failedFiles += 1;
      continue;
    }
    // Correções manuais atuam sobre o modelo normalizado; o arquivo original
    // permanece intocado (requisito 11).
    const corrected = applyFieldConfirmations(result, confirmations);
    payloads.push({ payload: corrected, fileId: file.id, fileName: file.originalName });
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
    revenuePolicy: policyFromRules(await store.listCfopRules()),
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

  let bytes: Uint8Array;
  try {
    bytes = await storage.get(file.storagePath);
  } catch (error) {
    await store.updateFile(file.id, {
      status: 'ERRO',
      reliability: 'ERRO',
      messages: [
        ...file.messages,
        { level: 'ERRO', code: 'ARQUIVO_INDISPONIVEL', message: 'Arquivo não pôde ser lido do armazenamento.', detail: describeError(error) },
      ],
      processedAt: new Date().toISOString(),
    });
    return null;
  }

  try {
    const result = await parseFile(bytes, file.originalName, file.id);

    if (!result.ok) {
      await store.updateFile(file.id, {
        status: 'ERRO',
        reliability: 'ERRO',
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
    const parseLog = toFileParseLog(payload.log);

    const { reliability, reasons } = classifyReliability({
      identityCheck: file.identityCheck,
      failed: false,
      log: parseLog,
      messages,
      declarations: payload.declarations,
    });

    for (const reason of reasons) {
      if (messages.some((message) => message.detail === reason)) continue;
      messages.push({ level: 'ALERTA', code: 'CONFIABILIDADE', message: reason });
    }

    await store.updateFile(file.id, {
      status: hasWarnings ? 'PROCESSADO_COM_ALERTAS' : 'PROCESSADO',
      detectedSource: payload.source,
      reliability,
      parserVersion: payload.parserVersion,
      parseLog,
      inspection: inspectionFor(payload.source, bytes),
      messages,
      stats: payload.stats,
      processedAt: new Date().toISOString(),
    });

    return payload;
  } catch (error) {
    await store.updateFile(file.id, {
      status: 'ERRO',
      reliability: 'ERRO',
      messages: [
        ...file.messages,
        { level: 'ERRO', code: 'FALHA_PROCESSAMENTO', message: 'Falha ao processar o arquivo.', detail: describeError(error) },
      ],
      processedAt: new Date().toISOString(),
    });
    return null;
  }
}

export interface ReprocessOutcome {
  readonly ok: boolean;
  readonly file: AuditFile;
  readonly message: string;
}

/**
 * Reinterpreta um arquivo já armazenado (requisito 13).
 *
 * O arquivo original é imutável: apenas a leitura é refeita, com a versão de
 * parser vigente. Os cruzamentos só refletem a nova leitura depois que a
 * auditoria for reprocessada, e a interface avisa isso explicitamente.
 */
export async function reprocessFile(fileId: string): Promise<ReprocessOutcome> {
  const store = getStore();
  const storage = getStorage();

  const file = await store.getFile(fileId);
  if (!file) throw new Error(`Arquivo não encontrado: ${fileId}`);

  // As mensagens da importação são descartadas para que o log reflita apenas
  // esta leitura; a identificação de CNPJ e competência é preservada.
  await store.updateFile(fileId, { messages: [], stats: null, parseLog: null });
  const clean = await store.getFile(fileId);
  if (!clean) throw new Error(`Arquivo não encontrado: ${fileId}`);

  const payload = await processSingleFile(clean, storage, store);
  const updated = (await store.getFile(fileId)) ?? clean;

  return {
    ok: payload !== null,
    file: updated,
    message:
      payload === null
        ? 'O arquivo não pôde ser interpretado. Veja o log de leitura.'
        : `Arquivo reinterpretado pelo parser versão ${updated.parserVersion ?? '—'}. ` +
          'Reprocesse a auditoria para atualizar os cruzamentos.',
  };
}

/** Resumo estrutural, calculado apenas para as obrigações orientadas a registro. */
function inspectionFor(source: string, bytes: Uint8Array): FileInspection | null {
  if (source !== 'EFD_ICMS_IPI' && source !== 'EFD_CONTRIBUICOES') return null;
  const summary = summariseSped(decodeSped(bytes), source);
  return {
    totalLines: summary.totalLines,
    totalRecords: summary.totalRecords,
    registers: summary.registers,
  };
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
      parserVersion: file.parserVersion,
    })),
    availableSources,
    parserVersions: new Map(
      files
        .filter((file) => file.parserVersion !== null)
        .map((file) => [file.id, file.parserVersion as string]),
    ),
    // O dataset reconstruído a partir do banco não passa pela deduplicação: os
    // documentos gravados já são o resultado dela. Reprocessar o arquivo é o
    // caminho para reavaliar duplicidade.
    duplicateOrigins: new Map(),
  };
}

