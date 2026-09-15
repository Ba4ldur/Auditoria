/**
 * Detecção de banco desatualizado.
 *
 * O motivo é concreto: entre a fase 2 e a fase 3, a aplicação gravava colunas
 * em `audit_finding_evidence` que nenhuma migração havia criado. O sintoma era
 * uma auditoria que processava, exibia resultado na tela e falhava na gravação
 * das evidências com uma mensagem de banco — sem dizer o que fazer a respeito.
 *
 * Uma auditoria sem evidência gravada é pior do que uma auditoria que não roda:
 * o resultado parece existir e não é conferível. Por isso o esquema é conferido
 * na subida do servidor e, se ainda assim uma gravação falhar por coluna
 * inexistente, o erro é traduzido para uma instrução acionável em vez de um
 * repasse do texto do PostgREST.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Mensagem única, para que a mesma frase apareça no log e na tela. */
export const OUTDATED_DATABASE_MESSAGE = 'Banco de dados requer migração';

/**
 * Colunas que esta versão da aplicação grava e que foram introduzidas por
 * migração. A lista é a fronteira entre código e esquema: acrescente aqui a
 * coluna nova junto com a migração que a cria.
 */
export const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // 0005_fase3_xml_efd.sql
  audit_finding_evidence: ['record_code', 'line_number', 'field_name', 'parser_version'],
  audit_findings: ['rule_version'],
  invoices: ['purpose', 'extemporaneous', 'purpose_code', 'purpose_field', 'reform_taxes'],
  organization_settings: ['indicio_factor'],
});

/** Migração que traz o esquema exigido por esta versão. */
export const REQUIRED_MIGRATION = 'supabase/migrations/0005_fase3_xml_efd.sql';

export interface MissingColumns {
  readonly table: string;
  readonly columns: readonly string[];
  readonly detail: string;
}

export interface SchemaCheck {
  readonly upToDate: boolean;
  readonly missing: readonly MissingColumns[];
  /** Tabelas que não puderam ser conferidas (permissão, indisponibilidade). */
  readonly unchecked: readonly { table: string; reason: string }[];
}

/**
 * Códigos com que PostgreSQL e PostgREST relatam coluna inexistente.
 * `42703` é o SQLSTATE `undefined_column`; `PGRST204` é o equivalente do
 * PostgREST quando a coluna não está no cache de esquema.
 */
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);

function looksLikeMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && MISSING_COLUMN_CODES.has(error.code)) return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('does not exist') && message.includes('column');
}

/**
 * Confere, tabela a tabela, se as colunas exigidas existem.
 *
 * A sonda é um `select` limitado a zero linhas: o PostgREST valida as colunas
 * pedidas antes de executar a consulta, de modo que a resposta diz se a coluna
 * existe sem ler dado algum nem depender de acesso ao `information_schema`.
 */
export async function checkSchema(client: SupabaseClient): Promise<SchemaCheck> {
  const missing: MissingColumns[] = [];
  const unchecked: { table: string; reason: string }[] = [];

  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const { error } = await client.from(table).select(columns.join(',')).limit(0);
    if (!error) continue;

    if (looksLikeMissingColumn(error)) {
      missing.push({ table, columns, detail: error.message });
      continue;
    }
    unchecked.push({ table, reason: error.message });
  }

  return { upToDate: missing.length === 0, missing, unchecked };
}

/**
 * Cliente mínimo para a conferência de esquema.
 *
 * Existe para que a verificação de inicialização não precise importar o módulo
 * de armazenamento: aquele depende de `node:fs`, e `instrumentation.ts` também
 * é compilado para o Edge Runtime, onde o módulo não existe. O guarda de
 * runtime impediria a execução, mas não a análise do bundle.
 */
export function createSchemaCheckClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** Texto do aviso, pronto para log e para tela. */
export function describeSchemaCheck(check: SchemaCheck): string {
  if (check.upToDate) return 'Esquema do banco compatível com esta versão da aplicação.';
  const detalhes = check.missing
    .map((item) => `${item.table} (${item.columns.join(', ')})`)
    .join('; ');
  return (
    `${OUTDATED_DATABASE_MESSAGE}. Colunas exigidas por esta versão e ausentes no banco: ${detalhes}. ` +
    `Aplique ${REQUIRED_MIGRATION} antes de processar auditorias: sem ela, os resultados são calculados mas as ` +
    'evidências não podem ser gravadas.'
  );
}

/**
 * Traduz um erro de gravação em instrução acionável quando a causa é coluna
 * inexistente; caso contrário devolve a mensagem original com o contexto.
 */
export function describeWriteError(context: string, error: { code?: string; message?: string }): string {
  if (looksLikeMissingColumn(error)) {
    return (
      `${OUTDATED_DATABASE_MESSAGE}. ${context} falhou porque o banco não possui uma coluna exigida por esta ` +
      `versão (${error.message}). Aplique ${REQUIRED_MIGRATION}.`
    );
  }
  return `${context}: ${error.message}`;
}
