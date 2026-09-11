'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the server log so a failed render can be traced by digest.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="max-w-lg text-center">
        <p className="text-[0.6875rem] font-semibold tracking-[0.2em] text-gold-600 uppercase">
          Attivare Auditor
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Não foi possível carregar esta tela</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {error.message || 'Ocorreu um erro inesperado ao processar a requisição.'}
        </p>
        {error.digest ? (
          <p className="mt-1 font-mono text-xs text-ink-subtle">Referencia: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={reset}>Tentar novamente</Button>
        </div>
      </div>
    </main>
  );
}
