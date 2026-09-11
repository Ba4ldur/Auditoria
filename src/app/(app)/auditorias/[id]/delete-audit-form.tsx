'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { deleteAuditAction } from '../actions';

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" size="sm" disabled={pending}>
      {pending ? 'Excluindo...' : 'Excluir auditoria'}
    </Button>
  );
}

export function DeleteAuditForm({ auditId }: { auditId: string }) {
  return (
    <form
      action={deleteAuditAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            'Excluir esta auditoria, seus arquivos importados e todas as ocorrências apuradas?',
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="auditId" value={auditId} />
      <DeleteButton />
    </form>
  );
}
