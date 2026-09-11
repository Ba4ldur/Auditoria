/**
 * Upload validation and ingestion (requirements 27, 28 and 29).
 *
 * The file is validated, hashed, stored and identified. Parsing the whole
 * content is deliberately deferred to the processing step, so a large batch of
 * uploads stays responsive.
 */

import { sha256 } from '@/lib/core/hash';
import { describeError } from '@/lib/core/result';
import { appEnv } from '@/lib/config/env';
import type { AuditFile, Company, FileMessage } from '@/lib/domain/entities';
import type { Competencia } from '@/lib/core/competencia';
import { identifyFile } from '@/lib/parsers/identify';
import { assessIdentity } from '@/lib/normalization/identity';
import { getStorage, getStore, storagePathFor } from '@/lib/data';

/** Extensions accepted by the current release (requirement 8). */
export const ACCEPTED_EXTENSIONS = ['.xml', '.zip', '.txt', '.pdf'] as const;

export interface UploadOutcome {
  readonly file: AuditFile | null;
  readonly accepted: boolean;
  readonly message: string;
}

export function validateUpload(fileName: string, sizeBytes: number): string | null {
  const lower = fileName.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return `Extensão não suportada. Aceitos: ${ACCEPTED_EXTENSIONS.join(', ')}.`;
  }
  if (sizeBytes <= 0) return 'Arquivo vazio.';
  const limit = appEnv().maxUploadBytes;
  if (sizeBytes > limit) {
    return `Arquivo excede o limite de ${Math.floor(limit / (1024 * 1024))} MB.`;
  }
  return null;
}

export async function ingestUpload(params: {
  auditId: string;
  company: Company;
  competencia: Competencia;
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
}): Promise<UploadOutcome> {
  const { auditId, company, competencia, fileName, mimeType, bytes } = params;

  const validationError = validateUpload(fileName, bytes.byteLength);
  if (validationError) {
    return { file: null, accepted: false, message: `${fileName}: ${validationError}` };
  }

  const store = getStore();
  const storage = getStorage();
  const digest = sha256(bytes);

  const duplicate = await store.findFileByHash(auditId, digest);
  if (duplicate) {
    return {
      file: duplicate,
      accepted: false,
      message: `${fileName}: arquivo idêntico já importado nesta auditoria (${duplicate.originalName}).`,
    };
  }

  const file = await store.createFile({
    auditId,
    originalName: fileName,
    storagePath: null,
    mimeType,
    sizeBytes: bytes.byteLength,
    sha256: digest,
  });

  const storagePath = storagePathFor(auditId, file.id, fileName);
  const messages: FileMessage[] = [];

  try {
    await storage.put(storagePath, bytes, mimeType ?? 'application/octet-stream');
  } catch (error) {
    await store.updateFile(file.id, {
      status: 'ERRO',
      messages: [
        { level: 'ERRO', code: 'STORAGE_FALHA', message: 'Falha ao armazenar o arquivo.', detail: describeError(error) },
      ],
    });
    return { file, accepted: false, message: `${fileName}: falha ao armazenar o arquivo.` };
  }

  const identification = await identifyFile(bytes, fileName, file.id);

  if (!identification.ok) {
    const updated = await store.updateFile(file.id, {
      storagePath,
      status: 'ERRO',
      messages: [
        { level: 'ERRO', code: identification.error.code, message: identification.error.message },
      ],
    });
    return { file: updated, accepted: false, message: `${fileName}: ${identification.error.message}` };
  }

  const { source, identity, detectionReason } = identification.value;
  const assessment = assessIdentity(identity, company, competencia);
  messages.push({ level: 'INFO', code: 'DETECCAO', message: detectionReason });
  messages.push(...assessment.messages);

  const updated = await store.updateFile(file.id, {
    storagePath,
    detectedSource: source,
    detectedTaxId: identity.taxId,
    detectedLegalName: identity.legalName,
    detectedCompetencia: identity.competencia,
    detectedStartDate: identity.startDate,
    detectedEndDate: identity.endDate,
    identityCheck: assessment.check,
    status: assessment.blocking ? 'ERRO' : 'PENDENTE',
    messages,
  });

  return {
    file: updated,
    accepted: !assessment.blocking,
    message: assessment.blocking
      ? `${fileName}: arquivo incompatível com a empresa selecionada.`
      : `${fileName}: importado.`,
  };
}
