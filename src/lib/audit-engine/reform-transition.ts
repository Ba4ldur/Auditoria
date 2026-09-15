/**
 * Composição do valor total do documento fiscal, por exercício.
 *
 * # Base normativa
 *
 * Guia Prático da EFD ICMS/IPI, versão 3.2.2 (atualização de 11/02/2026),
 * Seção 10 — Informações sobre a Reforma Tributária sobre o Consumo:
 *
 *  - como regra, CBS, IBS e IS **são considerados** na escrituração do valor
 *    total do documento fiscal;
 *  - há **exceção específica para o exercício de 2026**, em que esses tributos
 *    **não integram** o `VL_DOC` do registro C100;
 *  - CBS, IBS e IS **não integram** o `VL_OPR` do registro C190.
 *
 * # Por que a regra é por vigência, e não um parâmetro só
 *
 * A composição do `VL_DOC` muda de exercício para exercício, e cada mudança tem
 * base normativa própria. Um único sinalizador "é ou não é da reforma"
 * obrigaria a reescrever a regra a cada alteração e apagaria a rastreabilidade
 * do critério: meses depois, ninguém saberia dizer sob qual leitura uma
 * ocorrência arquivada foi produzida.
 *
 * Aqui cada exercício tem um **regime** identificado, descrito e com fonte
 * declarada. O regime escolhido vai para a evidência da ocorrência, junto com a
 * fonte que o sustenta. Acrescentar um exercício é acrescentar uma entrada em
 * `COMPOSITION_REGIMES` — nenhuma regra de auditoria muda.
 *
 * # Os dois totais da NF-e
 *
 * O leiaute RTC da NF-e tem dois campos de total, que **não são sinônimos**:
 *
 *  - `vNF` — total do documento sem IBS, CBS e IS;
 *  - `vNFTot` — "valor total da NF-e com IBS / CBS / IS".
 *
 * Comparar `vNFTot` com o `VL_DOC` de 2026 acusaria divergência em todo
 * documento que tenha os novos tributos, porque o `VL_DOC` daquele exercício,
 * por determinação do Guia Prático, não os inclui. É o regime do exercício que
 * decide qual total é o comparável — nunca a disponibilidade do campo.
 */

import { ZERO, addCents, formatBRL, subCents, type Cents } from '@/lib/core/money';
import type { Invoice } from '@/lib/domain/model';

/** Fonte normativa dos regimes de 2026 em diante. */
export const GUIA_PRATICO_322 =
  'Guia Prático da EFD ICMS/IPI, versão 3.2.2 (11/02/2026), Seção 10 — Informações sobre a Reforma ' +
  'Tributária sobre o Consumo.';

/** Primeiro exercício alcançado pela reforma na escrituração. */
export const REFORM_TRANSITION_YEAR = 2026;

export type CompositionRegimeId =
  /** Exercício anterior à reforma: só existe o total tradicional. */
  | 'SEM_REFORMA'
  /** Exercício de 2026: CBS, IBS e IS não integram o `VL_DOC`. */
  | 'EXCLUSAO_2026'
  /** Regra geral: CBS, IBS e IS integram o valor total escriturado. */
  | 'INTEGRACAO_RTC'
  /** Exercício sem regra declarada nesta versão do sistema. */
  | 'SEM_REGRA_DEFINIDA';

export interface CompositionRegime {
  readonly id: CompositionRegimeId;
  /** Exercício inicial de vigência, inclusive. */
  readonly from: number;
  /** Exercício final de vigência, inclusive; nulo enquanto em aberto. */
  readonly to: number | null;
  readonly nome: string;
  /** O que o regime determina sobre a composição do `VL_DOC`. */
  readonly criterio: string;
  readonly fonte: string;
}

/**
 * Regimes conhecidos, do mais antigo ao mais recente.
 *
 * A ordem importa apenas para leitura: a seleção é por faixa de exercício.
 */
export const COMPOSITION_REGIMES: readonly CompositionRegime[] = [
  {
    id: 'SEM_REFORMA',
    from: Number.NEGATIVE_INFINITY,
    to: REFORM_TRANSITION_YEAR - 1,
    nome: 'Anterior à reforma',
    criterio:
      'IBS, CBS e Imposto Seletivo não existem na escrituração do exercício. O valor total do documento no XML é ' +
      'comparado diretamente com o VL_DOC escriturado.',
    fonte: 'Leiaute da EFD ICMS/IPI anterior à Seção 10 do Guia Prático.',
  },
  {
    id: 'EXCLUSAO_2026',
    from: 2026,
    to: 2026,
    nome: 'Exercício de 2026 — exclusão dos tributos da reforma',
    criterio:
      'No exercício de 2026, CBS, IBS e Imposto Seletivo NÃO integram o VL_DOC do registro C100. O valor comparável ' +
      'é o total do documento sem esses tributos (vNF), e não o total com eles (vNFTot).',
    fonte: GUIA_PRATICO_322,
  },
  {
    id: 'INTEGRACAO_RTC',
    from: 2027,
    to: null,
    nome: 'Regra geral — tributos da reforma integram o total',
    criterio:
      'Como regra, CBS, IBS e Imposto Seletivo são considerados na escrituração do valor total do documento fiscal. ' +
      'O valor comparável é o total com esses tributos (vNFTot), ou o total tradicional acrescido das parcelas ' +
      'declaradas, quando o campo próprio não vier no documento.',
    fonte: GUIA_PRATICO_322,
  },
];

