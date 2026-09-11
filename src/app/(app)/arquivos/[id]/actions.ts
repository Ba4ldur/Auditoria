'use server';

import { revalidatePath } from 'next/cache';
import { describeError } from '@/lib/core/result';
import { requireUser } from '@/lib/auth/guard';
import { getStore } from '@/lib/data';
import { validateConfirmation } from '@/lib/pipeline/confirmations';
import { submittedValues, type FormState } from '@/lib/ui/form-state';

/**
 * Confirma manualmente um campo extraído de um documento.
 *
 * A correção atua somente na camada normalizada — o arquivo original nunca é
 * alterado (requisito 11).
 */
export async function confirmFieldAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const values = submittedValues(formData, ['field', 'confirmedValue', 'note']);

  const fileId = String(formData.get('fileId') ?? '');
  const auditId = String(formData.get('auditId') ?? '');
  const originalValue = String(formData.get('originalValue') ?? '').trim() || null;
  const field = values.field ?? '';
  const confirmedValue = values.confirmedValue ?? '';

  if (fileId === '' || auditId === '') return { error: 'Arquivo não identificado.', values };

  const invalid = validateConfirmation(field, confirmedValue);
  if (invalid) return { error: invalid, values };

  try {
    await getStore().upsertFieldConfirmation({
      auditId,
      fileId,
      field,
      originalValue,
      confirmedValue: confirmedValue.trim(),
      confirmedBy: user.name,
      note: values.note?.trim() || null,
    });
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath(`/arquivos/${fileId}`);
  return {
    error: null,
    success: 'Valor confirmado. Reprocesse a auditoria para aplicá-lo aos cruzamentos.',
  };
}

export async function removeConfirmationAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = String(formData.get('confirmationId') ?? '');
  const fileId = String(formData.get('fileId') ?? '');
  if (id === '') return;
  await getStore().deleteFieldConfirmation(id);
  revalidatePath(`/arquivos/${fileId}`);
}
