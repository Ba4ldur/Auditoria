/**
 * ZIP container parser (requirement 11).
 *
 * Extracts the archive in memory, keeps only the entries the system knows how
 * to read, and processes them one by one. A single malformed XML is reported
 * as an individual error and never aborts the batch.
 *
 * Deduplication is done by NF-e access key: the same document delivered twice
 * (a very common occurrence in monthly XML dumps) is counted once.
 */

import { unzipSync } from 'fflate';
import { failWith, ok, type Result } from '@/lib/core/result';
import { EMPTY_IDENTITY, type FileIdentity, type Invoice } from '@/lib/domain/model';
import type { FileMessage, FileStats } from '@/lib/domain/entities';
import { competenciaFromDate } from '@/lib/core/competencia';
import { decodeXml, parseNfeXml } from '../xml/nfe';
import { EMPTY_PARSE_LOG, type DetectionHint, type DetectionInput, type FileParser, type ParsedPayload, type ParserInput } from '../types';
import { ZIP_PARSER_VERSION } from '../versions';

const MAX_ENTRIES = 50_000;
const SUPPORTED_ENTRY = /\.xml$/i;
const NESTED_ARCHIVE = /\.zip$/i;
const MAX_NESTING = 2;

interface ExtractionAccumulator {
  invoices: Map<string, Invoice>;
  messages: FileMessage[];
  found: number;
  processed: number;
  duplicated: number;
  invalid: number;
  ignored: number;
}

function detectZip(input: DetectionInput): DetectionHint | null {
  const signature =
    input.bytes.length >= 4 &&
    input.bytes[0] === 0x50 &&
    input.bytes[1] === 0x4b &&
    (input.bytes[2] === 0x03 || input.bytes[2] === 0x05 || input.bytes[2] === 0x07);
  if (!signature) return null;
  return {
    source: 'XML_NFE',
    confidence: input.extension === '.zip' ? 0.9 : 0.6,
    reason: 'Assinatura ZIP (PK) identificada; o conteudo será analisado individualmente.',
  };
}

function walk(bytes: Uint8Array, prefix: string, depth: number, acc: ExtractionAccumulator): void {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    acc.messages.push({
      level: 'ERRO',
      code: 'ZIP_CORROMPIDO',
      message: `Não foi possível abrir o arquivo compactado${prefix ? ` ${prefix}` : ''}.`,
      detail: String(error),
    });
    return;
  }

  const names = Object.keys(entries);
  if (names.length > MAX_ENTRIES) {
    acc.messages.push({
      level: 'ERRO',
      code: 'ZIP_EXCESSIVO',
      message: `Arquivo compactado com ${names.length} entradas excede o limite de ${MAX_ENTRIES}.`,
    });
    return;
  }

  for (const name of names) {
    const content = entries[name];
    if (!content || content.length === 0) continue;
    // Directory entries and macOS resource forks.
    if (name.endsWith('/') || name.includes('__MACOSX/')) continue;

    const label = prefix ? `${prefix}/${name}` : name;

    if (NESTED_ARCHIVE.test(name)) {
      if (depth >= MAX_NESTING) {
        acc.ignored += 1;
        acc.messages.push({
          level: 'ALERTA',
          code: 'ZIP_ANINHADO_PROFUNDO',
          message: `Arquivo compactado aninhado ignorado por exceder ${MAX_NESTING} níveis: ${label}.`,
        });
        continue;
      }
      walk(content, label, depth + 1, acc);
      continue;
    }

    if (!SUPPORTED_ENTRY.test(name)) {
      acc.ignored += 1;
      continue;
    }

    acc.found += 1;
    const result = parseNfeXml(decodeXml(content), {
      fileId: null,
      fileName: prefix === '' ? label : prefix,
      entryName: label,
    });
    if (!result.ok) {
      acc.invalid += 1;
      acc.messages.push({
        level: 'ALERTA',
        code: result.error.code,
        message: `${label}: ${result.error.message}`,
        ...(result.error.detail === undefined ? {} : { detail: result.error.detail }),
      });
      continue;
    }

    const invoice = result.value.invoice;
    const dedupeKey = invoice.accessKey ?? invoice.id;
    if (acc.invoices.has(dedupeKey)) {
      acc.duplicated += 1;
      continue;
    }
    acc.invoices.set(dedupeKey, invoice);
    acc.processed += 1;
    acc.messages.push(...result.value.messages);
  }
}

