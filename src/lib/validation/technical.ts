/**
 * Validação técnica do motor.
 *
 * # O que esta camada é, e o que ela não é
 *
 * Não é o relatório de auditoria. O relatório responde "a escrituração desta
 * empresa está correta?". Esta camada responde uma pergunta anterior e
 * diferente: **"o sistema leu os arquivos corretamente e cruzou o que deveria
 * cruzar?"**. Confundir as duas é perigoso nos dois sentidos — um motor com
 * defeito produz relatório limpo, e um motor correto produz relatório sujo
 * quando a escrituração é que está errada.
 *
 * Por isso tudo aqui é apresentado em termos de **leitura e cobertura**, nunca
 * de conformidade fiscal: contagens de registros, versões de parser, o que foi
 * interpretado e o que ficou de fora.
 */

import type { Competencia } from '@/lib/core/competencia';
import type { AuditFile, Company, DocumentValidation } from '@/lib/domain/entities';
import type { DataSourceKind } from '@/lib/domain/sources';
import type { AuditDataset } from '@/lib/normalization/dataset';
import { invoicesFrom, xmlInvoices } from '@/lib/normalization/dataset';
import {
  COVERAGE_LEVEL_LABELS,
  coverageOf,
  type CoverageLevel,
} from '@/lib/parsers/sped/efd-icms-ipi/coverage';

export { COVERAGE_LEVEL_LABELS };

// ---------------------------------------------------------------------------
// Identificação do que foi lido
// ---------------------------------------------------------------------------

export interface FileIdentitySummary {
  readonly fileId: string;
  readonly fileName: string;
  readonly source: DataSourceKind | null;
  readonly parserVersion: string | null;
  /** CNPJ declarado dentro do arquivo, e não o da empresa cadastrada. */
  readonly taxIdInFile: string | null;
  readonly legalNameInFile: string | null;
  readonly competenciaInFile: Competencia | null;
  /** `COD_VER` do registro 0000, para arquivos SPED. */
  readonly layoutVersion: string | null;
  readonly reliability: AuditFile['reliability'];
  readonly identityCheck: AuditFile['identityCheck'];
}

export interface RegisterTally {
  readonly code: string;
  readonly description: string;
  readonly count: number;
  readonly level: CoverageLevel;
  readonly detail: string;
}

export interface CoverageTally {
  readonly registers: readonly RegisterTally[];
  readonly byLevel: Readonly<Record<CoverageLevel, { readonly types: number; readonly records: number }>>;
  readonly totalTypes: number;
  readonly totalRecords: number;
}

export interface TechnicalPanel {
  readonly company: { readonly legalName: string; readonly cnpj: string };
  readonly competencia: Competencia;
  readonly files: readonly FileIdentitySummary[];
  /** CNPJ encontrado nos XML importados, distintos entre si. */
  readonly taxIdsInXml: readonly string[];
  /** CNPJ encontrado nos arquivos da EFD ICMS/IPI. */
  readonly taxIdsInEfd: readonly string[];
  readonly counts: {
    readonly xmlFiles: number;
    readonly xmlDocuments: number;
    readonly efdDocuments: number;
    readonly efdItems: number;
    readonly efdAnalytics: number;
  };
}

/**
 * Extrai a versão do leiaute declarada no arquivo (campo COD_VER do registro
 * 0000, para um SPED).
 *
 * `parseLog.layoutVersion` é preenchida pelo parser sempre que a versão é
 * identificada, verificada ou não. `unsupportedLayout.declaredVersion` só
 * existe quando a versão NÃO está na lista verificada; é mantida aqui como
 * segunda fonte só para arquivos processados antes desta versão do sistema,
 * cujo `parseLog` gravado no banco não tem o campo novo.
 */
function layoutVersionOf(file: AuditFile): string | null {
  return file.parseLog?.layoutVersion ?? file.parseLog?.unsupportedLayout?.declaredVersion ?? null;
}

