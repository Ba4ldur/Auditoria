/**
 * Competencia (accrual period) handling.
 *
 * The canonical internal representation is `YYYY-MM`. Fiscal files express the
 * same information in several notations (`MMYYYY` in SPED, `MM/YYYY` in
 * PGDAS-D), so all conversions are centralised here.
 */

const CANONICAL = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type Competencia = string;

export function isCompetencia(value: string | null | undefined): value is Competencia {
  return typeof value === 'string' && CANONICAL.test(value);
}

export function makeCompetencia(year: number, month: number): Competencia {
  if (!Number.isInteger(year) || year < 1900 || year > 2999) {
    throw new RangeError(`Ano inválido para competência: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Mês inválido para competência: ${month}`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** Parses `MMYYYY`, `MM/YYYY`, `YYYY-MM` or `MM-YYYY` into the canonical form. */
export function parseCompetencia(raw: string | null | undefined): Competencia | null {
  if (!raw) return null;
  const value = raw.trim();

  const canonical = CANONICAL.exec(value);
  if (canonical) return value;

  const mmyyyy = /^(\d{2})(\d{4})$/.exec(value);
  if (mmyyyy) return safeMake(Number(mmyyyy[2]), Number(mmyyyy[1]));

  const separated = /^(\d{1,2})[/\-.](\d{4})$/.exec(value);
  if (separated) return safeMake(Number(separated[2]), Number(separated[1]));

  const yyyymm = /^(\d{4})[/\-.]?(\d{2})$/.exec(value);
  if (yyyymm) return safeMake(Number(yyyymm[1]), Number(yyyymm[2]));

  return null;
}

function safeMake(year: number, month: number): Competencia | null {
  if (month < 1 || month > 12 || year < 1900 || year > 2999) return null;
  return makeCompetencia(year, month);
}

/** Derives the competencia from an ISO date (`YYYY-MM-DD`) or a SPED date (`DDMMYYYY`). */
export function competenciaFromDate(raw: string | null | undefined): Competencia | null {
  if (!raw) return null;
  const value = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return safeMake(Number(iso[1]), Number(iso[2]));

  const sped = /^(\d{2})(\d{2})(\d{4})$/.exec(value);
  if (sped) return safeMake(Number(sped[3]), Number(sped[2]));

  return null;
}

export function formatCompetencia(value: Competencia): string {
  const match = CANONICAL.exec(value);
  if (!match) return value;
  return `${match[2]}/${match[1]}`;
}

export function competenciaBounds(value: Competencia): { start: string; end: string } {
  const match = CANONICAL.exec(value);
  if (!match) throw new RangeError(`Competência inválida: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Sorts competencias chronologically; the canonical format is lexicographic. */
export function compareCompetencia(a: Competencia, b: Competencia): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
