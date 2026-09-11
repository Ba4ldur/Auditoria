/**
 * Parser registry and automatic document identification (requirement 9).
 *
 * Registering a new obligation means appending its parser to `PARSERS` and
 * declaring it in `DATA_SOURCE_DEFINITIONS`. Nothing else in the system needs
 * to change.
 */

import { failWith, type Result } from '@/lib/core/result';
import type { DetectionHint, DetectionInput, FileParser, ParsedPayload } from './types';
import { nfeParser } from './xml/nfe';
import { zipParser } from './archive/zip';
import { efdIcmsIpiParser } from './sped/efd-icms-ipi';
import { efdContribuicoesParser } from './sped/efd-contribuicoes';
import { pgdasdParser } from './pdf/pgdasd';

/** Order matters only for ties; the highest detection confidence wins. */
export const PARSERS: readonly FileParser[] = [
  zipParser,
  nfeParser,
  efdIcmsIpiParser,
  efdContribuicoesParser,
  pgdasdParser,
];

const HEAD_BYTES = 8192;

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index === -1 ? '' : fileName.slice(index).toLowerCase();
}

export function buildDetectionInput(bytes: Uint8Array, fileName: string): DetectionInput {
  return {
    fileName,
    extension: extensionOf(fileName),
    head: new TextDecoder('latin1').decode(bytes.subarray(0, HEAD_BYTES)),
    bytes,
  };
}

export interface DetectionResult {
  readonly parser: FileParser;
  readonly hint: DetectionHint;
}

/** Picks the parser most confident about the file. */
export function detectParser(bytes: Uint8Array, fileName: string): DetectionResult | null {
  const input = buildDetectionInput(bytes, fileName);
  let best: DetectionResult | null = null;
  for (const parser of PARSERS) {
    const hint = parser.detect(input);
    if (!hint) continue;
    if (!best || hint.confidence > best.hint.confidence) {
      best = { parser, hint };
    }
  }
  return best;
}

export async function parseFile(
  bytes: Uint8Array,
  fileName: string,
  fileId: string,
): Promise<Result<ParsedPayload>> {
  const detection = detectParser(bytes, fileName);
  if (!detection) {
    return failWith(
      'TIPO_NAO_RECONHECIDO',
      `Não foi possível identificar o tipo do arquivo ${fileName}. Formatos aceitos neste release: XML de NF-e/NFC-e, ZIP de XML, EFD ICMS/IPI (TXT), EFD-Contribuições (TXT) e PGDAS-D (PDF textual).`,
    );
  }
  return detection.parser.parse({ bytes, fileName, fileId });
}

export type { DetectionHint, DetectionInput, FileParser, ParsedPayload, ParserInput } from './types';
