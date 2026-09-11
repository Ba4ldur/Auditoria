'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/page';
import { formatCnpj } from '@/lib/core/cnpj';
import { EMPTY_FORM_STATE } from '@/lib/ui/form-state';
import { createAuditAction } from '../actions';

export interface CompanyOption {
  readonly id: string;
  readonly legalName: string;
  readonly cnpj: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="gold" size="lg" disabled={pending}>
      {pending ? 'Criando...' : 'Criar auditoria'}
    </Button>
  );
}

export function NewAuditForm({
  companies,
  defaultCompanyId,
  defaultCompetencia,
}: {
  companies: readonly CompanyOption[];
  defaultCompanyId: string;
  defaultCompetencia: string;
}) {
  const [state, formAction] = useActionState(createAuditAction, EMPTY_FORM_STATE);
  const submitted = state.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      <Field label="Empresa" htmlFor="companyId" required>
        <Select
          id="companyId"
          name="companyId"
          defaultValue={submitted.companyId ?? defaultCompanyId}
          required
        >
          <option value="">Selecione a empresa auditada</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.legalName} — {formatCnpj(company.cnpj)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Competência"
        htmlFor="competencia"
        required
        hint="Formato MM/AAAA. Arquivos de outra competência são sinalizados na importação."
      >
        <Input
          id="competencia"
          name="competencia"
          placeholder="08/2026"
          defaultValue={submitted.competencia ?? defaultCompetencia}
          required
        />
      </Field>

      <Field label="Observações" htmlFor="notes" hint="Opcional. Contexto do trabalho, escopo acordado, pendências.">
        <Textarea id="notes" name="notes" maxLength={1000} defaultValue={submitted.notes ?? ''} />
      </Field>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
