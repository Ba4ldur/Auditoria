'use server';

import { revalidatePath } from 'next/cache';
import { describeError } from '@/lib/core/result';
import { requireUser } from '@/lib/auth/guard';
import { getStore } from '@/lib/data';
import { SEVERITIES, type ScoreWeights, type Severity } from '@/lib/domain/entities';
import { submittedValues, type FormState } from '@/lib/ui/form-state';

export async function saveScoreWeightsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();

  const values = submittedValues(
    formData,
    SEVERITIES.map((severity) => `weight_${severity}`),
  );
  const weights: Partial<Record<Severity, number>> = {};
  for (const severity of SEVERITIES) {
    const raw = String(formData.get(`weight_${severity}`) ?? '');
    const value = Number(raw.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return {
        error: `Peso inválido para gravidade ${severity}. Use um número entre 0 e 100.`,
        values,
      };
    }
    weights[severity] = value;
  }

  const rawFactor = String(formData.get('indicio_factor') ?? '');
  const indicioFactor = Number(rawFactor.replace(',', '.'));
  if (!Number.isFinite(indicioFactor) || indicioFactor < 0 || indicioFactor > 1) {
    return {
      error: 'Fator de indício inválido. Use um número entre 0 e 1 (0,5 = metade do peso da gravidade).',
      values,
    };
  }

  try {
    await getStore().saveSettings({ scoreWeights: weights as ScoreWeights, indicioFactor });
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath('/configuracoes');
  return { error: null, success: 'Pesos do score atualizados. Reprocesse as auditorias para aplicar.' };
}
