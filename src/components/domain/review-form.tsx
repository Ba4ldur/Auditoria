'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import { REVIEW_STATUSES, REVIEW_STATUS_LABELS, type ReviewStatus } from '@/lib/domain/entities';
import { EMPTY_FORM_STATE } from '@/lib/ui/form-state';
import { updateFindingReviewAction } from '@/app/(app)/auditorias/actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Salvando...' : 'Salvar classificação'}
    </Button>
  );
}

/** Auditor workflow over a finding (requirement 22). */
export function ReviewForm({
  findingId,
  reviewStatus,
  reviewNote,
}: {
  findingId: string;
  reviewStatus: ReviewStatus;
  reviewNote: string;
}) {
  const [state, formAction] = useActionState(updateFindingReviewAction, EMPTY_FORM_STATE);
  const submitted = state.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="findingId" value={findingId} />

      <Field label="Situação da análise" htmlFor={`review-${findingId}`}>
        <Select
          id={`review-${findingId}`}
          name="reviewStatus"
          defaultValue={submitted.reviewStatus ?? reviewStatus}
        >
          {REVIEW_STATUSES.map((status) => (
            <option key={status} value={status}>
              {REVIEW_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Observação da análise" htmlFor={`note-${findingId}`}>
        <Textarea
          id={`note-${findingId}`}
          name="reviewNote"
          defaultValue={submitted.reviewNote ?? reviewNote}
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
