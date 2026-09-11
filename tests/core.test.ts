import { describe, expect, it } from 'vitest';
import {
  addCents,
  cents,
  formatBRL,
  formatSignedBRL,
  parseDecimalToCents,
  subCents,
  sumCents,
} from '@/lib/core/money';
import { buildCnpjFromBase, formatCnpj, isValidCnpj, isValidCpf, onlyDigits } from '@/lib/core/cnpj';
import {
  competenciaFromDate,
  formatCompetencia,
  makeCompetencia,
  parseCompetencia,
} from '@/lib/core/competencia';
import { buildNfeKey, isValidNfeKey, splitNfeKey, ufFromCode } from '@/lib/core/nfe-key';
import { brDateToIso, nfeDateToIso, spedDateToIso } from '@/lib/core/dates';

describe('comparacoes monetarias', () => {
  it('interpreta a notacao decimal do XML (ponto)', () => {
    expect(parseDecimalToCents('1234.56')).toBe(123456);
    expect(parseDecimalToCents('0.01')).toBe(1);
    expect(parseDecimalToCents('1000')).toBe(100000);
  });

  it('interpreta a notacao decimal do SPED e do PGDAS-D (virgula)', () => {
    expect(parseDecimalToCents('1.234,56')).toBe(123456);
    expect(parseDecimalToCents('487.230,42')).toBe(48723042);
    expect(parseDecimalToCents('0,05')).toBe(5);
  });

  it('arredonda a terceira casa decimal em vez de truncar', () => {
    expect(parseDecimalToCents('10.005')).toBe(1001);
    expect(parseDecimalToCents('10.004')).toBe(1000);
  });

  it('trata valores negativos e ausentes', () => {
    expect(parseDecimalToCents('-25,50')).toBe(-2550);
    expect(parseDecimalToCents('')).toBeNull();
    expect(parseDecimalToCents(null)).toBeNull();
    expect(parseDecimalToCents('abc')).toBeNull();
  });

  it('não acumula erro de ponto flutuante ao somar muitos valores', () => {
    const values = Array.from({ length: 1000 }, () => cents(10));
    expect(sumCents(values)).toBe(10000);
    // A mesma soma em ponto flutuante nao fecha exatamente em 100.
    const floating = Array.from({ length: 1000 }, () => 0.1).reduce((a, b) => a + b, 0);
    expect(floating).not.toBe(100);
  });

  it('formata valores em reais', () => {
    expect(formatBRL(cents(48723042)).replace(/ /g, ' ')).toBe('R$ 487.230,42');
    expect(formatSignedBRL(subCents(cents(100), cents(300))).replace(/ /g, ' ')).toBe('-R$ 2,00');
    expect(formatSignedBRL(addCents(cents(100), cents(300))).replace(/ /g, ' ')).toBe('+R$ 4,00');
  });
});

describe('CNPJ e CPF', () => {
  it('valida dígitos verificadores de CNPJ', () => {
    const cnpj = buildCnpjFromBase('112223330001');
    expect(isValidCnpj(cnpj)).toBe(true);
    expect(isValidCnpj('11222333000100')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('123')).toBe(false);
  });

  it('valida dígitos verificadores de CPF', () => {
    expect(isValidCpf('111.444.777-35')).toBe(true);
    expect(isValidCpf('111.444.777-36')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
  });

  it('formata e normaliza', () => {
    const cnpj = buildCnpjFromBase('112223330001');
    expect(onlyDigits(formatCnpj(cnpj))).toBe(cnpj);
    expect(formatCnpj(cnpj)).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
  });
});

describe('competencia', () => {
  it('aceita as notacoes usadas pelas obrigações', () => {
    expect(parseCompetencia('082026')).toBe('2026-08');
    expect(parseCompetencia('08/2026')).toBe('2026-08');
    expect(parseCompetencia('2026-08')).toBe('2026-08');
    expect(parseCompetencia('8/2026')).toBe('2026-08');
  });

  it('rejeita meses inválidos', () => {
    expect(parseCompetencia('13/2026')).toBeNull();
    expect(parseCompetencia('00/2026')).toBeNull();
    expect(parseCompetencia('texto')).toBeNull();
  });

  it('deriva a competência de datas', () => {
    expect(competenciaFromDate('2026-08-31')).toBe('2026-08');
    expect(competenciaFromDate('31082026')).toBe('2026-08');
  });

  it('formata para exibicao', () => {
    expect(formatCompetencia(makeCompetencia(2026, 8))).toBe('08/2026');
  });
});

describe('chave de acesso da NF-e', () => {
  it('calcula o dígito verificador (módulo 11)', () => {
    const key = buildNfeKey('3526081122233300019255000000001110000000');
    expect(key).toHaveLength(44);
    expect(isValidNfeKey(key)).toBe(true);
  });

  it('rejeita chave com dígito verificador incorreto', () => {
    const key = buildNfeKey('3526081122233300019255000000001110000000');
    const last = Number(key[43]);
    const tampered = `${key.slice(0, 43)}${(last + 1) % 10}`;
    expect(isValidNfeKey(tampered)).toBe(false);
  });

  it('decompoe a chave em seus campos', () => {
    const key = buildNfeKey('3526081122233300019255001000000123110000000');
    const parts = splitNfeKey(key);
    expect(parts?.uf).toBe('35');
    expect(parts?.modelo).toBe('55');
    expect(ufFromCode('35')).toBe('SP');
  });
});

describe('datas', () => {
  it('converte entre os formatos das obrigações', () => {
    expect(spedDateToIso('31082026')).toBe('2026-08-31');
    expect(spedDateToIso('99999999')).toBeNull();
    expect(nfeDateToIso('2026-08-15T10:30:00-03:00')).toBe('2026-08-15');
    expect(brDateToIso('15/08/2026')).toBe('2026-08-15');
  });
});
