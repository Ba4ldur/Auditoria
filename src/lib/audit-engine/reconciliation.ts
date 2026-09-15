/**
 * Reconciliação XML de NF-e/NFC-e × EFD ICMS/IPI.
 *
 * As regras ATT-FIS comparam o mesmo universo de documentos
 * sob ângulos diferentes. Pareá-los uma vez, aqui, tem três consequências que
 * importam para a auditoria:
 *
 *  1. **Uma única verdade sobre o pareamento.** Se duas regras pareassem por
 *     conta própria e divergissem, o relatório ficaria internamente
 *     contraditório sem que nada acusasse o erro.
 *  2. **O escopo fica explícito.** Um documento de saída própria e um documento
 *     de entrada emitido por terceiro não admitem as mesmas comparações: o
 *     declarante escritura a entrada segundo o crédito a que tem direito, não
 *     segundo o destaque do emitente, e o CFOP da entrada não é o mesmo CFOP
 *     que o fornecedor declarou na saída. Tratar os dois casos com o mesmo
 *     critério produz divergência onde não há erro.
 *  3. **As ressalvas viajam com o par.** Documento complementar, ajuste,
 *     devolução, regime especial e escrituração extemporânea têm motivos
 *     legítimos para não coincidirem campo a campo. A ressalva é apurada uma
 *     vez, com o campo e o valor que a determinaram, e acompanha o par até a
 *     evidência.
 *
 * Nada aqui conclui coisa alguma sobre tratamento tributário. A camada apura
 * fatos sobre os arquivos e diz sob quais condições uma comparação é ou não é
 * conclusiva; a conclusão fiscal continua sendo do auditor.
 */

import { onlyDigits } from '@/lib/core/cnpj';
import type { Invoice, RecordOrigin } from '@/lib/domain/model';
import type { AuditDataset } from '@/lib/normalization/dataset';
import { duplicatesOf, invoicesFrom, xmlInvoices } from '@/lib/normalization/dataset';
import { isEffective } from './rules/helpers';

/** Versão desta camada; entra nas evidências junto com a versão da regra. */
export const RECONCILIATION_VERSION = '1.0.0';

/**
 * Ângulo pelo qual o documento é olhado, da perspectiva da empresa auditada.
 *
 * `INDEFINIDO` não é um detalhe: sem saber de que lado da operação a empresa
 * está, o sistema não tem como escolher o critério de comparação, e dizer isso
 * é melhor do que arbitrar um.
 */
export type FiscalScope = 'SAIDA_PROPRIA' | 'ENTRADA_TERCEIRO' | 'INDEFINIDO';

export const FISCAL_SCOPE_LABELS: Readonly<Record<FiscalScope, string>> = {
  SAIDA_PROPRIA: 'Saída própria',
  ENTRADA_TERCEIRO: 'Entrada de terceiro',
  INDEFINIDO: 'Sentido da operação não determinado',
};

export type CaveatCode =
  | 'DOCUMENTO_COMPLEMENTAR'
  | 'DOCUMENTO_AJUSTE'
  | 'DOCUMENTO_DEVOLUCAO'
  | 'REGIME_ESPECIAL'
  | 'ESCRITURACAO_EXTEMPORANEA';

/**
 * Motivo pelo qual uma diferença aritmética entre XML e EFD não sustenta, por
 * si só, conclusão de erro. Carrega o campo e o valor que o determinaram, para
 * que a ressalva seja conferível no arquivo original.
 */
export interface Caveat {
  readonly code: CaveatCode;
  readonly titulo: string;
  readonly explicacao: string;
  /** Campo do leiaute que declarou a condição (`COD_SIT`, `finNFe`). */
  readonly campo: string | null;
  readonly valor: string | null;
  readonly origem: RecordOrigin;
}

export interface DocumentPair {
  readonly key: string;
  readonly xml: Invoice;
  readonly efd: Invoice;
  readonly scope: FiscalScope;
  readonly ressalvas: readonly Caveat[];
}

/** Documento cuja chave aparece mais de uma vez dentro da mesma obrigação. */
export interface DuplicatedDocument {
  readonly key: string;
  /**
   * Todas as ocorrências da chave, na ordem em que foram lidas. Cada uma traz o
   * próprio valor, COD_SIT, sentido da operação, arquivo e linha: a regra que
   * reporta a duplicidade precisa mostrar em que os registros diferem, porque é
   * isso que distingue um erro de escrituração de um documento legitimamente
   * escriturado duas vezes com naturezas diferentes.
   */
  readonly occurrences: readonly Invoice[];
}

