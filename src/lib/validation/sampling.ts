/**
 * Amostra representativa para conferência manual.
 *
 * # Por que amostrar, e por que não aleatoriamente
 *
 * Um contador não confere seis mil documentos. Confere algumas dezenas — e a
 * validação do motor vale exatamente o quanto essas dezenas representarem. Uma
 * amostra aleatória de um acervo real seria composta quase inteiramente de
 * saídas normais conciliadas, que é justamente o caso que o sistema tem menos
 * chance de errar.
 *
 * A amostragem aqui é **por estrato**: cada situação que exercita um caminho
 * diferente do motor contribui com alguns documentos. Um documento cancelado,
 * uma devolução, um complementar e uma entrada testam decisões distintas do
 * parser e da reconciliação; vinte vendas idênticas testam uma só.
 *
 * # Determinismo
 *
 * A seleção é determinística: o mesmo dataset produz a mesma amostra. Isso
 * importa porque a conferência é feita ao longo de dias, e uma amostra que
 * mudasse a cada visita tornaria impossível concluir a validação.
 */

import type { Invoice } from '@/lib/domain/model';
import type { AuditFinding } from '@/lib/domain/entities';
import type { AuditDataset } from '@/lib/normalization/dataset';
import { reconcile, type DocumentPair } from '@/lib/audit-engine/reconciliation';
import { REFORM_TRANSITION_YEAR } from '@/lib/audit-engine/reform-transition';

export type SampleStratum =
  | 'SAIDA_NORMAL'
  | 'ENTRADA'
  | 'CANCELADA'
  | 'DEVOLUCAO'
  | 'COMPLEMENTAR_AJUSTE'
  | 'COM_DIVERGENCIA'
  | 'SEM_DIVERGENCIA'
  | 'REFORMA_TRIBUTARIA'
  | 'SEM_ESCRITURACAO'
  | 'SEM_XML';

export const STRATUM_LABELS: Readonly<Record<SampleStratum, string>> = {
  SAIDA_NORMAL: 'Saídas normais',
  ENTRADA: 'Entradas',
  CANCELADA: 'Canceladas',
  DEVOLUCAO: 'Devoluções',
  COMPLEMENTAR_AJUSTE: 'Complementares e ajustes',
  COM_DIVERGENCIA: 'Com divergência apontada',
  SEM_DIVERGENCIA: 'Sem divergência apontada',
  REFORMA_TRIBUTARIA: 'Com IBS, CBS ou IS declarados',
  SEM_ESCRITURACAO: 'No XML e sem escrituração',
  SEM_XML: 'Escriturados sem XML',
};

/** Quantos documentos cada estrato contribui quando a população permite. */
const STRATUM_TARGETS: Readonly<Record<SampleStratum, number>> = {
  SAIDA_NORMAL: 5,
  ENTRADA: 5,
  CANCELADA: 3,
  DEVOLUCAO: 3,
  COMPLEMENTAR_AJUSTE: 3,
  COM_DIVERGENCIA: 5,
  SEM_DIVERGENCIA: 5,
  REFORMA_TRIBUTARIA: 3,
  SEM_ESCRITURACAO: 3,
  SEM_XML: 3,
};

export interface SampleDocument {
  readonly accessKey: string;
  /** Estratos que justificaram a inclusão; um documento pode servir a vários. */
  readonly strata: readonly SampleStratum[];
  readonly describe: string;
  /** Presente quando o documento existe dos dois lados. */
  readonly xml: Invoice | null;
  readonly efd: Invoice | null;
  /** Códigos das regras que apontaram algo sobre este documento. */
  readonly ruleCodes: readonly string[];
}

export interface StratumSummary {
  readonly stratum: SampleStratum;
  readonly label: string;
  /** Documentos disponíveis na população. */
  readonly population: number;
  /** Quantos foram selecionados. */
  readonly selected: number;
  /** Meta do estrato; menor que a meta significa população insuficiente. */
  readonly target: number;
}

