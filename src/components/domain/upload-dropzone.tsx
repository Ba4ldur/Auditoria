'use client';

import { useCallback, useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CloudUpload, FileCheck2, FileWarning, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/ui/cn';

const ACCEPTED = '.xml,.zip,.txt,.pdf';

interface UploadResult {
  readonly name: string;
  readonly accepted: boolean;
  readonly message: string;
}

/**
 * Drag-and-drop upload area (requirement 8).
 *
 * Files are sent in small batches instead of one giant request, so a rejected
 * file is reported immediately and a slow connection does not lose the whole
 * selection.
 */
export function UploadDropzone({ auditId, disabled }: { auditId: string; disabled?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<readonly UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || busy) return;
      setBusy(true);
      setError(null);
      setResults([]);
      setProgress({ done: 0, total: files.length });

      const collected: UploadResult[] = [];
      const BATCH = 4;

      try {
        for (let index = 0; index < files.length; index += BATCH) {
          const batch = files.slice(index, index + BATCH);
          const form = new FormData();
          for (const file of batch) form.append('files', file);

          const response = await fetch(`/api/auditorias/${auditId}/arquivos`, {
            method: 'POST',
            body: form,
          });
          const payload = (await response.json()) as { results?: UploadResult[]; error?: string };

          if (!response.ok) {
            setError(payload.error ?? 'Falha no envio dos arquivos.');
            break;
          }
          collected.push(...(payload.results ?? []));
          setResults([...collected]);
          setProgress({ done: Math.min(index + BATCH, files.length), total: files.length });
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Falha no envio dos arquivos.');
      } finally {
        setBusy(false);
        setProgress(null);
        if (inputRef.current) inputRef.current.value = '';
        router.refresh();
      }
    },
    [auditId, busy, router],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    void send([...event.dataTransfer.files]);
  };

  const accepted = results.filter((result) => result.accepted).length;
  const rejected = results.length - accepted;

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center rounded-[var(--radius-card)] border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-gold-500 bg-gold-100/50' : 'border-line-strong bg-navy-50/40',
          disabled && 'opacity-60',
        )}
      >
        <CloudUpload size={28} className="text-navy-400" aria-hidden />
        <p className="mt-3 text-sm font-medium text-ink">
          Arraste os arquivos para esta área ou selecione no computador
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Aceitos: XML de NF-e/NFC-e, ZIP com XML, EFD ICMS/IPI e EFD-Contribuicoes (.txt) e PGDAS-D (.pdf).
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => void send([...(event.target.files ?? [])])}
        />

        <Button
          className="mt-4"
          variant="secondary"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Enviando...
            </>
          ) : (
            'Selecionar arquivos'
          )}
        </Button>

        {progress ? (
          <p className="tabular mt-3 text-xs text-ink-muted">
            {progress.done} de {progress.total} arquivo(s) enviados
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {results.length > 0 ? (
        <div className="rounded-md border border-line bg-white">
          <p className="border-b border-line px-4 py-2 text-xs font-semibold text-ink">
            Resultado do envio · {accepted} aceito(s), {rejected} recusado(s)
          </p>
          <ul className="app-scroll max-h-56 overflow-y-auto">
            {results.map((result, index) => (
              <li
                key={`${result.name}-${index}`}
                className="flex items-start gap-2 border-b border-line px-4 py-2 text-xs last:border-0"
              >
                {result.accepted ? (
                  <FileCheck2 size={14} className="mt-0.5 shrink-0 text-success" aria-hidden />
                ) : (
                  <FileWarning size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                )}
                <span className={result.accepted ? 'text-ink-muted' : 'text-danger'}>{result.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
