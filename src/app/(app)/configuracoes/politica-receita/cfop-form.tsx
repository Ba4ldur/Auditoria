'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Notice } from '@/components/ui/page';
import { CFOP_TREATMENTS, CFOP_TREATMENT_LABELS } from '@/lib/domain/entities';
import { EMPTY_FORM_STATE } from '@/lib/ui/form-state';
import { saveCfopRuleAction } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Salvando...' : 'Classificar CFOP'}
    </Button>
  );
}

export function CfopRuleForm() {
  const [state, formAction] = useActionState(saveCfopRuleAction, EMPTY_FORM_STATE);
  const submitted = state.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="CFOP" htmlFor="cfop" required hint="Quatro dígitos, por exemplo 5102.">
          <Input id="cfop" name="cfop" defaultValue={submitted.cfop ?? ''} maxLength={9} required />
        </Field>

        <Field label="Descrição" htmlFor="description" hint="Como este CFOP é conhecido na empresa.">
          <Input id="description" name="description" defaultValue={submitted.description ?? ''} maxLength={160} />
        </Field>

        <Field label="Tratamento" htmlFor="treatment" required>
          <Select id="treatment" name="treatment" defaultValue={submitted.treatment ?? 'INCLUIR'} required>
            {CFOP_TREATMENTS.map((treatment) => (
              <option key={treatment} value={treatment}>
                {CFOP_TREATMENT_LABELS[treatment]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Motivo"
          htmlFor="reason"
          hint="Registrado junto de cada documento classificado por esta regra."
        >
          <Input id="reason" name="reason" defaultValue={submitted.reason ?? ''} maxLength={200} />
        </Field>
      </div>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
