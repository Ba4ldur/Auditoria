'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/page';
import { EMPTY_FORM_STATE } from '@/lib/ui/form-state';
import { confirmFieldAction, removeConfirmationAction } from '@/app/(app)/arquivos/[id]/actions';
import type { ConfirmableField } from '@/lib/pipeline/confirmations';
import type { ExtractionConfidence, FieldConfirmation } from './field-confirmation-types';

const CONFIDENCE_TONES: Record<ExtractionConfidence, 'success' | 'warning' | 'danger' | 'muted'> = {
  ALTA: 'success',
  MEDIA: 'warning',
  BAIXA: 'danger',
  NAO_IDENTIFICADO: 'muted',
};

const CONFIDENCE_LABELS: Record<ExtractionConfidence, string> = {
  ALTA: 'Alta',
  MEDIA: 'Média',
  BAIXA: 'Baixa',
  NAO_IDENTIFICADO: 'Não identificado',
};

export interface ExtractedRow {
  readonly field: ConfirmableField;
  readonly extractedValue: string | null;
  readonly confidence: ExtractionConfidence;
  readonly evidence: string | null;
  readonly confirmation: FieldConfirmation | null;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Salvando...' : label}
    </Button>
  );
}

/**
 * Conferência do parsing de um documento com extração por padrões
 * (fase 2, requisito 10).
 *
 * Campos com confiança abaixo de alta exigem confirmação manual antes de
 * alimentar qualquer cruzamento. A correção atua somente na camada normalizada:
 * o PDF original permanece intocado.
 */
export function FieldConfirmationPanel({
  auditId,
  fileId,
  rows,
}: {
  auditId: string;
  fileId: string;
  rows: readonly ExtractedRow[];
}) {
  const [state, formAction] = useActionState(confirmFieldAction, EMPTY_FORM_STATE);
  const submitted = state.values ?? {};

  return (
    <div className="flex flex-col gap-4">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.success ? <Notice tone="success">{state.success}</Notice> : null}

      <div className="app-scroll overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr>
              <th className="border-b border-line bg-navy-50/60 px-4 py-2.5 text-left text-[0.6875rem] font-semibold tracking-wide text-ink-muted uppercase">
                Campo
              </th>
              <th className="border-b border-line bg-navy-50/60 px-4 py-2.5 text-left text-[0.6875rem] font-semibold tracking-wide text-ink-muted uppercase">
                Valor extraído
              </th>
              <th className="border-b border-line bg-navy-50/60 px-4 py-2.5 text-left text-[0.6875rem] font-semibold tracking-wide text-ink-muted uppercase">
                Confiança
              </th>
              <th className="border-b border-line bg-navy-50/60 px-4 py-2.5 text-left text-[0.6875rem] font-semibold tracking-wide text-ink-muted uppercase">
                Evidência
              </th>
              <th className="border-b border-line bg-navy-50/60 px-4 py-2.5 text-left text-[0.6875rem] font-semibold tracking-wide text-ink-muted uppercase">
                Confirmação manual
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.field.key} className="border-b border-line align-top">
                <td className="px-4 py-3">
                  <span className="font-medium text-ink">{row.field.label}</span>
                  <span className="mt-0.5 block text-[0.6875rem] text-ink-subtle">{row.field.help}</span>
                </td>
                <td className="tabular px-4 py-3 font-mono text-xs text-ink">
                  {row.extractedValue ?? (
                    <span className="text-ink-subtle">Não identificado automaticamente</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={CONFIDENCE_TONES[row.confidence]}>
                    {CONFIDENCE_LABELS[row.confidence]}
                  </Badge>
                </td>
                <td className="max-w-xs px-4 py-3">
                  {row.evidence ? (
                    <code className="block text-[0.625rem] leading-relaxed break-words text-ink-muted">
                      {row.evidence}
                    </code>
                  ) : (
                    <span className="text-xs text-ink-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.confirmation ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="tabular font-mono text-xs font-semibold text-success">
                        {row.confirmation.confirmedValue}
                      </span>
                      <span className="text-[0.625rem] text-ink-subtle">
                        Por {row.confirmation.confirmedBy} em{' '}
                        {row.confirmation.confirmedAt.slice(0, 10).split('-').reverse().join('/')}
                      </span>
                      {row.confirmation.originalValue ? (
                        <span className="text-[0.625rem] text-ink-subtle">
                          Extraído originalmente: {row.confirmation.originalValue}
                        </span>
                      ) : null}
                      <form action={removeConfirmationAction}>
                        <input type="hidden" name="confirmationId" value={row.confirmation.id} />
                        <input type="hidden" name="fileId" value={fileId} />
                        <button
                          type="submit"
                          className="text-[0.6875rem] text-ink-subtle underline hover:text-danger"
                        >
                          Remover confirmação
                        </button>
                      </form>
                    </div>
                  ) : row.confidence === 'ALTA' ? (
                    <span className="text-xs text-ink-subtle">Não é necessária.</span>
                  ) : (
                    <Badge tone="warning">Confirmar manualmente</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={formAction} className="grid gap-3 rounded-md border border-line bg-navy-50/40 p-4 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end">
        <input type="hidden" name="fileId" value={fileId} />
        <input type="hidden" name="auditId" value={auditId} />
        <input
          type="hidden"
          name="originalValue"
          value={rows.find((row) => row.field.key === (submitted.field ?? rows[0]?.field.key))?.extractedValue ?? ''}
        />

        <Field label="Campo a confirmar" htmlFor="field">
          <select
            id="field"
            name="field"
            defaultValue={submitted.field ?? rows[0]?.field.key ?? ''}
            className="h-9.5 w-full rounded-md border border-line-strong bg-white px-3 text-sm text-ink focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20 focus:outline-none"
          >
            {rows.map((row) => (
              <option key={row.field.key} value={row.field.key}>
                {row.field.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Valor confirmado" htmlFor="confirmedValue" required>
          <Input
            id="confirmedValue"
            name="confirmedValue"
            defaultValue={submitted.confirmedValue ?? ''}
            placeholder="1.234,56 ou 08/2026"
            required
          />
        </Field>

        <Field label="Observação" htmlFor="note" hint="Onde o valor foi conferido.">
          <Input id="note" name="note" defaultValue={submitted.note ?? ''} maxLength={200} />
        </Field>

        <div className="pb-0.5">
          <SubmitButton label="Confirmar valor" />
        </div>
      </form>
    </div>
  );
}
