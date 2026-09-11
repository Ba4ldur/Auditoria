/**
 * Estado compartilhado dos formulários que usam server actions.
 *
 * Fica fora dos módulos `'use server'` porque esses só podem exportar funções
 * assíncronas: uma constante exportada de um arquivo de ação quebra o build.
 */

export interface FormState {
  readonly error: string | null;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  readonly success?: string | null;
  /**
   * Valores submetidos, devolvidos quando a ação falha.
   *
   * O React 19 reinicia os campos de um formulário depois que a ação termina.
   * Sem devolver o que foi digitado, um erro de validação apagaria um cadastro
   * inteiro — inaceitável em um formulário longo.
   */
  readonly values?: Readonly<Record<string, string>>;
}

export const EMPTY_FORM_STATE: FormState = { error: null, success: null };

/** Lê os campos informados do `FormData` como texto. */
export function submittedValues(
  formData: FormData,
  keys: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    values[key] = typeof value === 'string' ? value : '';
  }
  return values;
}
