'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SeedResponse {
  readonly auditId?: string;
  readonly score?: number;
  readonly planted?: string[];
  readonly alreadyExisted?: boolean;
  readonly error?: string;
}

/**
 * Creates the demonstration company and audit by running the real pipeline over
 * generated fictitious files.
 */
export function SeedDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeedResponse | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch('/api/demo', { method: 'POST' });
      const payload = (await response.json()) as SeedResponse;
      setResult(payload);
      if (response.ok) router.refresh();
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : 'Falha ao gerar os dados.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" onClick={run} disabled={busy}>
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin" aria-hidden />
            Gerando...
          </>
        ) : (
          <>
            <Sparkles size={14} aria-hidden />
            Carregar dados de demonstração
          </>
        )}
      </Button>

      {result?.error ? (
        <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          {result.error}
        </p>
      ) : null}

      {result?.auditId ? (
        <div className="rounded-md border border-success/25 bg-success-soft px-3 py-2.5 text-xs text-success">
          <p className="font-semibold">
            {result.alreadyExisted
              ? 'A auditoria de demonstração já existia.'
              : `Auditoria de demonstração processada. Score ${result.score}/100.`}
          </p>
          {result.planted && result.planted.length > 0 ? (
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-ink-muted">
              {result.planted.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <a
            href={`/auditorias/${result.auditId}`}
            className="mt-2 inline-block font-semibold text-navy-700 underline"
          >
            Abrir a auditoria de demonstração
          </a>
        </div>
      ) : null}
    </div>
  );
}
