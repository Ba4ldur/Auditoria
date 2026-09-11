/**
 * Cheap identification pass, executed at upload time.
 *
 * Running the full parser on every upload just to read the CNPJ would mean
 * decompressing a 10.000-document ZIP twice. This module reads only what is
 * needed to answer "which obligation is this, of which taxpayer, of which
 * period" and leaves the heavy work to the processing step.
 */

import { unzipSync } from 'fflate';
import { onlyDigits } from '@/lib/core/cnpj';
import { competenciaFromDate } from '@/lib/core/competencia';
import { spedDateToIso } from '@/lib/core/dates';
import { failWith, ok, type Result } from '@/lib/core/result';
import { EMPTY_IDENTITY, type FileIdentity } from '@/lib/domain/model';
import type { DataSourceKind } from '@/lib/domain/sources';
import { detectParser } from './index';
import { decodeSped, field, readSpedRecords } from './sped/reader';
import { decodeXml, parseNfeXml } from './xml/nfe';
import { extractPdfText } from './pdf/text';
import { parsePgdasdText } from './pdf/pgdasd';

export interface FileIdentification {
  readonly source: DataSourceKind;
  readonly identity: FileIdentity;
  readonly detectionReason: string;
}

export async function identifyFile(
  bytes: Uint8Array,
  fileName: string,
  fileId: string,
): Promise<Result<FileIdentification>> {
  const detection = detectParser(bytes, fileName);
  if (!detection) {
    return failWith(
      'TIPO_NAO_RECONHECIDO',
      `Não foi possível identificar o tipo do arquivo ${fileName}.`,
    );
  }

  const { parser, hint } = detection;

  if (parser.source === 'EFD_ICMS_IPI' || parser.source === 'EFD_CONTRIBUICOES') {
    const identity = identifySped(bytes, hint.source);
    return ok({ source: hint.source, identity, detectionReason: hint.reason });
  }

  if (hint.reason.startsWith('Assinatura ZIP')) {
    const identity = identifyZip(bytes);
    return ok({ source: hint.source, identity, detectionReason: hint.reason });
  }

  if (parser.source === 'PGDAS_D') {
    const text = await extractPdfText(bytes);
    if (!text.ok) return text;
    const { declaration } = parsePgdasdText(text.value.full, { fileId, fileName });
    return ok({
      source: 'PGDAS_D',
      identity: {
        ...EMPTY_IDENTITY,
        taxId: declaration.taxId,
        legalName: declaration.legalName,
        competencia: declaration.competencia,
      },
      detectionReason: hint.reason,
    });
  }

  const parsed = parseNfeXml(decodeXml(bytes), { fileId: null, fileName });
  if (!parsed.ok) return parsed;
  const invoice = parsed.value.invoice;
  return ok({
    source: invoice.source,
    identity: {
      ...EMPTY_IDENTITY,
      taxId: invoice.emitterTaxId,
      legalName: invoice.emitterName,
      competencia: competenciaFromDate(invoice.issueDate),
      startDate: invoice.issueDate,
      endDate: invoice.issueDate,
      uf: invoice.emitterUf,
    },
    detectionReason: hint.reason,
  });
}

/** Reads only the SPED opening register (0000). */
function identifySped(bytes: Uint8Array, source: DataSourceKind): FileIdentity {
  const head = decodeSped(bytes.subarray(0, 8192));
  for (const record of readSpedRecords(head)) {
    if (record.code !== '0000') continue;

    if (source === 'EFD_CONTRIBUICOES') {
      const startDate = spedDateToIso(field(record, 6));
      return {
        ...EMPTY_IDENTITY,
        taxId: onlyDigits(field(record, 9) ?? '') || null,
        legalName: field(record, 8),
        competencia: competenciaFromDate(startDate),
        startDate,
        endDate: spedDateToIso(field(record, 7)),
        uf: field(record, 10),
      };
    }

    const startDate = spedDateToIso(field(record, 4));
    return {
      ...EMPTY_IDENTITY,
      taxId: onlyDigits(field(record, 7) ?? field(record, 8) ?? '') || null,
      legalName: field(record, 6),
      competencia: competenciaFromDate(startDate),
      startDate,
      endDate: spedDateToIso(field(record, 5)),
      stateRegistration: field(record, 10),
      uf: field(record, 9),
    };
  }
  return EMPTY_IDENTITY;
}

/** Reads the first XML entry of the archive, which is enough to identify it. */
function identifyZip(bytes: Uint8Array): FileIdentity {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (file) => /\.xml$/i.test(file.name) && file.size > 0 });
  } catch {
    return EMPTY_IDENTITY;
  }

  for (const [name, content] of Object.entries(entries)) {
    if (name.includes('__MACOSX/')) continue;
    const parsed = parseNfeXml(decodeXml(content), { fileId: null, fileName: name });
    if (!parsed.ok) continue;
    const invoice = parsed.value.invoice;
    return {
      ...EMPTY_IDENTITY,
      taxId: invoice.emitterTaxId,
      legalName: invoice.emitterName,
      competencia: competenciaFromDate(invoice.issueDate),
      startDate: invoice.issueDate,
      endDate: invoice.issueDate,
      uf: invoice.emitterUf,
    };
  }

  return EMPTY_IDENTITY;
}
