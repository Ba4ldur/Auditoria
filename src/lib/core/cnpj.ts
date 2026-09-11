/**
 * CNPJ / CPF handling.
 *
 * Validation follows the check-digit algorithm published by the Receita
 * Federal (modulus 11 over the weighted digits). No assumption is made about
 * the registration status of the number — the system only verifies the
 * structural validity, never the existence of the taxpayer.
 */

export function onlyDigits(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

function checkDigit(base: string, startWeight: number): number {
  let weight = startWeight;
  let sum = 0;
  for (const char of base) {
    sum += Number(char) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const first = checkDigit(digits.slice(0, 12), 5);
  if (first !== Number(digits[12])) return false;
  const second = checkDigit(digits.slice(0, 13), 6);
  return second === Number(digits[13]);
}

export function isValidCpf(value: string | null | undefined): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const calc = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += Number(digits[i]) * (length + 1 - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

export function formatCnpj(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return value ?? '';
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function formatCpf(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return value ?? '';
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** Formats a CNPJ or CPF according to its length, leaving anything else as-is. */
export function formatTaxId(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  if (digits.length === 14) return formatCnpj(digits);
  if (digits.length === 11) return formatCpf(digits);
  return value ?? '';
}

/** Builds a structurally valid CNPJ from a 12-digit base. Demo/test use only. */
export function buildCnpjFromBase(base12: string): string {
  const base = onlyDigits(base12).padStart(12, '0').slice(0, 12);
  const first = checkDigit(base, 5);
  const second = checkDigit(`${base}${first}`, 6);
  return `${base}${first}${second}`;
}