const REGIME_SEM_DEFINICAO: CompositionRegime = {
  id: 'SEM_REGRA_DEFINIDA',
  from: Number.NaN,
  to: null,
  nome: 'Exercício sem regra de composição declarada',
  criterio:
    'Nenhum regime de composição foi declarado para o exercício do documento nesta versão do sistema. A comparação ' +
    'não é executada.',
  fonte: 'Sem fonte normativa registrada para o exercício.',
};

export function regimeFor(exercicio: number | null): CompositionRegime {
  if (exercicio === null) return REGIME_SEM_DEFINICAO;
  return (
    COMPOSITION_REGIMES.find(
      (regime) => exercicio >= regime.from && (regime.to === null || exercicio <= regime.to),
    ) ?? REGIME_SEM_DEFINICAO
  );
}

export type CompositionStatus =
  /** O valor comparável pôde ser formado segundo o regime do exercício. */
  | 'DETERMINADA'
  /**
   * O regime é conhecido, mas o documento não traz o que ele exige. A regra
   * reporta indício; não há composição a afirmar.
   */
  | 'INDETERMINADA'
  /** Não há regime declarado para o exercício. A comparação não é executada. */
  | 'SEM_REGRA';

export interface ComparableTotal {
  readonly status: CompositionStatus;
  readonly regime: CompositionRegime;
  readonly exercicio: number | null;
  /** `vNF` — total tradicional, sem IBS, CBS e IS. */
  readonly vNF: Cents;
  /** `vNFTot` — total com IBS, CBS e IS, quando o documento o declara. */
  readonly vNFTot: Cents | null;
  readonly ibs: Cents | null;
  readonly cbs: Cents | null;
  readonly is: Cents | null;
  /** Total das parcelas de reforma declaradas no documento. */
  readonly tributosReforma: Cents;
  /** Valor do XML comparável com o `VL_DOC`, segundo o regime. */
  readonly comparavel: Cents;
  /** Campo ou expressão de onde o valor comparável saiu. */
  readonly origemDoComparavel: string;
  /** Elementos lidos do XML, na forma `elemento=valor`. */
  readonly readFields: readonly string[];
  /** Frase pronta para a evidência. */
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
 * Valor do documento comparável com o `VL_DOC` escriturado, segundo o regime de
 * composição do exercício.
 *
 * Nunca inventa parcela: deduz ou acrescenta apenas o que o XML declara, e diz
 * de qual campo o número saiu.
 */
export function comparableTotal(invoice: Invoice, competencia: string | null): ComparableTotal {
  const exercicio = exercicioOf(invoice, competencia);
  const regime = regimeFor(exercicio);
  const vNF = invoice.totals.total;
  const reform = invoice.reformTaxes;

  const vNFTot = reform?.totalWithReformTaxes ?? null;
  const ibs = reform?.ibs ?? null;
  const cbs = reform?.cbs ?? null;
  const impostoSeletivo = reform?.is ?? null;
  const tributosReforma = addCents(ibs ?? ZERO, cbs ?? ZERO, impostoSeletivo ?? ZERO);
  const readFields = reform?.readFields ?? [];

  const base = {
    regime,
    exercicio,
    vNF,
    vNFTot,
    ibs,
    cbs,
    is: impostoSeletivo,
    tributosReforma,
    readFields,
  };

  switch (regime.id) {
    case 'SEM_REFORMA':
      return {
        ...base,
        status: 'DETERMINADA',
        comparavel: vNF,
        origemDoComparavel: 'total/ICMSTot/vNF',
        explicacao:
          `Exercício ${exercicio}: anterior à reforma. O valor total do documento é comparado diretamente com o ` +
          'VL_DOC escriturado.',
      };

    case 'EXCLUSAO_2026': {
      // O total tradicional já é o valor sem os novos tributos: é exatamente o
      // que o Guia Prático determina para o VL_DOC deste exercício. `vNFTot`,
      // quando existe, é deliberadamente descartado da comparação.
      const comDeclaracao = reform !== null;
      return {
        ...base,
        status: 'DETERMINADA',
        comparavel: vNF,
        origemDoComparavel: 'total/ICMSTot/vNF',
        explicacao:
          `Exercício ${exercicio}: CBS, IBS e Imposto Seletivo não integram o VL_DOC do registro C100. O valor ` +
          'comparável é o total do documento sem esses tributos (vNF)' +
          (comDeclaracao
            ? vNFTot === null
              ? ', e as parcelas de reforma declaradas no documento ficam fora da comparação.'
              : `, e não o total com eles (vNFTot = ${formatBRL(vNFTot)}), que não é comparável com o VL_DOC ` +
                'deste exercício.'
            : '. O documento não declara parcelas de reforma.'),
      };
    }

    case 'INTEGRACAO_RTC': {
      if (vNFTot !== null) {
        return {
          ...base,
          status: 'DETERMINADA',
          comparavel: vNFTot,
          origemDoComparavel: 'total/vNFTot',
          explicacao:
            `Exercício ${exercicio}: os tributos da reforma integram o valor total escriturado. O valor comparável ` +
            'é o total declarado com IBS, CBS e IS (vNFTot).',
        };
      }

      if (reform !== null) {
        return {
          ...base,
          status: 'DETERMINADA',
          comparavel: addCents(vNF, tributosReforma),
          origemDoComparavel: 'total/ICMSTot/vNF + vIBS + vCBS + vIS',
          explicacao:
            `Exercício ${exercicio}: os tributos da reforma integram o valor total escriturado. O documento não ` +
            'traz vNFTot, e o valor comparável foi formado somando ao total tradicional as parcelas declaradas.',
        };
      }

      return {
        ...base,
        status: 'INDETERMINADA',
        comparavel: vNF,
        origemDoComparavel: 'total/ICMSTot/vNF',
        explicacao:
          `Exercício ${exercicio}: os tributos da reforma integram o valor total escriturado, mas o documento não ` +
          'declara vNFTot nem as parcelas de IBS, CBS e IS. O valor comparável não pôde ser formado.',
      };
    }

    default:
      return {
        ...base,
        status: 'SEM_REGRA',
        comparavel: vNF,
        origemDoComparavel: 'total/ICMSTot/vNF',
        explicacao:
          exercicio === null
            ? 'Exercício do documento não determinado: não há como escolher o regime de composição do valor total.'
            : `Exercício ${exercicio}: nenhum regime de composição declarado nesta versão do sistema.`,
      };
  }
}

export interface CompositionLine {
  readonly label: string;
  readonly value: string;
  /** Campo do leiaute, quando a linha corresponde a um campo lido. */
  readonly field: string | null;
  /** Lado de onde a linha vem: o documento ou a escrituração. */
  readonly side: 'XML' | 'EFD' | 'REGRA';
}

/**
 * Linhas da composição, na ordem em que o auditor as confere.
 *
 * `vNFTot` aparece mesmo quando não entra na conta: em 2026, ver o campo
 * presente e explicitamente fora da comparação é o que permite conferir que a
 * regra do exercício foi aplicada — e não que o campo passou despercebido.
 */
export function compositionLines(
  composition: ComparableTotal,
  vlDoc: Cents,
  diferenca: Cents,
): readonly CompositionLine[] {
  const lines: CompositionLine[] = [
    {
      label: 'Exercício',
      value: composition.exercicio === null ? 'não determinado' : String(composition.exercicio),
      field: 'ide/dhEmi',
      side: 'XML',
    },
    { label: 'vNF', value: formatBRL(composition.vNF), field: 'total/ICMSTot/vNF', side: 'XML' },
  ];

  const usaTotalRtc = composition.origemDoComparavel === 'total/vNFTot';
  lines.push({
    label: 'vNFTot',
    value:
      composition.vNFTot === null
        ? 'não declarado no XML'
        : `${formatBRL(composition.vNFTot)}${usaTotalRtc ? '' : ' — fora da comparação neste exercício'}`,
    field: composition.vNFTot === null ? null : 'total/vNFTot',
    side: 'XML',
  });

  const parcela = (label: string, value: Cents | null, field: string): CompositionLine => ({
    label,
    value: value === null ? 'não declarado no XML' : formatBRL(value),
    field: value === null ? null : field,
    side: 'XML',
  });

  lines.push(parcela('IBS', composition.ibs, 'vIBS'));
  lines.push(parcela('CBS', composition.cbs, 'vCBS'));
  lines.push(parcela('IS', composition.is, 'vIS'));

  lines.push({
    label: 'Regra de composição aplicada',
    value: `${composition.regime.nome} — ${composition.regime.criterio}`,
    field: null,
    side: 'REGRA',
  });

  lines.push({
    label: 'Valor comparável',
    value:
      composition.status === 'DETERMINADA'
        ? `${formatBRL(composition.comparavel)} (de ${composition.origemDoComparavel})`
        : `${formatBRL(composition.comparavel)} — composição não apurada`,
    field: null,
    side: 'REGRA',
  });

  lines.push({ label: 'C100.VL_DOC', value: formatBRL(vlDoc), field: 'VL_DOC', side: 'EFD' });
  lines.push({ label: 'Diferença', value: formatBRL(diferenca), field: null, side: 'REGRA' });
  lines.push({ label: 'Fonte normativa', value: composition.regime.fonte, field: null, side: 'REGRA' });

  return lines;
}

/** Diferença entre o valor comparável e o escriturado. */
export function compositionDifference(composition: ComparableTotal, vlDoc: Cents): Cents {
  return subCents(composition.comparavel, vlDoc);
}
