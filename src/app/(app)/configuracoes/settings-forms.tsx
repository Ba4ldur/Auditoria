'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Notice } from '@/components/ui/page';
import { SEVERITIES, SEVERITY_LABELS, type ScoreWeights } from '@/lib/domain/entities';
import { EMPTY_FORM_STATE } from '@/lib/ui/form-state';
import { saveScoreWeightsAction } from './actions';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Salvando...' : label}
    </Button>
  );
}

export function ScoreWeightsForm({
  weights,
  indicioFactor,
}: {
  weights: ScoreWeights;
  indicioFactor: number;
}) {
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

      <Field
        label="Fator de indício"
        htmlFor="indicio_factor"
        hint="Multiplica o peso da gravidade nas ocorrências de natureza indício, cuja leitura fiscal depende de análise humana. 0 ignora indícios; 1 os pesa como divergência confirmada."
      >
        <Input
          id="indicio_factor"
          name="indicio_factor"
          defaultValue={submitted.indicio_factor ?? String(indicioFactor)}
          inputMode="decimal"
        />
      </Field>

      <div className="flex justify-end">
        <SubmitButton label="Salvar pesos" />
      </div>
    </form>
  );
}
