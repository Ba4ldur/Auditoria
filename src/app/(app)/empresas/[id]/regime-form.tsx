'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Notice } from '@/components/ui/page';
import { TAX_REGIME_LABELS, TAX_REGIMES, type TaxRegime } from '@/lib/domain/model';
import { EMPTY_FORM_STATE } from '@/lib/ui/form-state';
import { addRegimeHistoryAction } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? 'Registrando...' : 'Registrar período'}
    </Button>
  );
}

export function RegimeForm({ companyId, currentRegime }: { companyId: string; currentRegime: TaxRegime }) {
  const [state, formAction] = useActionState(addRegimeHistoryAction, EMPTY_FORM_STATE);
  const submitted = state.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Regime" htmlFor="regime-taxRegime" required>
          <Select
            id="regime-taxRegime"
            name="taxRegime"
            defaultValue={submitted.taxRegime ?? currentRegime}
            required
          >
            {TAX_REGIMES.map((regime) => (
              <option key={regime} value={regime}>
                {TAX_REGIME_LABELS[regime]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vigente desde" htmlFor="regime-validFrom" required hint="MM/AAAA">
          <Input
            id="regime-validFrom"
            name="validFrom"
            placeholder="01/2026"
            defaultValue={submitted.validFrom ?? ''}
            required
          />
        </Field>
        <Field label="Vigente até" htmlFor="regime-validTo" hint="Deixe vazio se em vigor">
          <Input
            id="regime-validTo"
            name="validTo"
            placeholder="12/2026"
            defaultValue={submitted.validTo ?? ''}
          />
        </Field>
        <Field label="Observação" htmlFor="regime-note">
          <Input id="regime-note" name="note" maxLength={200} defaultValue={submitted.note ?? ''} />
        </Field>
      </div>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
