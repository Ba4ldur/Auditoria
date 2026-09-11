/**
 * SPED text reader.
 *
 * SPED files are record-oriented, not free text: each line is a sequence of
 * fields delimited by `|`, and the first field is the register code. Reading
 * them with regular expressions over the whole file would be both slow and
 * wrong, so everything downstream consumes the tokenised stream produced here.
 *
 * The reader is a generator: a 400 MB EFD is never materialised as an array of
 * records, only as the aggregates each layout chooses to keep.
 */

export interface SpedRecord {
  /** Register code, e.g. `0000`, `C100`, `M200`. */
  readonly code: string;
  /**
   * Raw fields, indexed by the position used in the official layout:
   * `get(1)` is the register code, `get(2)` the first data field.
   */
  readonly parts: readonly string[];
  readonly line: number;
}

export function field(record: SpedRecord, position: number): string | null {
  const value = record.parts[position];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/**
 * Decodes SPED bytes.
 *
 * The layout guides specify ISO-8859-1 (latin1), but files exported by some
 * ERPs are UTF-8. A strict UTF-8 attempt distinguishes the two without
 * guessing from the file name.
 */
export function decodeSped(bytes: Uint8Array): string {
  const hasBom = bytes.length >= 3 && UTF8_BOM.every((b, i) => bytes[i] === b);
  const body = hasBom ? bytes.subarray(3) : bytes;
  if (hasBom) return new TextDecoder('utf-8').decode(body);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('latin1').decode(body);
  }
}

/** Splits a SPED text into records, skipping blank lines. */
export function* readSpedRecords(content: string): Generator<SpedRecord> {
  let lineNumber = 0;
  let start = 0;
  const length = content.length;

  while (start <= length) {
    let end = content.indexOf('\n', start);
    if (end === -1) end = length;

    let raw = content.slice(start, end);
    start = end + 1;
    lineNumber += 1;

    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    if (raw.trim() === '') {
      if (end === length) break;
      continue;
    }

    const parts = raw.split('|');
    const code = parts[1]?.trim() ?? '';
    if (code === '') {
      if (end === length) break;
      continue;
    }

    yield { code, parts, line: lineNumber };

    if (end === length) break;
  }
}

/**
 * Quick structural check used by the file-type detector: a SPED file starts
 * with the `0000` opening register on its first non-blank line.
 */
export function looksLikeSped(head: string): boolean {
  for (const line of head.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    return /^\|0000\|/.test(line.trim());
  }
  return false;
}
