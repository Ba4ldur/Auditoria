/**
 * NF-e / NFC-e access key ("chave de acesso").
 *
 * Layout defined by the Manual de Orientacao do Contribuinte (44 digits):
 * cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1).
 * The check digit is a modulus 11 over weights 2..9 cycling right to left.
 */

import { onlyDigits } from './cnpj';

export interface NfeKeyParts {
  uf: string;
  yearMonth: string;
  cnpj: string;
  modelo: string;
  serie: string;
  numero: string;
  tipoEmissao: string;
  codigoNumerico: string;
  digitoVerificador: string;
}

export function normalizeNfeKey(raw: string | null | undefined): string | null {
  const digits = onlyDigits(raw);
  return digits.length === 44 ? digits : null;
}

export function nfeKeyCheckDigit(first43: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = first43.length - 1; i >= 0; i -= 1) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidNfeKey(raw: string | null | undefined): boolean {
  const key = normalizeNfeKey(raw);
  if (!key) return false;
  if (/^0{44}$/.test(key)) return false;
  return nfeKeyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}

export function splitNfeKey(raw: string | null | undefined): NfeKeyParts | null {
  const key = normalizeNfeKey(raw);
  if (!key) return null;
  return {
    uf: key.slice(0, 2),
    yearMonth: key.slice(2, 6),
    cnpj: key.slice(6, 20),
    modelo: key.slice(20, 22),
    serie: key.slice(22, 25),
    numero: key.slice(25, 34),
    tipoEmissao: key.slice(34, 35),
    codigoNumerico: key.slice(35, 43),
    digitoVerificador: key.slice(43, 44),
  };
}

/** Builds a key with a valid check digit from its first 43 digits. Demo/test use only. */
export function buildNfeKey(first43: string): string {
  const base = onlyDigits(first43).padEnd(43, '0').slice(0, 43);
  return `${base}${nfeKeyCheckDigit(base)}`;
}

const UF_BY_CODE: Readonly<Record<string, string>> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
  '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
  '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

export function ufFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return UF_BY_CODE[code.padStart(2, '0')] ?? null;
}

export const UF_CODES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(UF_BY_CODE).map(([code, uf]) => [uf, code])),
);

export const UF_LIST: readonly string[] = Object.freeze(Object.values(UF_BY_CODE).sort());
