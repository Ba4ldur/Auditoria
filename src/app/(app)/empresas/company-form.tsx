'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Notice } from '@/components/ui/page';
import { TAX_REGIME_LABELS, TAX_REGIMES, type TaxRegime } from '@/lib/domain/model';
import { UF_LIST } from '@/lib/core/nfe-key';
import { EMPTY_FORM_STATE, type FormState } from '@/lib/ui/form-state';

export interface CompanyFormValues {
  readonly id?: string;
  readonly legalName: string;
  readonly tradeName: string;
  readonly cnpj: string;
  readonly stateRegistration: string;
  readonly municipalRegistration: string;
  readonly uf: string;
  readonly municipality: string;
  readonly taxRegime: TaxRegime;
}

export const BLANK_COMPANY: CompanyFormValues = {
  legalName: '',
  tradeName: '',
  cnpj: '',
  stateRegistration: '',
  municipalRegistration: '',
  uf: 'SP',
  municipality: '',
  taxRegime: 'SIMPLES_NACIONAL',
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Salvando...' : label}
    </Button>
  );
}

export function CompanyForm({
  action,
  values,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  values: CompanyFormValues;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const errors = state.fieldErrors ?? {};
  // O React reinicia os campos apos a acao; sem reaproveitar o que foi enviado,
  // um erro de validacao apagaria o cadastro inteiro.
  const submitted = state.values ?? {};
  const initial = (field: keyof CompanyFormValues): string =>
    submitted[field] ?? String(values[field] ?? '');

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Razão social" htmlFor="legalName" required error={errors.legalName} className="md:col-span-2">
          <Input id="legalName" name="legalName" defaultValue={initial('legalName')} required maxLength={200} />
        </Field>

        <Field label="Nome fantasia" htmlFor="tradeName" error={errors.tradeName}>
          <Input id="tradeName" name="tradeName" defaultValue={initial('tradeName')} maxLength={200} />
        </Field>

        <Field
          label="CNPJ"
          htmlFor="cnpj"
          required
          error={errors.cnpj}
          hint="Somente números ou com pontuacao."
        >
          <Input id="cnpj" name="cnpj" defaultValue={initial('cnpj')} required maxLength={18} inputMode="numeric" />
        </Field>

        <Field label="Inscrição estadual" htmlFor="stateRegistration" error={errors.stateRegistration}>
          <Input id="stateRegistration" name="stateRegistration" defaultValue={initial('stateRegistration')} maxLength={20} />
        </Field>

        <Field label="Inscrição municipal" htmlFor="municipalRegistration" error={errors.municipalRegistration}>
          <Input
            id="municipalRegistration"
            name="municipalRegistration"
            defaultValue={initial('municipalRegistration')}
            maxLength={20}
          />
        </Field>

        <Field label="UF" htmlFor="uf" required error={errors.uf}>
          <Select id="uf" name="uf" defaultValue={initial('uf')} required>
            {UF_LIST.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Município" htmlFor="municipality" error={errors.municipality}>
          <Input id="municipality" name="municipality" defaultValue={initial('municipality')} maxLength={120} />
        </Field>

        <Field
          label="Regime tributário"
          htmlFor="taxRegime"
          required
          error={errors.taxRegime}
          className="md:col-span-2"
          hint="O regime influencia quais regras de auditoria são aplicáveis."
        >
          <Select id="taxRegime" name="taxRegime" defaultValue={initial('taxRegime')} required>
            {TAX_REGIMES.map((regime) => (
              <option key={regime} value={regime}>
                {TAX_REGIME_LABELS[regime]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex justify-end">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
