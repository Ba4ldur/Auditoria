'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

/** Removes an imported file from the audit, including its stored object. */
export function DeleteFileButton({ auditId, fileId }: { auditId: string; fileId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await fetch(`/api/auditorias/${auditId}/arquivos?arquivo=${fileId}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      aria-label="Remover arquivo da auditoria"
      title="Remover arquivo da auditoria"
      className="rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
    >
      <Trash2 size={15} aria-hidden />
    </button>
  );
}
