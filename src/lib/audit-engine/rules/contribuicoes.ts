/**
 * Rules ATT-PIS-001 and ATT-COF-001.
 *
 * These are the rules where "when technically applicable" carries the most
 * weight, so the applicability test is explicit:
 *
 *  - Companies taxed under the Simples Nacional collect the Contribuicao para o
 *    PIS/Pasep and the COFINS inside the DAS (Lei Complementar 123/2006,
 *    art. 13, incisos IV e V). Comparing document-level contributions against
 *    an EFD-Contribuicoes consolidation is meaningless in that scenario, so the
 *    rule reports NAO_APLICAVEL instead of manufacturing a divergence.
 *  - The comparison uses the contribution ASSESSED for the period (registers
 *    M200/M600, fields VL_TOT_CONT_NC_PER + VL_TOT_CONT_CUM_PER) and not the
 *    amount left to collect, which is already net of credits, withholdings and
 *    other deductions that do not appear on the documents.
 *
 * Even so, the result is an INDICIO: adjustments, exclusions from the base and
 * operations outside block C legitimately break the equality.
 */

import { formatBRL, sumCents, type Cents } from '@/lib/core/money';
import type { Invoice, TaxKind } from '@/lib/domain/model';
import { invoicesFrom } from '@/lib/normalization/dataset';
import { compareValues } from '../tolerance';
import { DEFAULT_TOLERANCE, type AuditRule, type RuleContext, type RuleResult } from '../types';
import { evidence, isEffective, moneyEvidence } from './helpers';

interface ContributionRuleSpec {
  readonly id: string;
  readonly codigo: string;
  readonly nome: string;
  readonly tax: Extract<TaxKind, 'PIS' | 'COFINS'>;
  readonly register: string;
  readonly pick: (invoice: Invoice) => Cents;
}

function contributionRule(spec: ContributionRuleSpec): AuditRule {
  return {
    id: spec.id,
    codigo: spec.codigo,
    nome: spec.nome,
    descricao:
      `Compara o somatório de ${spec.tax} dos documentos de saída escriturados na EFD-Contribuições com a ` +
      `contribuição apurada no período (registro ${spec.register}).`,
    modulo: 'TRIBUTARIO',
    gravidade: 'ALTA',
    documentosNecessarios: ['EFD_CONTRIBUICOES'],
    toleranciaPadrao: DEFAULT_TOLERANCE,
    limitacoes:
      'A regra só é executada quando a comparação é tecnicamente aplicável. Mesmo aplicável, o resultado é um ' +
      'indício: ajustes, exclusões de base e operações fora do bloco C alteram legitimamente a apuração.',
    executar(context: RuleContext): RuleResult {
      const { dataset } = context;

      if (dataset.company.taxRegime === 'SIMPLES_NACIONAL') {
        return {
          cruzamentosCorretos: 0,
          findings: [
            {
              resultado: 'NAO_APLICAVEL',
              natureza: 'FATO',
              titulo: `${spec.codigo}: comparação não aplicável ao regime da empresa`,
              descricao:
                `A empresa está cadastrada no Simples Nacional. A Contribuição para o PIS/Pasep e a COFINS são ` +
                'recolhidas no documento único de arrecadação (Lei Complementar 123/2006, art. 13), de modo que a ' +
                `comparação com a apuração do registro ${spec.register} não se aplica.`,
              evidencias: [
                evidence('Regime tributário cadastrado', 'Cadastro da empresa no sistema', 'Simples Nacional'),
              ],
            },
          ],
          naoAplicavel: 'Empresa no Simples Nacional.',
        };
      }

      if (!dataset.availableSources.has('EFD_CONTRIBUICOES')) {
        return {
          cruzamentosCorretos: 0,
          findings: [
            {
              resultado: 'NAO_VERIFICADO',
              natureza: 'FATO',
              titulo: `${spec.codigo}: cruzamento não executado`,
              descricao: 'Arquivo da EFD-Contribuições não importado nesta auditoria.',
              evidencias: [],
            },
          ],
          naoAplicavel: 'EFD-Contribuições ausente.',
        };
      }

      const assessed = dataset.taxes.find(
        (record) =>
          record.source === 'EFD_CONTRIBUICOES' &&
          record.tax === spec.tax &&
          record.metric === 'DEVIDO_PERIODO',
      );

      if (!assessed) {
        return {
          cruzamentosCorretos: 0,
          findings: [
            {
              resultado: 'NAO_VERIFICADO',
              natureza: 'FATO',
              titulo: `${spec.codigo}: apuração do período não localizada`,
              descricao:
                `O registro ${spec.register} não foi localizado no arquivo da EFD-Contribuições, portanto não ha ` +
                'valor apurado para comparar.',
              evidencias: [],
            },
          ],
          naoAplicavel: `Registro ${spec.register} ausente.`,
        };
      }

      const documents = invoicesFrom(dataset, 'EFD_CONTRIBUICOES')
        .filter(isEffective)
        .filter((invoice) => invoice.direction === 'SAIDA');
      const fromDocuments = sumCents(documents.map(spec.pick));

      const comparison = compareValues(fromDocuments, assessed.amount, context.config.tolerancia);
      const evidencias = [
        moneyEvidence(
          `${spec.tax} nos documentos`,
          `Somatório de ${spec.tax} de ${documents.length} documento(s) de saída escriturados na EFD-Contribuições.`,
          fromDocuments,
          { source: 'EFD_CONTRIBUICOES', fileName: documents[0]?.fileName ?? null },
        ),
        moneyEvidence(`${spec.tax} apurado no período`, assessed.description, assessed.amount, {
          source: 'EFD_CONTRIBUICOES',
          fileName: assessed.fileName,
        }),
        evidence('Tolerância', 'Configuração da regra', comparison.toleranceLabel),
      ];

      if (comparison.withinTolerance) {
        return { cruzamentosCorretos: 1, findings: [] };
      }

      return {
        cruzamentosCorretos: 0,
        findings: [
          {
            resultado: 'DIVERGENCIA',
            natureza: 'INDICIO',
            titulo: spec.nome,
            descricao:
              `${spec.tax} somado dos documentos: ${formatBRL(comparison.origin)}. ` +
              `${spec.tax} apurado no registro ${spec.register}: ${formatBRL(comparison.target)}. ` +
              `Diferença de ${formatBRL(comparison.difference)}.`,
            rotuloOrigem: `${spec.tax} nos documentos`,
            valorOrigem: comparison.origin,
            rotuloDestino: `${spec.tax} apurado (${spec.register})`,
            valorDestino: comparison.target,
            diferenca: comparison.difference,
            analiseHumana:
              'Avalie ajustes da apuração, exclusões de base e receitas escrituradas fora do bloco C antes de ' +
              'concluir por erro. A diferença isolada não caracteriza recolhimento a menor.',
            evidencias,
          },
        ],
      };
    },
  };
}

export const attPis001 = contributionRule({
  id: 'att-pis-001',
  codigo: 'ATT-PIS-001',
  nome: 'PIS dos documentos divergente da apuração da EFD-Contribuições',
  tax: 'PIS',
  register: 'M200',
  pick: (invoice) => invoice.totals.pis,
});

export const attCof001 = contributionRule({
  id: 'att-cof-001',
  codigo: 'ATT-COF-001',
  nome: 'COFINS dos documentos divergente da apuração da EFD-Contribuições',
  tax: 'COFINS',
  register: 'M600',
  pick: (invoice) => invoice.totals.cofins,
});

export const CONTRIBUICOES_RULES: readonly AuditRule[] = [attPis001, attCof001];
