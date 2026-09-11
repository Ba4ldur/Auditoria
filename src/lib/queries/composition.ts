/**
 * Composições de receita para a tela "Como este valor foi calculado?"
 * (fase 2, requisito 18).
 *
 * A composição é recalculada a partir do conjunto normalizado já persistido e
 * da política vigente, em vez de ser guardada junto com o resultado. Assim ela
 * nunca fica defasada em relação à Política de Receita, e o auditor vê sempre a
 * classificação atual de cada documento.
 */

import { policyFromRules, composeRevenue, type RevenueComposition } from '@/lib/audit-engine';
import { invoicesFrom, xmlInvoices, type AuditDataset } from '@/lib/normalization/dataset';
import { isEffective } from '@/lib/audit-engine/rules/helpers';
import { getStore } from '@/lib/data';
import { loadAuditDataset } from '@/lib/pipeline/process';

export type CompositionKey = 'XML' | 'EFD_ICMS_IPI' | 'EFD_CONTRIBUICOES';

export const COMPOSITION_LABELS: Readonly<Record<CompositionKey, string>> = {
  XML: 'Receita pelos documentos fiscais (XML)',
  EFD_ICMS_IPI: 'Receita pela EFD ICMS/IPI',
  EFD_CONTRIBUICOES: 'Receita pela EFD-Contribuições',
};

export interface AuditCompositions {
  readonly dataset: AuditDataset;
  readonly compositions: ReadonlyMap<CompositionKey, RevenueComposition>;
}

export async function loadCompositions(auditId: string): Promise<AuditCompositions | null> {
  const dataset = await loadAuditDataset(auditId);
  if (!dataset) return null;

  const policy = policyFromRules(await getStore().listCfopRules());
  const compositions = new Map<CompositionKey, RevenueComposition>();

  const xml = xmlInvoices(dataset).filter(isEffective);
  if (xml.length > 0) compositions.set('XML', composeRevenue(xml, policy, 'documentos XML'));

  const icms = invoicesFrom(dataset, 'EFD_ICMS_IPI').filter(isEffective);
  if (icms.length > 0) {
    compositions.set('EFD_ICMS_IPI', composeRevenue(icms, policy, 'documentos escriturados (C100)'));
  }

  const contrib = invoicesFrom(dataset, 'EFD_CONTRIBUICOES').filter(isEffective);
  if (contrib.length > 0) {
    compositions.set(
      'EFD_CONTRIBUICOES',
      composeRevenue(contrib, policy, 'documentos escriturados (C100/A100)'),
    );
  }

  return { dataset, compositions };
}

export async function loadComposition(
  auditId: string,
  key: CompositionKey,
): Promise<RevenueComposition | null> {
  const result = await loadCompositions(auditId);
  return result?.compositions.get(key) ?? null;
}
