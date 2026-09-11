/**
 * Classificação de confiabilidade do arquivo (fase 2, requisito 16).
 *
 * O status é derivado do que a leitura efetivamente encontrou, nunca de uma
 * suposição otimista. Na dúvida, o resultado é REQUER_CONFERENCIA: é preferível
 * pedir conferência a apresentar como validado um arquivo cuja leitura o
 * sistema não consegue garantir.
 */

import type {
  FileMessage,
  FileParseLog,
  FileReliability,
  IdentityCheck,
} from '@/lib/domain/entities';
import type { Declaration } from '@/lib/domain/model';
import type { ParseLog } from '@/lib/parsers/types';

/** Registros cuja ausência de mapeamento compromete os cruzamentos atuais. */
const SIGNIFICANT_RECORDS = new Set([
  'C100', 'C170', 'C190', 'C175', 'A100', 'F100', 'E110', 'M200', 'M600',
]);

export function toFileParseLog(log: ParseLog): FileParseLog {
  return {
    warnings: log.warnings,
    errors: log.errors,
    unsupportedRecords: log.unsupportedRecords,
    unsupportedLayout: log.unsupportedLayout,
  };
}

export interface ReliabilityInput {
  readonly identityCheck: IdentityCheck;
  readonly failed: boolean;
  readonly log: FileParseLog | null;
  readonly messages: readonly FileMessage[];
  readonly declarations: readonly Declaration[];
}

export interface ReliabilityOutcome {
  readonly reliability: FileReliability;
  /** Motivos que levaram ao status, exibidos ao lado dele. */
  readonly reasons: readonly string[];
}

export function classifyReliability(input: ReliabilityInput): ReliabilityOutcome {
  const reasons: string[] = [];

  if (input.identityCheck === 'INCOMPATIVEL') {
    return {
      reliability: 'INCOMPATIVEL',
      reasons: ['O CNPJ identificado no arquivo não corresponde à empresa da auditoria.'],
    };
  }

  if (input.failed || (input.log?.errors.length ?? 0) > 0) {
    return {
      reliability: 'ERRO',
      reasons: [
        ...(input.log?.errors ?? []).map((message) => message.message),
        ...(input.failed ? ['O arquivo não pôde ser processado.'] : []),
      ],
    };
  }

  let requiresReview = false;

  const layout = input.log?.unsupportedLayout ?? null;
  if (layout) {
    requiresReview = true;
    reasons.push(
      `Leiaute declarado (COD_VER ${layout.declaredVersion ?? 'não informado'}) não consta na lista ` +
        `verificada deste parser (${layout.verifiedVersions.join(', ') || 'nenhuma'}). ` +
        'O arquivo foi processado, mas os resultados precisam de conferência.',
    );
  }

  const significant = (input.log?.unsupportedRecords ?? []).filter((entry) =>
    SIGNIFICANT_RECORDS.has(entry.code),
  );
  if (significant.length > 0) {
    requiresReview = true;
    reasons.push(
      'Registros relevantes para os cruzamentos não são lidos por este parser: ' +
        significant.map((entry) => `${entry.code} (${entry.count})`).join(', ') + '.',
    );
  }

  for (const declaration of input.declarations) {
    if (declaration.confidence === 'ALTA' && declaration.unresolvedFields.length === 0) continue;
    requiresReview = true;
    reasons.push(
      declaration.unresolvedFields.length > 0
        ? `Campos não identificados automaticamente: ${declaration.unresolvedFields.join('; ')}. ` +
          'Confirme manualmente antes de usar na auditoria.'
        : `A extração deste documento tem confiança ${declaration.confidence.toLowerCase()}. ` +
          'Confirme os valores antes de usar na auditoria.',
    );
  }

  if (requiresReview) return { reliability: 'REQUER_CONFERENCIA', reasons };

  const warnings = [
    ...(input.log?.warnings ?? []),
    ...input.messages.filter((message) => message.level === 'ALERTA'),
  ];
  if (warnings.length > 0) {
    return {
      reliability: 'VALIDADO_COM_ALERTAS',
      reasons: [...new Set(warnings.map((message) => message.message))].slice(0, 8),
    };
  }

  if (input.identityCheck === 'NAO_IDENTIFICADO') {
    return {
      reliability: 'VALIDADO_COM_ALERTAS',
      reasons: ['O CNPJ não pôde ser identificado dentro do arquivo.'],
    };
  }

  return { reliability: 'VALIDADO', reasons: [] };
}

/** Arquivos que não devem alimentar os cruzamentos. */
export function blocksAudit(reliability: FileReliability): boolean {
  return reliability === 'INCOMPATIVEL' || reliability === 'ERRO';
}

/**
 * Confiabilidade atribuída no momento do upload (requisito 16).
 *
 * Nesse ponto o arquivo ainda não foi interpretado: apenas identificado. Por
 * isso nunca se conclui VALIDADO aqui — o melhor status possível é
 * REQUER_CONFERENCIA, refinado depois pelo processamento.
 */
export function classifyUploadReliability(input: {
  readonly identityCheck: IdentityCheck;
  readonly failed: boolean;
}): FileReliability {
  if (input.identityCheck === 'INCOMPATIVEL') return 'INCOMPATIVEL';
  if (input.failed) return 'ERRO';
  return 'REQUER_CONFERENCIA';
}
