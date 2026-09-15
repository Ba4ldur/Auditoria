/**
 * Composição do valor total do documento no período de transição da reforma
 * tributária (Emenda Constitucional 132/2023).
 *
 * # Por que este módulo existe
 *
 * Até 2025, comparar `vNF` do XML com `VL_DOC` do registro C100 é comparar duas
 * expressões do mesmo número. A partir da entrada em vigor do IBS, da CBS e do
 * Imposto Seletivo, deixa de ser: se um dos lados computa os novos tributos no
 * total e o outro não, a diferença aritmética não é erro de escrituração — é
 * diferença de composição.
 *
 * # O que este módulo NÃO faz
 *
 * Não afirma qual é a composição correta. O tratamento dos novos tributos no
 * `VL_DOC` é matéria do Guia Prático da EFD ICMS/IPI em vigor para o exercício,
 * e **esta implementação não constitui orientação sobre esse ponto**: ela apura
 * as duas leituras possíveis a partir do que o arquivo declara, mostra a
 * composição usada e recusa-se a concluir quando a informação não basta.
 *
 * O ano de transição é uma constante parametrizável, e não uma regra de direito
 * embutida no código: `REFORM_TRANSITION_YEAR` pode ser ajustado sem tocar na
 * lógica de comparação.
 *
 * # Consequência prática
 *
 * - Documento anterior à transição: composição irrelevante, comparação direta.
 * - Documento na transição com os grupos declarados no XML: o sistema calcula o
 *   valor comparável, compara as duas leituras e só afirma divergência quando
 *   **ambas** divergem.
 * - Documento na transição sem os grupos no XML: a composição não pode ser
 *   determinada, e uma diferença sai como indício, nunca como divergência.
 */

import { ZERO, addCents, formatBRL, subCents, type Cents } from '@/lib/core/money';
import type { Invoice } from '@/lib/domain/model';

/**
 * Primeiro exercício em que a composição do total do documento deixa de ser
 * presumida equivalente entre XML e escrituração.
 *
 * Parametrizado de propósito: se a data de referência mudar, muda aqui, sem
 * reescrever regra nenhuma.
 */
export const REFORM_TRANSITION_YEAR = 2026;

export type CompositionStatus =
  /** Documento anterior à transição: a composição não é questão. */
  | 'ANTERIOR_A_TRANSICAO'
  /** O XML declarou os grupos: o valor comparável pôde ser calculado. */
  | 'DETERMINADA'
  /** Documento na transição sem os grupos no XML: composição desconhecida. */
  | 'INDETERMINADA';

export interface ComparableTotal {
  readonly status: CompositionStatus;
  /** Exercício usado na decisão; nulo quando nem o documento nem a auditoria o dizem. */
  readonly exercicio: number | null;
  readonly vNF: Cents;
  readonly ibs: Cents | null;
  readonly cbs: Cents | null;
  readonly is: Cents | null;
  /** Soma das parcelas efetivamente deduzidas. */
  readonly deducoes: Cents;
  /** Total do documento líquido dos novos tributos declarados. */
  readonly comparavel: Cents;
  /** Elementos lidos do XML, na forma `elemento=valor`. */
  readonly readFields: readonly string[];
  /** Frase pronta para a evidência, dizendo qual composição foi usada. */
  readonly explicacao: string;
}

/** Exercício do documento, com a competência da auditoria como segunda fonte. */
function exercicioOf(invoice: Invoice, competencia: string | null): number | null {
  const fromDocument = invoice.issueDate ? Number(invoice.issueDate.slice(0, 4)) : Number.NaN;
  if (Number.isInteger(fromDocument)) return fromDocument;
  const fromAudit = competencia ? Number(competencia.slice(0, 4)) : Number.NaN;
  return Number.isInteger(fromAudit) ? fromAudit : null;
}

/**
 * Valor do documento comparável com o `VL_DOC` escriturado.
 *
 * Nunca inventa parcela: só deduz o que o XML declarou, e diz quais elementos
 * leu para chegar ao número.
 */
