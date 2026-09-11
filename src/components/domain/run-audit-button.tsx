'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Triggers the audit pipeline and refreshes the workspace with the result. */
export function RunAuditButton({
  auditId,
  disabled,
  label = 'Iniciar auditoria',
}: {
  auditId: string;
  disabled?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auditorias/${auditId}/processar`, { method: 'POST' });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Falha ao processar a auditoria.');
        return;
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao processar a auditoria.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="gold" size="lg" disabled={disabled || busy} onClick={run}>
        {busy ? (
          <>
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Processando...
          </>
        ) : (
          <>
            <Play size={15} aria-hidden />
            {label}
          </>
        )}
      </Button>
      {error ? <p className="max-w-sm text-right text-xs text-danger">{error}</p> : null}
    </div>
  );
}