/**
 * Documento cuja situação declarada no XML não corresponde à situação
 * escriturada na EFD.
 *
 * `comparavel` é falso quando um dos lados não declara a situação, ou quando as
 * situações pertencem a eixos que não se correspondem diretamente (denegação e
 * inutilização não têm equivalente exato no COD_SIT lido). Nesses casos a regra
 * reporta indício, nunca fato.
 */
export interface StatusMismatch {
  readonly key: string;
  readonly xml: Invoice;
  readonly efd: Invoice;
  readonly comparavel: boolean;
}

export interface Reconciliation {
  readonly pairs: readonly DocumentPair[];
  /** Documentos do XML sem C100 correspondente, já sem os de efeito nulo. */
  readonly xmlOnly: readonly Invoice[];
  /** Registros C100 sem XML correspondente. */
  readonly efdOnly: readonly Invoice[];
  readonly xmlWithoutKey: readonly Invoice[];
  readonly efdWithoutKey: readonly Invoice[];
  /** Documentos excluídos do cruzamento por não terem efeito fiscal. */
  readonly xmlIneffective: readonly Invoice[];
  readonly efdIneffective: readonly Invoice[];
  /** Chaves repetidas dentro do próprio arquivo da EFD. */
  readonly efdDuplicates: readonly DuplicatedDocument[];
  /**
   * Pares cuja situação diverge entre XML e EFD.
   *
   * São apurados sobre o universo completo, antes do filtro de efeito fiscal:
   * o caso mais relevante — documento cancelado no XML e escriturado como
   * regular — desapareceria se os dois lados fossem filtrados primeiro.
   */
  readonly statusMismatches: readonly StatusMismatch[];
  /**
   * NFC-e presentes no XML quando a EFD não escritura nenhum documento de
   * modelo 65. A ausência pode significar escrituração por registros de
   * consolidação (bloco C, registros de cupom e redução Z) que este parser
   * ainda não lê — e nesse caso acusar cada NFC-e como não escriturada seria
   * afirmar um fato que o arquivo não sustenta.
   */
  readonly nfceSemModelo65NaEfd: readonly Invoice[];
  readonly totals: {
    readonly xmlConsiderados: number;
    readonly efdConsiderados: number;
  };
}

const CACHE = new WeakMap<AuditDataset, Reconciliation>();

/** Reconciliação do dataset, calculada uma única vez e reaproveitada. */
export function reconcile(dataset: AuditDataset): Reconciliation {
  const cached = CACHE.get(dataset);
  if (cached) return cached;
  const computed = compute(dataset);
  CACHE.set(dataset, computed);
  return computed;
}