export interface ZipExtraction {
  readonly invoices: readonly Invoice[];
  readonly messages: readonly FileMessage[];
  readonly stats: FileStats;
}

/** Extracts and parses every supported document inside a ZIP archive. */
export function extractZip(bytes: Uint8Array, fileName: string): Result<ZipExtraction> {
  const acc: ExtractionAccumulator = {
    invoices: new Map(),
    messages: [],
    found: 0,
    processed: 0,
    duplicated: 0,
    invalid: 0,
    ignored: 0,
  };

  walk(bytes, '', 0, acc);

  if (acc.found === 0 && acc.messages.some((m) => m.code === 'ZIP_CORROMPIDO')) {
    return failWith('ZIP_CORROMPIDO', `Arquivo compactado ${fileName} não pode ser lido.`);
  }

  return ok({
    invoices: [...acc.invoices.values()],
    messages: acc.messages,
    stats: {
      found: acc.found,
      processed: acc.processed,
      duplicated: acc.duplicated,
      invalid: acc.invalid,
      ignored: acc.ignored,
    },
  });
}

async function parseZipFile(input: ParserInput): Promise<Result<ParsedPayload>> {
  const extraction = extractZip(input.bytes, input.fileName);
  if (!extraction.ok) return extraction;

  const { invoices, messages, stats } = extraction.value;
  const withFile = invoices.map((invoice) => ({
    ...invoice,
    origin: { ...invoice.origin, fileId: input.fileId, fileName: input.fileName },
  }));

  const summary: FileMessage = {
    level: stats.invalid > 0 ? 'ALERTA' : 'INFO',
    code: 'ZIP_RESUMO',
    message:
      `${stats.found} XML encontrados, ${stats.processed} processados, ` +
      `${stats.duplicated} duplicados, ${stats.invalid} inválidos, ${stats.ignored} ignorados.`,
  };

  const hasNfce = withFile.some((invoice) => invoice.model === '65');
  const identity = buildIdentity(withFile);

  return ok({
    source: hasNfce && withFile.every((i) => i.model === '65') ? 'XML_NFCE' : 'XML_NFE',
    parserVersion: ZIP_PARSER_VERSION,
    log: { ...EMPTY_PARSE_LOG, warnings: messages.filter((m) => m.level === 'ALERTA') },
    identity,
    invoices: withFile,
    revenues: [],
    taxes: [],
    declarations: [],
    participants: [],
    messages: [summary, ...messages],
    stats,
  });
}

/**
 * Derives the archive identity from its content.
 *
 * A ZIP normally holds documents of a single taxpayer. When more than one
 * issuer CNPJ appears, the most frequent one is reported and the divergence is
 * surfaced by the identity check at import time.
 */
function buildIdentity(invoices: readonly Invoice[]): FileIdentity {
  if (invoices.length === 0) return EMPTY_IDENTITY;

  const counts = new Map<string, number>();
  for (const invoice of invoices) {
    if (!invoice.emitterTaxId) continue;
    counts.set(invoice.emitterTaxId, (counts.get(invoice.emitterTaxId) ?? 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const dates = invoices.map((i) => i.issueDate).filter((d): d is string => Boolean(d)).sort();
  const startDate = dates[0] ?? null;
  const endDate = dates[dates.length - 1] ?? null;
  const name = invoices.find((i) => i.emitterTaxId === dominant)?.emitterName ?? null;

  // Um ZIP de XML costuma misturar saídas e entradas; todos os CNPJ que
  // aparecem como emitente ou destinatário identificam o arquivo.
  const related = [
    ...new Set(
      invoices
        .flatMap((invoice) => [invoice.emitterTaxId, invoice.recipientTaxId])
        .filter((taxId): taxId is string => Boolean(taxId) && taxId !== dominant),
    ),
  ];

  return {
    taxId: dominant,
    relatedTaxIds: related,
    legalName: name,
    competencia: competenciaFromDate(startDate),
    startDate,
    endDate,
    stateRegistration: null,
    uf: invoices.find((i) => i.emitterTaxId === dominant)?.emitterUf ?? null,
  };
}

export const zipParser: FileParser = {
  source: 'XML_NFE',
  detect: detectZip,
  parse: parseZipFile,
};
