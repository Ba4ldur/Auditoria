/**
 * Conferência manual de documentos (fase 4) — persistência local e mapeamento
 * do Supabase.
 *
 * A distinção entre os quatro estados é o ponto central: `PARSER_INCORRETO`
 * aponta para o leitor do arquivo, `CRUZAMENTO_INCORRETO` aponta para a regra,
 * `REQUER_ANALISE` não conclui, e `CORRETO` fecha o ponto. Um teste por estado
 * garante que a gravação e a releitura preservam qual dos quatro foi escolhido
 * — não apenas que "algum status" sobrevive à volta ao banco.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '@/lib/data/local-store';
import { toDocumentValidation } from '@/lib/data/supabase-mappers';
import { DOCUMENT_VALIDATION_STATUSES, type DocumentValidationStatus } from '@/lib/domain/entities';

async function freshStore(): Promise<{ store: LocalStore; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'attivare-validacao-'));
  const store = new LocalStore(join(dir, 'store.json'));
  return { store, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

describe('persistência local de document_validations', () => {
  it.each(DOCUMENT_VALIDATION_STATUSES)('grava e relê o estado %s', async (status: DocumentValidationStatus) => {
    const { store, cleanup } = await freshStore();
    cleanups.push(cleanup);

    const saved = await store.upsertDocumentValidation({
      auditId: 'audit-1',
      accessKey: '1'.repeat(44),
      status,
      note: status === 'CORRETO' ? null : `Observação para ${status}`,
      validatedBy: 'Contador de Teste',
    });

    expect(saved.status).toBe(status);
    expect(saved.id).toBeTruthy();
    expect(saved.validatedAt).toBeTruthy();

    const relido = await store.listDocumentValidations('audit-1');
    expect(relido).toHaveLength(1);
    expect(relido[0]?.status).toBe(status);
    expect(relido[0]?.accessKey).toBe('1'.repeat(44));
    expect(relido[0]?.validatedBy).toBe('Contador de Teste');
  });

  it('reconferir o mesmo documento substitui o registro, não acumula histórico', async () => {
    const { store, cleanup } = await freshStore();
    cleanups.push(cleanup);

    const chave = '2'.repeat(44);
    await store.upsertDocumentValidation({
      auditId: 'audit-1',
      accessKey: chave,
      status: 'REQUER_ANALISE',
      note: 'Primeira passagem',
      validatedBy: 'Contador A',
    });
    const segunda = await store.upsertDocumentValidation({
      auditId: 'audit-1',
      accessKey: chave,
      status: 'CORRETO',
      note: null,
      validatedBy: 'Contador B',
    });

    const todas = await store.listDocumentValidations('audit-1');
    expect(todas).toHaveLength(1);
    expect(todas[0]?.id).toBe(segunda.id);
    expect(todas[0]?.status).toBe('CORRETO');
    expect(todas[0]?.validatedBy).toBe('Contador B');
    // A conferência anterior não sobra como um registro separado.
    expect(todas[0]?.note).toBeNull();
  });

  it('documentos de auditorias diferentes não se misturam', async () => {
    const { store, cleanup } = await freshStore();
    cleanups.push(cleanup);

    await store.upsertDocumentValidation({
      auditId: 'audit-1',
      accessKey: '3'.repeat(44),
      status: 'CORRETO',
      note: null,
      validatedBy: 'Contador',
    });
    await store.upsertDocumentValidation({
      auditId: 'audit-2',
      accessKey: '3'.repeat(44), // mesma chave, outra auditoria
      status: 'PARSER_INCORRETO',
      note: 'Campo lido errado',
      validatedBy: 'Contador',
    });

    expect(await store.listDocumentValidations('audit-1')).toHaveLength(1);
    expect(await store.listDocumentValidations('audit-2')).toHaveLength(1);
    expect((await store.listDocumentValidations('audit-1'))[0]?.status).toBe('CORRETO');
    expect((await store.listDocumentValidations('audit-2'))[0]?.status).toBe('PARSER_INCORRETO');
  });

  it('a listagem vem ordenada por chave de acesso', async () => {
    const { store, cleanup } = await freshStore();
    cleanups.push(cleanup);

    for (const digit of ['9', '1', '5']) {
      await store.upsertDocumentValidation({
        auditId: 'audit-1',
        accessKey: digit.repeat(44),
        status: 'CORRETO',
        note: null,
        validatedBy: 'Contador',
      });
    }

    const chaves = (await store.listDocumentValidations('audit-1')).map((entry) => entry.accessKey);
    expect(chaves).toEqual([...chaves].sort());
  });
});

describe('mapeamento Supabase → DocumentValidation', () => {
  it('converte a linha do banco preservando os quatro estados possíveis', () => {
    for (const status of DOCUMENT_VALIDATION_STATUSES) {
      const mapped = toDocumentValidation({
        id: 'id-1',
        organization_id: 'org-1',
        audit_id: 'audit-1',
        access_key: '7'.repeat(44),
        status,
        note: status === 'CORRETO' ? null : 'observação',
        validated_by: 'Contador',
        validated_at: '2026-09-10T12:00:00.000Z',
      });
      expect(mapped.status).toBe(status);
    }
  });

  it('nota ausente vira null, não string vazia', () => {
    const mapped = toDocumentValidation({
      id: 'id-1',
      organization_id: 'org-1',
      audit_id: 'audit-1',
      access_key: '7'.repeat(44),
      status: 'CORRETO',
      note: null,
      validated_by: 'Contador',
      validated_at: '2026-09-10T12:00:00.000Z',
    });
    expect(mapped.note).toBeNull();
  });
});
