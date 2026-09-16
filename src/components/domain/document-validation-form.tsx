'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { formatIsoDateTime } from '@/lib/core/dates';
import {
  DOCUMENT_VALIDATION_LABELS,
  DOCUMENT_VALIDATION_STATUSES,
  type DocumentValidation,
} from '@/lib/domain/entities';
import { EMPTY_FORM_STATE } from '@/lib/ui/form-state';
import { saveDocumentValidationAction } from '@/app/(app)/auditorias/[id]/validacao/actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Registrando...' : 'Registrar conferência'}
    </Button>
  );
}

/**
 * Conferência manual de um documento durante a validação técnica do motor.
 *
 * Os quatro estados não são graus de uma mesma escala: `PARSER_INCORRETO` aponta
 * defeito na leitura do arquivo e `CRUZAMENTO_INCORRETO` aponta defeito na
 * regra. São corrigidos em lugares diferentes, e por isso são registrados
 * separadamente.
 */
export function DocumentValidationForm({
  auditId,
  accessKey,
  current,
}: {
  auditId: string;
  accessKey: string;
  current: DocumentValidation | null;
}) {
  const [state, formAction] = useActionState(saveDocumentValidationAction, EMPTY_FORM_STATE);
  const submitted = state.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="auditId" value={auditId} />
      <input type="hidden" name="accessKey" value={accessKey} />

      {current ? (
        <p className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-ink-muted">
          <Badge tone={current.status === 'CORRETO' ? 'success' : 'gold'}>
            {DOCUMENT_VALIDATION_LABELS[current.status]}
          </Badge>
          <span>
            por {current.validatedBy} em {formatIsoDateTime(current.validatedAt)}
          </span>
        </p>
      ) : null}

      <Field label="Resultado da conferência" htmlFor={`validation-${accessKey}`}>
        <Select
          id={`validation-${accessKey}`}
          name="status"
          defaultValue={submitted.status ?? current?.status ?? 'CORRETO'}
        >
          {DOCUMENT_VALIDATION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {DOCUMENT_VALIDATION_LABELS[status]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Observação"
        htmlFor={`validation-note-${accessKey}`}
        hint="Obrigatória quando o resultado não for “Correto”: diga o que foi observado no arquivo original."
      >
        <Textarea
          id={`validation-note-${accessKey}`}
          name="note"
          defaultValue={submitted.note ?? current?.note ?? ''}
          maxLength={2000}
        />
      </Field>

      {state.error ? <p className="text-xs text-danger">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-success">{state.success}</p> : null}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