export function buildTechnicalPanel(input: {
  readonly company: Company;
  readonly competencia: Competencia;
  readonly files: readonly AuditFile[];
  readonly dataset: AuditDataset;
}): TechnicalPanel {
  const { company, competencia, files, dataset } = input;

  const xml = xmlInvoices(dataset);
  const efd = invoicesFrom(dataset, 'EFD_ICMS_IPI');

  const distinct = (values: readonly (string | null)[]): string[] =>
    [...new Set(values.filter((value): value is string => Boolean(value)))].sort();

  return {
    company: { legalName: company.legalName, cnpj: company.cnpj },
    competencia,
    files: files.map((file) => ({
      fileId: file.id,
      fileName: file.originalName,
      source: file.detectedSource,
      parserVersion: file.parserVersion,
      taxIdInFile: file.detectedTaxId,
      legalNameInFile: file.detectedLegalName,
      competenciaInFile: file.detectedCompetencia,
      layoutVersion: layoutVersionOf(file),
      reliability: file.reliability,
      identityCheck: file.identityCheck,
    })),
    // O CNPJ do XML é o do emitente ou o do destinatário, conforme o documento:
    // em um acervo com entradas, os dois aparecem, e é assim que deve ser.
    taxIdsInXml: distinct(xml.flatMap((invoice) => [invoice.emitterTaxId, invoice.recipientTaxId])),
    taxIdsInEfd: distinct(
      files.filter((file) => file.detectedSource === 'EFD_ICMS_IPI').map((file) => file.detectedTaxId),
    ),
    counts: {
      xmlFiles: files.filter(
        (file) => file.detectedSource === 'XML_NFE' || file.detectedSource === 'XML_NFCE',
      ).length,
      xmlDocuments: xml.length,
      efdDocuments: efd.length,
      efdItems: efd.reduce((sum, invoice) => sum + invoice.items.length, 0),
      efdAnalytics: efd.reduce((sum, invoice) => sum + invoice.cfops.length, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Cobertura dos registros encontrados
// ---------------------------------------------------------------------------

const EMPTY_LEVELS: Record<CoverageLevel, { types: number; records: number }> = {
  SUPORTADO: { types: 0, records: 0 },
  PARCIALMENTE_SUPORTADO: { types: 0, records: 0 },
  NAO_SUPORTADO: { types: 0, records: 0 },
};

/**
 * Classifica os registros efetivamente encontrados no arquivo.
 *
 * A entrada é a contagem gravada na inspeção do arquivo — o que **está** no
 * arquivo, não o que o catálogo esperava encontrar. Registro presente e não
 * catalogado entra como não suportado, com o detalhe genérico: um arquivo real
 * traz registros que o catálogo não antecipou, e omiti-los daria a impressão de
 * que foram analisados.
 */
export function tallyCoverage(
  registers: readonly { readonly code: string; readonly count: number }[],
): CoverageTally {
  const byLevel: Record<CoverageLevel, { types: number; records: number }> = {
    SUPORTADO: { ...EMPTY_LEVELS.SUPORTADO },
    PARCIALMENTE_SUPORTADO: { ...EMPTY_LEVELS.PARCIALMENTE_SUPORTADO },
    NAO_SUPORTADO: { ...EMPTY_LEVELS.NAO_SUPORTADO },
  };

  const tallies: RegisterTally[] = registers
    .map((entry) => {
      const coverage = coverageOf(entry.code);
      byLevel[coverage.level].types += 1;
      byLevel[coverage.level].records += entry.count;
      return {
        code: entry.code,
        description: coverage.description,
        count: entry.count,
        level: coverage.level,
        detail: coverage.detail,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    registers: tallies,
    byLevel,
    totalTypes: tallies.length,
    totalRecords: tallies.reduce((sum, entry) => sum + entry.count, 0),
  };
}

// ---------------------------------------------------------------------------
// Cobertura documental
// ---------------------------------------------------------------------------

export interface DocumentCoverage {
  /** Documentos que o sistema conseguiu analisar documento a documento. */
  readonly analysed: number;
  /** Documentos presentes na escrituração, quando esse total é conhecido. */
  readonly totalKnown: number | null;
  /** Percentual, apenas quando calculável de forma defensável. */
  readonly percentage: number | null;
  /** Por que o percentual pôde ou não ser calculado. */
  readonly basis: string;
}

/**
 * Cobertura documental da análise.
 *
 * **O percentual só é calculado quando o denominador é conhecido.** Se a
 * escrituração traz registros de consolidação que este parser não lê, não há
 * como saber quantos documentos eles representam — cada redução Z pode conter
 * um ou mil cupons. Estimar nesse caso seria fabricar um número de aparência
 * técnica e sem lastro, exatamente o tipo de conforto falso que esta tela
 * existe para evitar.
 */
export function documentCoverage(input: {
  readonly efdDocuments: number;
  readonly registers: readonly RegisterTally[];
}): DocumentCoverage {
  const consolidacao = input.registers.filter(
    (entry) => entry.level === 'NAO_SUPORTADO' && entry.count > 0,
  );

  if (consolidacao.length > 0) {
    return {
      analysed: input.efdDocuments,
      totalKnown: null,
      percentage: null,
      basis:
        `Não calculável: o arquivo contém ${consolidacao.length} tipo(s) de registro não interpretado(s) ` +
        `(${consolidacao.map((entry) => entry.code).join(', ')}). Registros de consolidação não declaram quantos ` +
        'documentos representam, de modo que o total da escrituração é desconhecido e qualquer percentual seria ' +
        'arbitrado.',
    };
  }

  return {
    analysed: input.efdDocuments,
    totalKnown: input.efdDocuments,
    percentage: 100,
    basis:
      'Calculável: todos os registros presentes no arquivo são interpretados, e a escrituração é documento a ' +
      'documento. Todo documento escriturado participou da análise.',
  };
}

// ---------------------------------------------------------------------------
// Relatório da validação
// ---------------------------------------------------------------------------

export interface ValidationReport {
  readonly documentsAnalysed: number;
  readonly manuallyChecked: number;
  readonly correct: number;
  readonly parserDefects: number;
  readonly crossCheckDefects: number;
  readonly requiresAnalysis: number;
  readonly coverage: DocumentCoverage;
  readonly registerTypes: number;
  readonly registerTypesSupported: number;
  readonly registerTypesPartial: number;
  readonly registerTypesUnsupported: number;
  /** Conclusão em uma frase, sem adjetivo que o dado não sustente. */
  readonly veredito: string;
}

export function buildValidationReport(input: {
  readonly documentsAnalysed: number;
  readonly validations: readonly DocumentValidation[];
  readonly coverage: DocumentCoverage;
  readonly tally: CoverageTally;
}): ValidationReport {
  const { validations, tally } = input;
  const count = (status: DocumentValidation['status']): number =>
    validations.filter((entry) => entry.status === status).length;

  const parserDefects = count('PARSER_INCORRETO');
  const crossCheckDefects = count('CRUZAMENTO_INCORRETO');
  const requiresAnalysis = count('REQUER_ANALISE');
  const correct = count('CORRETO');

  return {
    documentsAnalysed: input.documentsAnalysed,
    manuallyChecked: validations.length,
    correct,
    parserDefects,
    crossCheckDefects,
    requiresAnalysis,
    coverage: input.coverage,
    registerTypes: tally.totalTypes,
    registerTypesSupported: tally.byLevel.SUPORTADO.types,
    registerTypesPartial: tally.byLevel.PARCIALMENTE_SUPORTADO.types,
    registerTypesUnsupported: tally.byLevel.NAO_SUPORTADO.types,
    veredito: verdictFor({ validations: validations.length, parserDefects, crossCheckDefects, requiresAnalysis }),
  };
}

function verdictFor(input: {
  validations: number;
  parserDefects: number;
  crossCheckDefects: number;
  requiresAnalysis: number;
}): string {
  if (input.validations === 0) {
    return 'Nenhum documento foi conferido manualmente. A validação do motor ainda não começou.';
  }
  if (input.parserDefects > 0 || input.crossCheckDefects > 0) {
    const partes = [
      ...(input.parserDefects > 0 ? [`${input.parserDefects} de leitura do arquivo`] : []),
      ...(input.crossCheckDefects > 0 ? [`${input.crossCheckDefects} de cruzamento`] : []),
    ];
    return `Defeitos apontados na conferência: ${partes.join(' e ')}. Corrija antes de considerar o motor validado.`;
  }
  if (input.requiresAnalysis > 0) {
    return (
      `${input.requiresAnalysis} documento(s) marcados como "requer análise". A conferência não apontou defeito ` +
      'do motor, mas também não está concluída.'
    );
  }
  return (
    'A conferência manual não apontou defeito de leitura nem de cruzamento nos documentos analisados. Isso vale ' +
    'para a amostra conferida, não para todos os cenários tributários.'
  );
}
