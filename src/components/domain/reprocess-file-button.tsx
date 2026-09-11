'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Reinterpreta o arquivo já armazenado, sem novo upload (requisito 13). */
export function ReprocessFileButton({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/arquivos/${fileId}/reprocessar`, { method: 'POST' });
      const payload = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) setError(payload.error ?? 'Falha ao reprocessar o arquivo.');
      else {
        setMessage(payload.message ?? 'Arquivo reprocessado.');
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao reprocessar o arquivo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="secondary" onClick={run} disabled={busy}>
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin" aria-hidden />
            Reprocessando...
          </>
        ) : (
          <>
            <RefreshCw size={14} aria-hidden />
            Reprocessar arquivo
          </>
        )}
      </Button>
      {message ? <p className="max-w-sm text-right text-xs text-success">{message}</p> : null}
      {error ? <p className="max-w-sm text-right text-xs text-danger">{error}</p> : null}
    </div>
  );
}
