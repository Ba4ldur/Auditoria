/**
 * Parser contract.
 *
 * Every obligation supported by the system implements `FileParser`. Parsers are
 * pure functions over bytes: they never touch the database, the filesystem or
 * React. Their only output is a `ParsedPayload` expressed in the normalised
 * model, which is what makes the audit engine format-agnostic (requirement 15).
 */

import type {
  Declaration,
  FileIdentity,
  Invoice,
  ParticipantRecord,
  RevenueRecord,
  TaxRecord,
} from '@/lib/domain/model';
import type { FileMessage, FileStats } from '@/lib/domain/entities';
import type { DataSourceKind } from '@/lib/domain/sources';
import type { Result } from '@/lib/core/result';

export interface ParserInput {
  /** Raw bytes of the uploaded file. */
  readonly bytes: Uint8Array;
  readonly fileName: string;
  /** Identifier of the persisted `audit_files` row, propagated for traceability. */
  readonly fileId: string;
}

export interface ParsedPayload {
  readonly source: DataSourceKind;
  readonly identity: FileIdentity;
  readonly invoices: readonly Invoice[];
  readonly revenues: readonly RevenueRecord[];
  readonly taxes: readonly TaxRecord[];
  readonly declarations: readonly Declaration[];
  readonly participants: readonly ParticipantRecord[];
  readonly messages: readonly FileMessage[];
  readonly stats: FileStats;
  /** Payloads produced by files extracted from a container (ZIP). */
  readonly children?: readonly ParsedPayload[];
}

export const EMPTY_STATS: FileStats = Object.freeze({
  found: 0,
  processed: 0,
  duplicated: 0,
  invalid: 0,
  ignored: 0,
});

export interface DetectionHint {
  readonly source: DataSourceKind;
  /** 0..1 — how certain the detector is. The highest score wins. */
  readonly confidence: number;
  readonly reason: string;
}

export interface FileParser {
  readonly source: DataSourceKind;
  /** Inspects the head of the file and reports whether it can handle it. */
  detect(input: DetectionInput): DetectionHint | null;
  parse(input: ParserInput): Promise<Result<ParsedPayload>>;
}

export interface DetectionInput {
  readonly fileName: string;
  readonly extension: string;
  /** First bytes of the file, decoded as latin1 for cheap textual sniffing. */
  readonly head: string;
  readonly bytes: Uint8Array;
}

export function emptyPayload(source: DataSourceKind, identity: FileIdentity): ParsedPayload {
  return {
    source,
    identity,
    invoices: [],
    revenues: [],
    taxes: [],
    declarations: [],
    participants: [],
    messages: [],
    stats: EMPTY_STATS,
  };
}

export function mergeStats(...stats: readonly FileStats[]): FileStats {
  return stats.reduce<FileStats>(
    (acc, current) => ({
      found: acc.found + current.found,
      processed: acc.processed + current.processed,
      duplicated: acc.duplicated + current.duplicated,
      invalid: acc.invalid + current.invalid,
      ignored: acc.ignored + current.ignored,
    }),
    EMPTY_STATS,
  );
}
