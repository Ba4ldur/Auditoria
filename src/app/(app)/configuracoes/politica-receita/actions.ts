'use server';

import { revalidatePath } from 'next/cache';
import { describeError } from '@/lib/core/result';
import { requireUser } from '@/lib/auth/guard';
import { getStore } from '@/lib/data';
import { CFOP_TREATMENTS, type CfopTreatment } from '@/lib/domain/entities';
import { submittedValues, type FormState } from '@/lib/ui/form-state';

export async function saveCfopRuleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const values = submittedValues(formData, ['cfop', 'description', 'treatment', 'reason']);

  const cfop = values.cfop?.replace(/\D/g, '') ?? '';
  const treatment = values.treatment ?? '';

  if (!/^\d{4}$/.test(cfop)) {
    return { error: 'Informe um CFOP de 4 dígitos.', values };
  }
  if (!CFOP_TREATMENTS.includes(treatment as CfopTreatment)) {
    return { error: 'Tratamento inválido.', values };
  }

  try {
    await getStore().upsertCfopRule({
      cfop,
      description: values.description?.trim() || null,
      treatment: treatment as CfopTreatment,
      reason: values.reason?.trim() || null,
      updatedBy: user.name,
    });
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath('/configuracoes/politica-receita');
  return { error: null, success: `CFOP ${cfop} classificado como ${treatment.toLowerCase()}.` };
}

export async function deleteCfopRuleAction(formData: FormData): Promise<void> {
  await requireUser();
  const cfop = String(formData.get('cfop') ?? '');
  if (cfop === '') return;
  await getStore().deleteCfopRule(cfop);
  revalidatePath('/configuracoes/politica-receita');
}
