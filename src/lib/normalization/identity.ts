/**
 * Automatic identification of an imported file (requirement 9).
 *
 * The CNPJ declared inside the file is compared with the company selected for
 * the audit. A mismatch is treated as blocking: data from a different taxpayer
 * is never merged into the dataset, because a single wrong file would
 * contaminate every cross-check of the competencia.
 *
 * O arquivo é aceito quando a empresa figura em QUALQUER dos polos da operação.
 * Um XML de entrada é emitido por terceiro e traz o CNPJ do fornecedor como
 * emitente; recusá-lo por isso inviabilizaria auditar entradas — e recusa
 * silenciosa de metade dos documentos é pior do que não auditá-los, porque o
 * relatório sai completo e errado.
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
    const related = identity.relatedTaxIds.map((taxId) => onlyDigits(taxId));

    // A empresa é a contraparte: documento recebido de terceiro, legítimo na
    // auditoria. O arquivo entra, e a condição fica registrada.
    if (related.includes(expected)) {
      messages.push({
        level: 'INFO',
        code: 'DOCUMENTO_DE_TERCEIRO',
        message:
          'Documento emitido por terceiro contra a empresa auditada. Aceito como operação de entrada.',
        detail:
          `Emitente: ${formatCnpj(found)}` +
          (identity.legalName ? ` (${identity.legalName}).` : '.') +
          ` Destinatário: ${formatCnpj(expected)} (${company.legalName}).`,
      });
      return { check: 'COMPATIVEL', blocking: false, messages };
    }

    messages.push({
      level: 'ERRO',
      code: 'ARQUIVO_INCOMPATIVEL',
      message: 'ARQUIVO INCOMPATÍVEL: o CNPJ do arquivo não corresponde a empresa selecionada.',
      detail:
        `Empresa selecionada: ${formatCnpj(expected)} (${company.legalName}). ` +
        `CNPJ encontrado no arquivo: ${formatCnpj(found)}` +
        (identity.legalName ? ` (${identity.legalName}).` : '.') +
        (related.length > 0
          ? ` Demais partes declaradas no arquivo: ${related.map(formatCnpj).join(', ')}.`
          : ''),
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
