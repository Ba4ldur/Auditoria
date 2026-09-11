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

  try {
    await getStore().saveSettings({ scoreWeights: weights as ScoreWeights });
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath('/configuracoes');
  return { error: null, success: 'Pesos do score atualizados. Reprocesse as auditorias para aplicar.' };
}

export async function saveRevenuePolicyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();

  const values = submittedValues(formData, ['cfopExclusions']);
  const raw = String(formData.get('cfopExclusions') ?? '');
  const codes = raw
    .split(/[\s,;]+/)
    .map((code) => code.trim())
    .filter((code) => code !== '');

  const invalid = codes.filter((code) => !/^\d{4}$/.test(code));
  if (invalid.length > 0) {
    return {
      error: `CFOP inválido: ${invalid.join(', ')}. Informe códigos de 4 dígitos.`,
      values,
    };
  }

  try {
    await getStore().saveSettings({ revenueCfopExclusions: [...new Set(codes)].sort() });
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath('/configuracoes');
  return {
    error: null,
    success: 'Política de composição da receita atualizada. Reprocesse as auditorias para aplicar.',
  };
}
