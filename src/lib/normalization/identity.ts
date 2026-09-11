/**
 * Automatic identification of an imported file (requirement 9).
 *
 * The CNPJ declared inside the file is compared with the company selected for
 * the audit. A mismatch is treated as blocking: data from a different taxpayer
 * is never merged into the dataset, because a single wrong file would
 * contaminate every cross-check of the competencia.
 */

import { formatCnpj, onlyDigits } from '@/lib/core/cnpj';
import { formatCompetencia, type Competencia } from '@/lib/core/competencia';
import type { FileIdentity } from '@/lib/domain/model';
import type { Company, FileMessage, IdentityCheck } from '@/lib/domain/entities';

export interface IdentityAssessment {
  readonly check: IdentityCheck;
  /** True when the file must be excluded from the audit dataset. */
  readonly blocking: boolean;
  readonly messages: readonly FileMessage[];
}

export function assessIdentity(
  identity: FileIdentity,
  company: Pick<Company, 'cnpj' | 'legalName'>,
  competencia: Competencia,
): IdentityAssessment {
  const messages: FileMessage[] = [];
  const expected = onlyDigits(company.cnpj);
  const found = onlyDigits(identity.taxId ?? '');

  if (found === '') {
    messages.push({
      level: 'ALERTA',
      code: 'CNPJ_NAO_IDENTIFICADO',
      message:
        'Não foi possível identificar o CNPJ dentro do arquivo. Confirme manualmente a qual empresa ele pertence.',
    });
    return { check: 'NAO_IDENTIFICADO', blocking: false, messages };
  }

  if (found !== expected) {
    messages.push({
      level: 'ERRO',
      code: 'ARQUIVO_INCOMPATIVEL',
      message: 'ARQUIVO INCOMPATÍVEL: o CNPJ do arquivo não corresponde a empresa selecionada.',
      detail:
        `Empresa selecionada: ${formatCnpj(expected)} (${company.legalName}). ` +
        `CNPJ encontrado no arquivo: ${formatCnpj(found)}` +
        (identity.legalName ? ` (${identity.legalName}).` : '.'),
    });
    return { check: 'INCOMPATIVEL', blocking: true, messages };
  }

  if (identity.competencia && identity.competencia !== competencia) {
    messages.push({
      level: 'ALERTA',
      code: 'COMPETENCIA_DIVERGENTE',
      message:
        `Competência do arquivo (${formatCompetencia(identity.competencia)}) diferente da competência ` +
        `da auditoria (${formatCompetencia(competencia)}).`,
      detail:
        'O arquivo foi mantido na auditoria, mas os cruzamentos por competência devem ser avaliados com atenção.',
    });
  }

  return { check: 'COMPATIVEL', blocking: false, messages };
}
