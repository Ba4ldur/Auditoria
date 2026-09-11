/**
 * Explicit success/failure envelope.
 *
 * Parsers never throw for malformed input: a single broken XML inside a ZIP of
 * ten thousand documents must not abort the whole audit (requirement 29).
 */

export type Result<T, E = ParseIssue> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface ParseIssue {
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function issue(code: string, message: string, detail?: string): ParseIssue {
  return detail === undefined ? { code, message } : { code, message, detail };
}

export function failWith(code: string, message: string, detail?: string): Result<never, ParseIssue> {
  return fail(issue(code, message, detail));
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Erro desconhecido';
  }
}