function compute(dataset: AuditDataset): Reconciliation {
  const xmlAll = xmlInvoices(dataset);
  const efdAll = invoicesFrom(dataset, 'EFD_ICMS_IPI');

  const xml = xmlAll.filter(isEffective);
  const efd = efdAll.filter(isEffective);

  const efdIndex = new Map<string, Invoice>();
  const efdDuplicateOccurrences = new Map<string, Invoice[]>();
  const efdWithoutKey: Invoice[] = [];

  for (const invoice of efd) {
    if (!invoice.accessKey) {
      efdWithoutKey.push(invoice);
      continue;
    }

    const existing = efdIndex.get(invoice.accessKey);
    if (existing) {
      const occurrences = efdDuplicateOccurrences.get(invoice.accessKey) ?? [existing];
      occurrences.push(invoice);
      efdDuplicateOccurrences.set(invoice.accessKey, occurrences);
      continue;
    }

    efdIndex.set(invoice.accessKey, invoice);
  }

  const xmlIndex = new Map<string, Invoice>();
  const xmlWithoutKey: Invoice[] = [];
  for (const invoice of xml) {
    if (!invoice.accessKey) xmlWithoutKey.push(invoice);
    else if (!xmlIndex.has(invoice.accessKey)) xmlIndex.set(invoice.accessKey, invoice);
  }

  const pairs: DocumentPair[] = [];
  const xmlOnly: Invoice[] = [];

  for (const [key, invoice] of xmlIndex) {
    const counterpart = efdIndex.get(key);
    if (!counterpart) {
      xmlOnly.push(invoice);
      continue;
    }
    pairs.push({
      key,
      xml: invoice,
      efd: counterpart,
      scope: scopeOf(dataset.company.cnpj, invoice, counterpart),
      ressalvas: caveatsFor(invoice, counterpart),
    });
  }

  const efdOnly = [...efdIndex.values()].filter(
    (invoice) => invoice.accessKey !== null && !xmlIndex.has(invoice.accessKey),
  );

  // A deduplicação da normalização já havia colapsado as repetições antes de o
  // dataset chegar aqui; sem consultá-la, a mesma chave escriturada duas vezes
  // no C100 desapareceria antes de qualquer regra vê-la. O laço acima cobre o
  // que sobrar dentro de uma mesma lista.
  for (const invoice of efdAll) {
    if (!invoice.accessKey || efdDuplicateOccurrences.has(invoice.accessKey)) continue;
    const colapsadas = duplicatesOf(dataset, 'EFD_ICMS_IPI', invoice.accessKey);
    if (colapsadas.length > 1) efdDuplicateOccurrences.set(invoice.accessKey, [...colapsadas]);
  }

  const efdDuplicates: DuplicatedDocument[] = [...efdDuplicateOccurrences.entries()]
    .map(([key, occurrences]) => ({ key, occurrences }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const statusMismatches = findStatusMismatches(xmlAll, efdAll);

  const efdHasModel65 = efdAll.some((invoice) => invoice.model === '65');
  const nfceSemModelo65NaEfd = efdHasModel65
    ? []
    : xmlOnly.filter((invoice) => invoice.model === '65');

  return {
    pairs,
    xmlOnly,
    efdOnly,
    xmlWithoutKey,
    efdWithoutKey,
    xmlIneffective: xmlAll.filter((invoice) => !isEffective(invoice)),
    efdIneffective: efdAll.filter((invoice) => !isEffective(invoice)),
    efdDuplicates,
    statusMismatches,
    nfceSemModelo65NaEfd,
    totals: { xmlConsiderados: xml.length, efdConsiderados: efd.length },
  };
}

/**
 * Situações que o sistema sabe confrontar diretamente entre as duas fontes.
 *
 * `AUTORIZADA` e `CANCELADA` têm correspondência inequívoca: o XML traz o
 * protocolo ou o evento de cancelamento, e o C100 traz o COD_SIT. `DENEGADA`,
 * `INUTILIZADA` e `INDEFINIDA` não são tratadas como comparáveis, porque a
 * correspondência entre os dois leiautes não é biunívoca e afirmar divergência
 * ali seria conclusão sem lastro.
 */
const COMPARABLE_STATUSES = new Set(['AUTORIZADA', 'CANCELADA']);

function findStatusMismatches(
  xmlAll: readonly Invoice[],
  efdAll: readonly Invoice[],
): StatusMismatch[] {
  const efdByKey = new Map<string, Invoice>();
  for (const invoice of efdAll) {
    if (invoice.accessKey && !efdByKey.has(invoice.accessKey)) efdByKey.set(invoice.accessKey, invoice);
  }

  const mismatches: StatusMismatch[] = [];
  const seen = new Set<string>();

  for (const xml of xmlAll) {
    if (!xml.accessKey || seen.has(xml.accessKey)) continue;
    seen.add(xml.accessKey);

    const efd = efdByKey.get(xml.accessKey);
    if (!efd || efd.status === xml.status) continue;

    mismatches.push({
      key: xml.accessKey,
      xml,
      efd,
      comparavel: COMPARABLE_STATUSES.has(xml.status) && COMPARABLE_STATUSES.has(efd.status),
    });
  }

  return mismatches;
}

/**
 * Sentido da operação sob a ótica da empresa auditada.
 *
 * A ordem das fontes não é arbitrária:
 *
 *  1. **CNPJ do XML contra o da empresa.** É a única fonte que responde à
 *     pergunta certa — de que lado da operação a empresa auditada está.
 *  2. **`IND_OPER` do C100.** Declarado pela própria empresa na escrituração,
 *     portanto também na ótica dela.
 *
 * O `tpNF` do XML fica **deliberadamente de fora**: ele declara o sentido sob a
 * ótica do emitente, não da empresa auditada. Uma nota de venda emitida por um
 * terceiro contra outro terceiro traz `tpNF = 1`, e aceitá-lo como "saída
 * própria" faria o documento ser conferido pelos critérios de saída — o mesmo
 * falso positivo que a separação por escopo existe para evitar.
 */
export function scopeOf(
  companyCnpj: string,
  xml: Invoice | null,
  efd: Invoice | null,
): FiscalScope {
  const company = onlyDigits(companyCnpj);

  if (xml && company !== '') {
    if (onlyDigits(xml.emitterTaxId ?? '') === company) return 'SAIDA_PROPRIA';
    if (onlyDigits(xml.recipientTaxId ?? '') === company) return 'ENTRADA_TERCEIRO';
  }

  const booked = efd?.direction ?? 'INDEFINIDA';
  if (booked === 'SAIDA') return 'SAIDA_PROPRIA';
  if (booked === 'ENTRADA') return 'ENTRADA_TERCEIRO';
  return 'INDEFINIDO';
}

function caveatsFor(xml: Invoice, efd: Invoice): Caveat[] {
  const caveats: Caveat[] = [];

  // Quando os dois lados declaram a finalidade complementar, ambos entram: o
  // auditor confere a ressalva no documento e na escrituração, não em um só.
  for (const declarante of [xml, efd]) {
    if (declarante.purpose !== 'COMPLEMENTAR') continue;
    caveats.push({
      code: 'DOCUMENTO_COMPLEMENTAR',
      titulo: 'Documento complementar',
      explicacao:
        'Documento complementar registra apenas o valor complementado, e não o total da operação original. ' +
        'A diferença entre os dois lados é esperada e não caracteriza, por si só, erro de escrituração.',
      campo: declarante.purposeField,
      valor: declarante.purposeCode,
      origem: declarante.origin,
    });
  }

  if (xml.purpose === 'AJUSTE') {
    caveats.push({
      code: 'DOCUMENTO_AJUSTE',
      titulo: 'Documento de ajuste',
      explicacao:
        'Nota de ajuste não representa circulação de mercadoria e pode ser escriturada com valores próprios. ' +
        'A comparação campo a campo com o documento original não é conclusiva.',
      campo: xml.purposeField,
      valor: xml.purposeCode,
      origem: xml.origin,
    });
  }

  if (xml.purpose === 'DEVOLUCAO') {
    caveats.push({
      code: 'DOCUMENTO_DEVOLUCAO',
      titulo: 'Documento de devolução',
      explicacao:
        'Documento de devolução inverte o sentido da operação original, o que altera a base e o imposto ' +
        'escriturados em relação ao destaque do documento devolvido.',
      campo: xml.purposeField,
      valor: xml.purposeCode,
      origem: xml.origin,
    });
  }

  if (efd.purpose === 'REGIME_ESPECIAL') {
    caveats.push({
      code: 'REGIME_ESPECIAL',
      titulo: 'Documento emitido sob regime especial',
      explicacao:
        'A escrituração declara documento emitido com base em regime especial ou norma específica, cujo ' +
        'tratamento pode afastar a correspondência direta com o documento emitido.',
      campo: efd.purposeField,
      valor: efd.purposeCode,
      origem: efd.origin,
    });
  }

  if (efd.extemporaneous) {
    caveats.push({
      code: 'ESCRITURACAO_EXTEMPORANEA',
      titulo: 'Escrituração extemporânea',
      explicacao:
        'A escrituração é declarada extemporânea. Os valores do documento continuam comparáveis, mas a ' +
        'competência em que foram escriturados não é a da emissão.',
      campo: efd.purposeField,
      valor: efd.purposeCode,
      origem: efd.origin,
    });
  }

  return caveats;
}

/**
 * Ressalvas que impedem tratar a diferença como fato conclusivo.
 *
 * A escrituração extemporânea não entra: ela desloca a competência, não o valor
 * do documento, e a regra continua podendo afirmar a diferença como fato.
 */
export function blockingCaveats(pair: DocumentPair): readonly Caveat[] {
  return pair.ressalvas.filter((caveat) => caveat.code !== 'ESCRITURACAO_EXTEMPORANEA');
}
