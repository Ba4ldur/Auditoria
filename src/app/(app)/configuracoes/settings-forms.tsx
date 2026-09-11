'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/page';
import { SEVERITIES, SEVERITY_LABELS, type ScoreWeights } from '@/lib/domain/entities';
import { EMPTY_FORM_STATE } from '@/lib/ui/form-state';
import { saveRevenuePolicyAction, saveScoreWeightsAction } from './actions';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Salvando...' : label}
    </Button>
  );
}

export function ScoreWeightsForm({ weights }: { weights: ScoreWeights }) {
  const [state, formAction] = useActionState(saveScoreWeightsAction, EMPTY_FORM_STATE);
  const submitted = state.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SEVERITIES.map((severity) => (
          <Field key={severity} label={SEVERITY_LABELS[severity]} htmlFor={`weight_${severity}`}>
            <Input
              id={`weight_${severity}`}
              name={`weight_${severity}`}
              defaultValue={submitted[`weight_${severity}`] ?? String(weights[severity])}
              inputMode="decimal"
            />
          </Field>
        ))}
      </div>

      <div className="flex justify-end">
        <SubmitButton label="Salvar pesos" />
      </div>
    </form>
  );
}

export function RevenuePolicyForm({ exclusions }: { exclusions: readonly string[] }) {
  const [state, formAction] = useActionState(saveRevenuePolicyAction, EMPTY_FORM_STATE);
  const submitted = state.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}

      <Field
        label="CFOPs excluidos do faturamento"
        htmlFor="cfopExclusions"
        hint="Separe por virgula, espaco ou quebra de linha. Vazio significa que nenhum CFOP e excluido."
      >
        <Textarea
          id="cfopExclusions"
          name="cfopExclusions"
          defaultValue={submitted.cfopExclusions ?? exclusions.join(', ')}
          placeholder="5202, 6202, 5152"
        />
      </Field>

      <div className="flex justify-end">
        <SubmitButton label="Salvar política" />
      </div>
    </form>
  );
}
