'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { EMPTY_FORM_STATE } from '@/lib/ui/form-state';
import { addFindingCommentAction } from '@/app/(app)/auditorias/actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>
      {pending ? 'Registrando...' : 'Adicionar observação'}
    </Button>
  );
}

export function CommentForm({ findingId }: { findingId: string }) {
  const [state, formAction] = useActionState(addFindingCommentAction, EMPTY_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await formAction(formData);
        formRef.current?.reset();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="findingId" value={findingId} />
      <Textarea name="body" placeholder="Registrar análise, contato com o cliente, pendência..." maxLength={2000} />
      {state.error ? <p className="text-xs text-danger">{state.error}</p> : null}
      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
