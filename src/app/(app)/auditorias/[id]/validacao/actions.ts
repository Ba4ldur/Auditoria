'use server';

import { revalidatePath } from 'next/cache';
import { describeError } from '@/lib/core/result';
import { requireUser } from '@/lib/auth/guard';
import { getStore } from '@/lib/data';
import {
  DOCUMENT_VALIDATION_STATUSES,
  type DocumentValidationStatus,
} from '@/lib/domain/entities';
import { submittedValues, type FormState } from '@/lib/ui/form-state';

/**
 * Registra a conferência manual de um documento durante a validação técnica.
 *
 * Grava quem conferiu e quando, a partir da sessão — nunca de um campo do
 * formulário. O valor de um registro de validação está em ser atribuível; um
 * nome digitado pelo próprio conferente não sustentaria isso.
 */
export async function saveDocumentValidationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const values = submittedValues(formData, ['status', 'note']);
  const auditId = String(formData.get('auditId') ?? '');
  const accessKey = String(formData.get('accessKey') ?? '').replace(/\D/g, '');
  const status = String(formData.get('status') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (auditId === '') return { error: 'Auditoria não identificada.', values };
  if (accessKey.length !== 44) {
    return { error: 'A conferência exige um documento com chave de acesso de 44 dígitos.', values };
  }
  if (!DOCUMENT_VALIDATION_STATUSES.includes(status as DocumentValidationStatus)) {
    return { error: 'Resultado da conferência inválido.', values };
  }
  // Apontar defeito sem dizer qual não orienta correção nenhuma.
  if (status !== 'CORRETO' && note === '') {
    return {
      error: 'Descreva o que foi observado. Conferência que aponta problema sem descrevê-lo não é acionável.',
      values,
    };
  }

  try {
    await getStore().upsertDocumentValidation({
      auditId,
      accessKey,
      status: status as DocumentValidationStatus,
      note: note === '' ? null : note,
      validatedBy: user.name,
    });
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath(`/auditorias/${auditId}/validacao`);
  revalidatePath(`/auditorias/${auditId}/documento/${accessKey}`);
  return { error: null, success: 'Conferência registrada.' };
}