export interface Sample {
  readonly documents: readonly SampleDocument[];
  readonly strata: readonly StratumSummary[];
  readonly population: number;
}

interface Candidate {
  readonly accessKey: string;
  readonly xml: Invoice | null;
  readonly efd: Invoice | null;
  readonly strata: Set<SampleStratum>;
  readonly ruleCodes: Set<string>;
}

function describeCandidate(candidate: Candidate): string {
  const invoice = candidate.xml ?? candidate.efd;
  if (!invoice) return candidate.accessKey;
  const parts = [
    invoice.model ? `mod. ${invoice.model}` : null,
    invoice.serie ? `série ${invoice.serie}` : null,
    invoice.number ? `n. ${invoice.number}` : null,
    invoice.issueDate,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' · ') || candidate.accessKey;
}

/** Documento com efeito fiscal nulo, sob qualquer das duas fontes. */
function isCancelled(invoice: Invoice | null): boolean {
  return invoice !== null && ['CANCELADA', 'DENEGADA', 'INUTILIZADA'].includes(invoice.status);
}

function hasReformTaxes(invoice: Invoice | null): boolean {
  if (!invoice?.reformTaxes) return false;
  const { ibs, cbs, is, totalWithReformTaxes } = invoice.reformTaxes;
  return ibs !== null || cbs !== null || is !== null || totalWithReformTaxes !== null;
}

function exercicioOf(invoice: Invoice | null): number | null {
  const year = invoice?.issueDate ? Number(invoice.issueDate.slice(0, 4)) : Number.NaN;
  return Number.isInteger(year) ? year : null;
}

/**
 * Monta a amostra a partir da reconciliação e das ocorrências da auditoria.
 *
 * Nenhum número é fixo quando a população não o permite: um acervo sem
 * devoluções simplesmente não contribui com o estrato, e o resumo diz que a
 * população era zero — em vez de a amostra sugerir que o caso foi coberto.
 */