export function comparableTotal(invoice: Invoice, competencia: string | null): ComparableTotal {
  const exercicio = exercicioOf(invoice, competencia);
  const vNF = invoice.totals.total;

  if (exercicio === null || exercicio < REFORM_TRANSITION_YEAR) {
    return {
      status: 'ANTERIOR_A_TRANSICAO',
      exercicio,
      vNF,
      ibs: null,
      cbs: null,
      is: null,
      deducoes: ZERO,
      comparavel: vNF,
      readFields: [],
      explicacao:
        exercicio === null
          ? 'Exercício do documento não determinado; comparação feita sobre o valor total declarado.'
          : `Documento do exercício ${exercicio}, anterior à transição: o valor total do documento é comparado ` +
            'diretamente, sem ajuste de composição.',
    };
  }

  const reform = invoice.reformTaxes;
  if (!reform) {
    return {
      status: 'INDETERMINADA',
      exercicio,
      vNF,
      ibs: null,
      cbs: null,
      is: null,
      deducoes: ZERO,
      comparavel: vNF,
      readFields: [],
      explicacao:
        `Documento do exercício ${exercicio}. O XML não declara IBS, CBS nem Imposto Seletivo, de modo que não é ` +
        'possível determinar se o valor escriturado os inclui. A composição do total não foi apurada.',
    };
  }

  const deducoes = addCents(reform.ibs ?? ZERO, reform.cbs ?? ZERO, reform.is ?? ZERO);
  const declarados = [
    ...(reform.ibs === null ? [] : [`IBS ${formatBRL(reform.ibs)}`]),
    ...(reform.cbs === null ? [] : [`CBS ${formatBRL(reform.cbs)}`]),
    ...(reform.is === null ? [] : [`IS ${formatBRL(reform.is)}`]),
  ];

  return {
    status: 'DETERMINADA',
    exercicio,
    vNF,
    ibs: reform.ibs,
    cbs: reform.cbs,
    is: reform.is,
    deducoes,
    comparavel: subCents(vNF, deducoes),
    readFields: reform.readFields,
    explicacao:
      `Documento do exercício ${exercicio}. Valor comparável apurado a partir do total declarado no XML, ` +
      `deduzidas as parcelas que o próprio XML informa: ${declarados.join(', ')}.`,
  };
}

/** Linhas da composição, na ordem em que o auditor as confere. */
export function compositionLines(
  composition: ComparableTotal,
  vlDoc: Cents,
): readonly { readonly label: string; readonly value: string; readonly field: string | null }[] {
  const lines: { label: string; value: string; field: string | null }[] = [
    { label: 'vNF original', value: formatBRL(composition.vNF), field: 'total/ICMSTot/vNF' },
  ];

  if (composition.status === 'DETERMINADA') {
    lines.push({
      label: '(-) IBS',
      value: composition.ibs === null ? 'não declarado' : formatBRL(composition.ibs),
      field: composition.ibs === null ? null : 'vIBS',
    });
    lines.push({
      label: '(-) CBS',
      value: composition.cbs === null ? 'não declarado' : formatBRL(composition.cbs),
      field: composition.cbs === null ? null : 'vCBS',
    });
    lines.push({
      label: '(-) IS',
      value: composition.is === null ? 'não declarado' : formatBRL(composition.is),
      field: composition.is === null ? null : 'vIS',
    });
  } else if (composition.status === 'INDETERMINADA') {
    lines.push({ label: '(-) IBS', value: 'não declarado no XML', field: null });
    lines.push({ label: '(-) CBS', value: 'não declarado no XML', field: null });
    lines.push({ label: '(-) IS', value: 'não declarado no XML', field: null });
  }

  lines.push({
    label: 'valor comparável',
    value:
      composition.status === 'INDETERMINADA'
        ? `${formatBRL(composition.comparavel)} (composição não apurada)`
        : formatBRL(composition.comparavel),
    field: null,
  });
  lines.push({ label: 'VL_DOC', value: formatBRL(vlDoc), field: 'VL_DOC' });

  return lines;
}
