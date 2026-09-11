'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { SEVERITIES, SEVERITY_LABELS, type Severity } from '@/lib/domain/entities';
import { EMPTY_FORM_STATE } from '@/lib/ui/form-state';
import { saveRuleSettingAction } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>
      {pending ? 'Salvando...' : 'Salvar'}
    </Button>
  );
}

/** Per-rule overrides: activation, severity and tolerance (requirements 16 and 18). */
export function RuleSettingsForm({
  ruleCode,
  enabled,
  severity,
  defaultSeverity,
  absoluteTolerance,
  percentageTolerance,
}: {
  ruleCode: string;
  enabled: boolean;
  severity: Severity | null;
  defaultSeverity: Severity;
  absoluteTolerance: string;
  percentageTolerance: string;
}) {
  const [state, formAction] = useActionState(saveRuleSettingAction, EMPTY_FORM_STATE);
  const submitted = state.values ?? {};

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[auto_1fr_1fr_1fr_auto] lg:items-end">
      <input type="hidden" name="ruleCode" value={ruleCode} />

      <label className="flex items-center gap-2 pb-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          className="h-4 w-4 rounded border-line-strong accent-[var(--color-navy-700)]"
        />
        Ativa
      </label>

      <Field label="Gravidade" htmlFor={`sev-${ruleCode}`}>
        <Select id={`sev-${ruleCode}`} name="severity" defaultValue={submitted.severity ?? severity ?? ''}>
          <option value="">Padrão ({SEVERITY_LABELS[defaultSeverity]})</option>
          {SEVERITIES.map((item) => (
            <option key={item} value={item}>
              {SEVERITY_LABELS[item]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Tolerância absoluta (R$)" htmlFor={`abs-${ruleCode}`}>
        <Input id={`abs-${ruleCode}`} name="absoluteTolerance" defaultValue={submitted.absoluteTolerance ?? absoluteTolerance} inputMode="decimal" />
      </Field>

      <Field label="Tolerância percentual (%)" htmlFor={`pct-${ruleCode}`}>
        <Input
          id={`pct-${ruleCode}`}
          name="percentageTolerance"
          defaultValue={submitted.percentageTolerance ?? percentageTolerance}
          inputMode="decimal"
        />
      </Field>

      <div className="flex items-center gap-3 pb-0.5">
        <SubmitButton />
        {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
        {state.success ? <span className="text-xs text-success">Salvo</span> : null}
      </div>
    </form>
  );
}
