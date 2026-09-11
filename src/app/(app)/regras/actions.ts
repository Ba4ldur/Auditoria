'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parseDecimalToCents } from '@/lib/core/money';
import { describeError } from '@/lib/core/result';
import { requireUser } from '@/lib/auth/guard';
import { getStore } from '@/lib/data';
import { SEVERITIES, type Severity } from '@/lib/domain/entities';
import { ruleByCode } from '@/lib/audit-engine';
import { submittedValues, type FormState } from '@/lib/ui/form-state';

const schema = z.object({
  ruleCode: z.string().min(1),
  enabled: z.boolean(),
  severity: z.string(),
  absoluteTolerance: z.string(),
  percentageTolerance: z.string(),
});

export async function saveRuleSettingAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();

  const values = submittedValues(formData, ['severity', 'absoluteTolerance', 'percentageTolerance']);
  const parsed = schema.safeParse({
    ruleCode: String(formData.get('ruleCode') ?? ''),
    enabled: formData.get('enabled') === 'on',
    severity: String(formData.get('severity') ?? ''),
    absoluteTolerance: String(formData.get('absoluteTolerance') ?? ''),
    percentageTolerance: String(formData.get('percentageTolerance') ?? ''),
  });

  if (!parsed.success) return { error: 'Dados inválidos.', values };

  const rule = ruleByCode(parsed.data.ruleCode);
  if (!rule) return { error: `Regra ${parsed.data.ruleCode} não encontrada.`, values };

  if (parsed.data.severity !== '' && !SEVERITIES.includes(parsed.data.severity as Severity)) {
    return { error: 'Gravidade inválida.', values };
  }

  const absolute = parseDecimalToCents(parsed.data.absoluteTolerance);
  if (parsed.data.absoluteTolerance.trim() !== '' && absolute === null) {
    return { error: 'Tolerância absoluta inválida. Use o formato 0,05.', values };
  }

  const percentage = Number(parsed.data.percentageTolerance.replace(',', '.'));
  if (parsed.data.percentageTolerance.trim() !== '' && !Number.isFinite(percentage)) {
    return { error: 'Tolerância percentual inválida.', values };
  }
  if (Number.isFinite(percentage) && (percentage < 0 || percentage > 100)) {
    return { error: 'Tolerância percentual deve estar entre 0 e 100.', values };
  }

  try {
    await getStore().upsertRuleSetting({
      ruleCode: parsed.data.ruleCode,
      enabled: parsed.data.enabled,
      severity: parsed.data.severity === '' ? null : (parsed.data.severity as Severity),
      absoluteToleranceCents: absolute,
      percentageTolerance: parsed.data.percentageTolerance.trim() === '' ? null : percentage,
    });
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath('/regras');
  return { error: null, success: `Configuração de ${parsed.data.ruleCode} salva.` };
}