export function buildSample(
  dataset: AuditDataset,
  findings: readonly AuditFinding[],
): Sample {
  const recon = reconcile(dataset);
  const candidates = new Map<string, Candidate>();

  const ensure = (accessKey: string, xml: Invoice | null, efd: Invoice | null): Candidate => {
    const existing = candidates.get(accessKey);
    if (existing) {
      // Um candidato pode ser criado a partir de um lado (por exemplo, cancelado
      // só no XML) e encontrado depois pelo outro lado (cancelado também na
      // EFD). Completa o que faltar sem descartar o que já foi apurado — ao
      // contrário de simplesmente devolver o candidato antigo, que deixaria o
      // documento marcado como presente em um lado só quando está nos dois.
      if (existing.xml && existing.efd) return existing;
      const merged: Candidate = { ...existing, xml: existing.xml ?? xml, efd: existing.efd ?? efd };
      candidates.set(accessKey, merged);
      return merged;
    }
    const created: Candidate = {
      accessKey,
      xml,
      efd,
      strata: new Set<SampleStratum>(),
      ruleCodes: new Set<string>(),
    };
    candidates.set(accessKey, created);
    return created;
  };

  const classify = (candidate: Candidate, pair: DocumentPair | null): void => {
    const invoice = candidate.xml ?? candidate.efd;
    if (!invoice) return;

    if (isCancelled(candidate.xml) || isCancelled(candidate.efd)) {
      candidate.strata.add('CANCELADA');
    }

    const purposes = [candidate.xml?.purpose, candidate.efd?.purpose];
    if (purposes.includes('DEVOLUCAO')) candidate.strata.add('DEVOLUCAO');
    if (purposes.includes('COMPLEMENTAR') || purposes.includes('AJUSTE')) {
      candidate.strata.add('COMPLEMENTAR_AJUSTE');
    }

    if (pair) {
      if (pair.scope === 'ENTRADA_TERCEIRO') candidate.strata.add('ENTRADA');
      else if (pair.scope === 'SAIDA_PROPRIA' && candidate.strata.size === 0) {
        candidate.strata.add('SAIDA_NORMAL');
      }
    } else if (invoice.direction === 'ENTRADA') {
      candidate.strata.add('ENTRADA');
    } else if (invoice.direction === 'SAIDA' && candidate.strata.size === 0) {
      candidate.strata.add('SAIDA_NORMAL');
    }

    const exercicio = exercicioOf(candidate.xml) ?? exercicioOf(candidate.efd);
    if (hasReformTaxes(candidate.xml) && exercicio !== null && exercicio >= REFORM_TRANSITION_YEAR) {
      candidate.strata.add('REFORMA_TRIBUTARIA');
    }
  };

  for (const pair of recon.pairs) {
    const candidate = ensure(pair.key, pair.xml, pair.efd);
    classify(candidate, pair);
  }
  for (const invoice of recon.xmlOnly) {
    if (!invoice.accessKey) continue;
    const candidate = ensure(invoice.accessKey, invoice, null);
    candidate.strata.add('SEM_ESCRITURACAO');
    classify(candidate, null);
  }
  for (const invoice of recon.efdOnly) {
    if (!invoice.accessKey) continue;
    const candidate = ensure(invoice.accessKey, null, invoice);
    candidate.strata.add('SEM_XML');
    classify(candidate, null);
  }
  // Documentos sem efeito fiscal não entram no pareamento e ficariam de fora da
  // amostra — justamente os que exercitam a leitura do COD_SIT e do cStat.
  for (const invoice of [...recon.xmlIneffective, ...recon.efdIneffective]) {
    if (!invoice.accessKey) continue;
    const candidate = ensure(
      invoice.accessKey,
      invoice.source === 'EFD_ICMS_IPI' ? null : invoice,
      invoice.source === 'EFD_ICMS_IPI' ? invoice : null,
    );
    candidate.strata.add('CANCELADA');
    classify(candidate, null);
  }

  // Ocorrências marcam os documentos sobre os quais alguma regra se pronunciou.
  for (const finding of findings) {
    const key = finding.documentRef;
    if (!key || !candidates.has(key)) continue;
    const candidate = candidates.get(key) as Candidate;
    candidate.ruleCodes.add(finding.ruleCode);
    if (finding.status === 'DIVERGENCIA' || finding.status === 'ALERTA') {
      candidate.strata.add('COM_DIVERGENCIA');
    }
  }

  for (const candidate of candidates.values()) {
    if (!candidate.strata.has('COM_DIVERGENCIA')) candidate.strata.add('SEM_DIVERGENCIA');
  }

  // Ordem determinística: a mesma auditoria produz a mesma amostra, sempre.
  const ordered = [...candidates.values()].sort((a, b) => a.accessKey.localeCompare(b.accessKey));

  const selected = new Set<string>();
  const strata: StratumSummary[] = [];

  for (const [stratum, target] of Object.entries(STRATUM_TARGETS) as [SampleStratum, number][]) {
    const population = ordered.filter((candidate) => candidate.strata.has(stratum));
    // Prefere documentos ainda não escolhidos, para ampliar a cobertura; se a
    // população do estrato já estiver toda na amostra, não força repetição.
    const novos = population.filter((candidate) => !selected.has(candidate.accessKey));
    const escolhidos = novos.slice(0, target);
    for (const candidate of escolhidos) selected.add(candidate.accessKey);

    strata.push({
      stratum,
      label: STRATUM_LABELS[stratum],
      population: population.length,
      selected: escolhidos.length,
      target,
    });
  }

  const documents: SampleDocument[] = ordered
    .filter((candidate) => selected.has(candidate.accessKey))
    .map((candidate) => ({
      accessKey: candidate.accessKey,
      strata: [...candidate.strata].sort(),
      describe: describeCandidate(candidate),
      xml: candidate.xml,
      efd: candidate.efd,
      ruleCodes: [...candidate.ruleCodes].sort(),
    }));

  return { documents, strata, population: ordered.length };
}
