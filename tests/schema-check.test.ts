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

/**
 * Cliente que simula a tabela inteira ausente (0006 não aplicada), com o erro
 * exatamente como o PostgREST relata — diferente do erro de coluna ausente.
 */
function fakeClientMissingTable(table: string, code = 'PGRST205'): SupabaseClient {
  return {
    from(requested: string) {
      return {
        select() {
          return {
            limit() {
              const error: FakeError | null =
                requested === table
                  ? { code, message: `Could not find the table 'public.${table}' in the schema cache` }
                  : null;
              return Promise.resolve({ data: error ? null : [], error });
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

  it('cobre todas as tabelas que as fases 3 e 4 alteraram', () => {
    expect(Object.keys(REQUIRED_COLUMNS).sort()).toEqual([
      'audit_findings',
      'audit_finding_evidence',
      'document_validations',
      'invoices',
      'organization_settings',
    ].sort());
  });

  it('acusa a tabela inteira ausente quando a 0006 não foi aplicada, não apenas coluna', async () => {
    // document_validations é criada do zero pela 0006: uma instalação que só
    // aplicou até a 0005 não tem a tabela, e o erro do PostgREST para "tabela
    // não existe" é diferente do erro de "coluna não existe".
    const check = await checkSchema(fakeClientMissingTable('document_validations'));

    expect(check.upToDate).toBe(false);
    expect(check.missing.map((item) => item.table)).toContain('document_validations');
    // Crucial: não pode cair em "unchecked", que soaria como banco em dia.
    expect(check.unchecked.find((item) => item.table === 'document_validations')).toBeUndefined();

    const aviso = describeSchemaCheck(check);
    expect(aviso).toContain('document_validations');
    expect(aviso).toContain('0006_fase4_validacao_tecnica.sql');
  });

  it('reconhece também o SQLSTATE de tabela ausente (42P01), não só o do PostgREST', async () => {
    const check = await checkSchema(fakeClientMissingTable('document_validations', '42P01'));
    expect(check.missing.map((item) => item.table)).toContain('document_validations');
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

  it('tabela inteira ausente também vira instrução, não repasse cru do PostgREST', () => {
    const mensagem = describeWriteError('A gravação da conferência do documento', {
      code: 'PGRST205',
      message: "Could not find the table 'public.document_validations' in the schema cache",
    });

    expect(mensagem).toContain(OUTDATED_DATABASE_MESSAGE);
    expect(mensagem).toContain('0006_fase4_validacao_tecnica.sql');
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
