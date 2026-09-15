/**
 * Detecção de banco desatualizado.
 *
 * O defeito que estes testes previnem já aconteceu: a aplicação gravava colunas
 * que nenhuma migração criava, e a auditoria processava, exibia resultado e
 * falhava só na gravação das evidências, com uma mensagem de banco que não dizia
 * o que fazer. O que se fixa aqui é que a falha passe a ser detectável antes e
 * acionável depois.
 */

import { describe, expect, it } from 'vitest';
import {
  OUTDATED_DATABASE_MESSAGE,
  REQUIRED_COLUMNS,
  REQUIRED_MIGRATION,
  checkSchema,
  describeSchemaCheck,
  describeWriteError,
} from '@/lib/data/schema-check';
import type { SupabaseClient } from '@supabase/supabase-js';

interface FakeError {
  code?: string;
  message: string;
}

/**
 * Cliente mínimo que responde como o PostgREST: a sonda é um `select` das
 * colunas exigidas, e a resposta diz se alguma não existe.
 */
function fakeClient(colunasAusentes: Readonly<Record<string, readonly string[]>>): SupabaseClient {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            limit() {
              const ausentes = colunasAusentes[table] ?? [];
              const pedidas = columns.split(',');
              const faltando = pedidas.find((column) => ausentes.includes(column));
              const error: FakeError | null = faltando
                ? { code: '42703', message: `column ${table}.${faltando} does not exist` }
                : null;
              return Promise.resolve({ data: [], error });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('conferência do esquema', () => {
  it('banco em dia não produz aviso', async () => {
    const check = await checkSchema(fakeClient({}));

    expect(check.upToDate).toBe(true);
    expect(check.missing).toHaveLength(0);
    expect(describeSchemaCheck(check)).toContain('compatível');
  });

  it('acusa exatamente o defeito da fase 2: evidência sem coluna de origem', async () => {
    const check = await checkSchema(
      fakeClient({ audit_finding_evidence: ['record_code', 'line_number'] }),
    );

    expect(check.upToDate).toBe(false);
    expect(check.missing).toHaveLength(1);
    expect(check.missing[0]?.table).toBe('audit_finding_evidence');

    const aviso = describeSchemaCheck(check);
    expect(aviso).toContain(OUTDATED_DATABASE_MESSAGE);
    expect(aviso).toContain(REQUIRED_MIGRATION);
    expect(aviso).toContain('audit_finding_evidence');
  });

  it('erro alheio a coluna não é confundido com banco desatualizado', async () => {
    const client = {
      from() {
        return {
          select() {
            return {
              limit: () =>
                Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } }),
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    const check = await checkSchema(client);
    // Não conseguir conferir não é o mesmo que confirmar que falta migração.
    expect(check.upToDate).toBe(true);
    expect(check.unchecked.length).toBeGreaterThan(0);
  });

  it('cobre todas as tabelas que a fase 3 alterou', () => {
    expect(Object.keys(REQUIRED_COLUMNS).sort()).toEqual([
      'audit_finding_evidence',
      'audit_findings',
      'invoices',
      'organization_settings',
    ]);
  });
});

describe('tradução do erro de gravação', () => {
  it('coluna inexistente vira instrução, não repasse do texto do banco', () => {
    const mensagem = describeWriteError('A gravação das evidências', {
      code: 'PGRST204',
      message: "Could not find the 'field_name' column of 'audit_finding_evidence'",
    });

    expect(mensagem).toContain(OUTDATED_DATABASE_MESSAGE);
    expect(mensagem).toContain(REQUIRED_MIGRATION);
    expect(mensagem).toContain('A gravação das evidências');
  });

  it('reconhece a mensagem do PostgreSQL mesmo sem o código', () => {
    const mensagem = describeWriteError('A gravação dos documentos', {
      message: 'column "purpose" of relation "invoices" does not exist',
    });

    expect(mensagem).toContain(OUTDATED_DATABASE_MESSAGE);
  });

  it('erro comum mantém a mensagem original com contexto', () => {
    const mensagem = describeWriteError('A gravação das divergências', {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    });

    expect(mensagem).not.toContain(OUTDATED_DATABASE_MESSAGE);
    expect(mensagem).toBe('A gravação das divergências: duplicate key value violates unique constraint');
  });
});
