/**
 * Declarative SPED layout framework.
 *
 * A layout is a map from register code to a handler. Supporting a new register
 * means adding one entry here-shaped object in the corresponding parser — no
 * change to the reader, to the normalisation step or to the audit rules.
 *
 * Field positions follow the official "Guia Pratico" of each obligation and are
 * always referenced by their official field name, so that a layout revision can
 * be checked against this file field by field.
 */

import { readSpedRecords, type SpedRecord } from './reader';

export interface RegisterHandler<S> {
  readonly code: string;
  /** Official register description, shown in the parser documentation UI. */
  readonly description: string;
  handle(record: SpedRecord, state: S): void;
}

export type SpedLayout<S> = ReadonlyMap<string, RegisterHandler<S>>;

export function defineLayout<S>(handlers: readonly RegisterHandler<S>[]): SpedLayout<S> {
  const map = new Map<string, RegisterHandler<S>>();
  for (const handler of handlers) {
    if (map.has(handler.code)) {
      throw new Error(`Registro SPED duplicado no layout: ${handler.code}`);
    }
    map.set(handler.code, handler);
  }
  return map;
}

export interface LayoutRunSummary {
  readonly totalRecords: number;
  /** Registers present in the file but not mapped by the layout, with counts. */
  readonly unhandled: ReadonlyMap<string, number>;
  readonly handledCounts: ReadonlyMap<string, number>;
}

/** Streams the file through the layout, mutating `state`. */
export function runLayout<S>(content: string, layout: SpedLayout<S>, state: S): LayoutRunSummary {
  const unhandled = new Map<string, number>();
  const handledCounts = new Map<string, number>();
  let totalRecords = 0;

  for (const record of readSpedRecords(content)) {
    totalRecords += 1;
    const handler = layout.get(record.code);
    if (!handler) {
      unhandled.set(record.code, (unhandled.get(record.code) ?? 0) + 1);
      continue;
    }
    handler.handle(record, state);
    handledCounts.set(record.code, (handledCounts.get(record.code) ?? 0) + 1);
  }

  return { totalRecords, unhandled, handledCounts };
}
