'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseCompetencia } from '@/lib/core/competencia';
import { describeError } from '@/lib/core/result';
import { requireUser } from '@/lib/auth/guard';
import { getStorage, getStore } from '@/lib/data';
import { REVIEW_STATUSES, type ReviewStatus } from '@/lib/domain/entities';
import { submittedValues, type FormState } from '@/lib/ui/form-state';

export async function createAuditAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();

  const values = submittedValues(formData, ['companyId', 'competencia', 'notes']);
  const companyId = String(formData.get('companyId') ?? '');
  const competencia = parseCompetencia(String(formData.get('competencia') ?? ''));

  if (companyId === '') return { error: 'Selecione a empresa.', values };
  if (!competencia) return { error: 'Informe a competência no formato MM/AAAA.', values };

  const store = getStore();
  const company = await store.getCompany(companyId);
  if (!company) return { error: 'Empresa não encontrada.', values };

  const existing = (await store.listAudits({ companyId })).find(
    (audit) => audit.competencia === competencia,
  );
  if (existing) {
    redirect(`/auditorias/${existing.id}`);
  }

  let auditId: string;
  try {
    const audit = await store.createAudit({
      companyId,
      competencia,
      notes: String(formData.get('notes') ?? '').trim() || null,
    });
    auditId = audit.id;
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath('/auditorias');
  revalidatePath('/dashboard');
  redirect(`/auditorias/${auditId}`);
}

export async function deleteAuditAction(formData: FormData): Promise<void> {
  await requireUser();
  const auditId = String(formData.get('auditId') ?? '');
  if (auditId === '') return;

  const store = getStore();
  const storage = getStorage();
  const files = await store.listFiles(auditId);

  for (const file of files) {
    if (!file.storagePath) continue;
    try {
      await storage.remove(file.storagePath);
    } catch {
      // Removing the audit must succeed even when a storage object is already gone.
    }
  }

  await store.deleteAudit(auditId);
  revalidatePath('/auditorias');
  revalidatePath('/dashboard');
  redirect('/auditorias');
}

export async function updateFindingReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const values = submittedValues(formData, ['reviewStatus', 'reviewNote']);
  const findingId = String(formData.get('findingId') ?? '');
  const reviewStatus = String(formData.get('reviewStatus') ?? '');
  const reviewNote = String(formData.get('reviewNote') ?? '').trim();

  if (findingId === '') return { error: 'Divergência não identificada.', values };
  if (!REVIEW_STATUSES.includes(reviewStatus as ReviewStatus)) {
    return { error: 'Status de análise inválido.', values };
  }

  try {
    await getStore().updateFindingReview(findingId, {
      reviewStatus: reviewStatus as ReviewStatus,
      reviewNote: reviewNote === '' ? null : reviewNote,
      reviewer: user.name,
    });
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath('/divergencias');
  revalidatePath('/dashboard');
  return { error: null, success: 'Classificação registrada.' };
}

export async function addFindingCommentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const findingId = String(formData.get('findingId') ?? '');
  const body = String(formData.get('body') ?? '').trim();

  if (findingId === '') return { error: 'Divergência não identificada.' };
  if (body === '') return { error: 'Escreva a observação antes de enviar.', values: { body } };

  try {
    await getStore().addComment(findingId, user.name, body);
  } catch (error) {
    return { error: describeError(error), values: { body } };
  }

  revalidatePath('/divergencias');
  return { error: null, success: 'Observação registrada.' };
}
