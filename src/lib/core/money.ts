/**
 * Fiscal money handling.
 *
 * Every monetary amount inside the system is stored as an integer number of
 * cents. Floating point arithmetic is never used for comparisons, because a
 * rounding artefact of R$ 0,000000001 would be reported to the auditor as a
 * divergence.
 */

declare const centsBrand: unique symbol;

/** An integer amount of Brazilian cents. */
export type Cents = number & { readonly [centsBrand]: true };

export const ZERO: Cents = 0 as Cents;

export function cents(value: number): Cents {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Valor monetario inválido: ${value}`);
  }
  return Math.round(value) as Cents;
}

export function addCents(...values: Cents[]): Cents {
  let total = 0;
  for (const value of values) total += value;
  return total as Cents;
}

export function subCents(a: Cents, b: Cents): Cents {
  return (a - b) as Cents;
}

export function absCents(value: Cents): Cents {
  return Math.abs(value) as Cents;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) total += value;
  return total as Cents;
}

export function toReais(value: Cents): number {
  return value / 100;
}

/**
 * Parses a decimal string into cents.
 *
 * Handles the two notations that appear in Brazilian fiscal files:
 *  - XML (NF-e/NFC-e) always uses a dot as decimal separator: `1234.56`
 *  - SPED / PGDAS-D use a comma and may include thousand separators: `1.234,56`
 *
 * Returns `null` when the value cannot be interpreted; callers decide whether
 * that is an absent field or a parsing error.
 */
export function parseDecimalToCents(raw: string | null | undefined): Cents | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const negative = trimmed.startsWith('-');
  let body = negative ? trimmed.slice(1) : trimmed;
  body = body.replace(/\s/g, '');

  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');

  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = body;
  } else if (lastComma > lastDot) {
    // Comma is the decimal separator; dots are thousand separators.
    normalized = body.replace(/\./g, '').replace(',', '.');
  } else {
    // Dot is the decimal separator; commas are thousand separators.
    normalized = body.replace(/,/g, '');
  }

  if (!/^\d*(\.\d*)?$/.test(normalized) || normalized === '' || normalized === '.') {
    return null;
  }

  const [intPart = '0', fracPartRaw = ''] = normalized.split('.');
  const fracPart = `${fracPartRaw}00`.slice(0, 3);
  const scaled = Number(`${intPart || '0'}${fracPart.slice(0, 2)}`);
  const thirdDigit = Number(fracPart[2] ?? '0');
  const rounded = scaled + (thirdDigit >= 5 ? 1 : 0);

  return (negative ? -rounded : rounded) as Cents;
}

/** Parses a decimal string, treating absent/invalid values as zero. */
export function parseDecimalToCentsOrZero(raw: string | null | undefined): Cents {
  return parseDecimalToCents(raw) ?? ZERO;
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBRL(value: Cents): string {
  return BRL.format(toReais(value));
}

/** Formats a signed difference, always showing the sign. */
export function formatSignedBRL(value: Cents): string {
  const formatted = formatBRL(absCents(value));
  if (value === 0) return formatted;
  return value > 0 ? `+${formatted}` : `-${formatted}`;
}
