/**
 * PDF text extraction (no OCR).
 *
 * Only textual PDFs are supported in this release, which is a deliberate
 * restriction: an OCR pass would introduce transcription errors into numbers
 * that the audit engine treats as facts. A scanned PDF is reported as such and
 * left for manual confirmation.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import { failWith, ok, type Result } from '@/lib/core/result';

export interface PdfText {
  readonly pages: readonly string[];
  readonly full: string;
  readonly totalPages: number;
}

export async function extractPdfText(bytes: Uint8Array): Promise<Result<PdfText>> {
  try {
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const { text, totalPages } = await extractText(document, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const full = pages.join('\n');
    if (full.trim().length === 0) {
      return failWith(
        'PDF_SEM_TEXTO',
        'O PDF não possui camada de texto (provavelmente digitalizado). Este release não utiliza OCR.',
      );
    }
    return ok({ pages, full, totalPages });
  } catch (error) {
    return failWith('PDF_ILEGIVEL', 'Não foi possível ler o PDF.', String(error));
  }
}

/** Removes diacritics and collapses whitespace, for tolerant label matching. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
}
