/**
 * Exportação em CSV (fase 2, requisito 19).
 *
 * O arquivo é gerado para abrir corretamente no Excel em português:
 *  - separador ponto e vírgula, que é o esperado na configuração brasileira;
 *  - valores monetários com vírgula decimal e sem separador de milhar, para que
 *    o Excel os reconheça como número;
 *  - BOM UTF-8, sem o qual o Excel exibe a acentuação incorretamente.
 */

import { toReais, type Cents } from '@/lib/core/money';

const SEPARATOR = ';';
const BOM = '﻿';

export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[";\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Formata centavos como número para o Excel brasileiro (1234,56). */
export function csvMoney(value: Cents | null | undefined): string {
  if (value === null || value === undefined) return '';
  return toReais(value).toFixed(2).replace('.', ',');
}

export function buildCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(SEPARATOR)];
  for (const row of rows) lines.push(row.map(escapeCell).join(SEPARATOR));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export function csvResponseHeaders(fileName: string): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'private, no-store',
  };
}
