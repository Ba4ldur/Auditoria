/** Persisted entities. Mirrors the PostgreSQL schema in supabase/migrations. */

import type { Competencia } from '@/lib/core/competencia';
import type { Cents } from '@/lib/core/money';
import type { AuditModule, DataSourceKind } from './sources';
import type { TaxRegime } from './model';

export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Company {
  readonly id: string;
  readonly organizationId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly cnpj: string;
  readonly stateRegistration: string | null;
  readonly municipalRegistration: string | null;
  readonly uf: string;
  readonly municipality: string | null;
  readonly taxRegime: TaxRegime;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** History of tax-regime changes (requirement 7). */
export interface CompanyRegimeHistory {
  readonly id: string;
  readonly companyId: string;
  readonly taxRegime: TaxRegime;
  readonly validFrom: Competencia;
  readonly validTo: Competencia | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export type AuditStatus =
  | 'RASCUNHO'
  | 'AGUARDANDO_ARQUIVOS'
  | 'PROCESSANDO'
  | 'CONCLUIDA'
  | 'CONCLUIDA_COM_ERROS'
  | 'ERRO';

export const AUDIT_STATUS_LABELS: Readonly<Record<AuditStatus, string>> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_ARQUIVOS: 'Aguardando arquivos',
  PROCESSANDO: 'Processando',
  CONCLUIDA: 'Concluída',
  CONCLUIDA_COM_ERROS: 'Concluída com alertas',
  ERRO: 'Erro',
};

export type ConformityBand = 'EXCELENTE' | 'BOM' | 'ATENCAO' | 'CRITICO';

export interface Audit {
  readonly id: string;
  readonly organizationId: string;
  readonly companyId: string;
  readonly competencia: Competencia;
  readonly status: AuditStatus;
  readonly score: number | null;
  readonly band: ConformityBand | null;
  readonly documentCount: number;
  /** Comparisons the engine performed and considered correct. */
  readonly crossChecksOk: number;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type FileProcessingStatus =
  | 'PENDENTE'
  | 'PROCESSANDO'
  | 'PROCESSADO'
  | 'PROCESSADO_COM_ALERTAS'
  | 'ERRO';

export const FILE_STATUS_LABELS: Readonly<Record<FileProcessingStatus, string>> = {
  PENDENTE: 'Pendente',
  PROCESSANDO: 'Processando',
  PROCESSADO: 'Processado',
  PROCESSADO_COM_ALERTAS: 'Processado com alertas',
  ERRO: 'Erro',
};

/** Identity compatibility between the file content and the selected company. */
export type IdentityCheck = 'COMPATIVEL' | 'INCOMPATIVEL' | 'NAO_IDENTIFICADO';

/**
 * Confiabilidade da leitura do arquivo (fase 2, requisito 16).
 *
 * O status é apresentado **antes** de o arquivo participar da auditoria. Um
 * arquivo em REQUER_CONFERENCIA pode ser utilizado, mas o sistema avisa de
 * forma explícita que o resultado depende de conferência humana.
 */
export type FileReliability =
  | 'VALIDADO'
  | 'VALIDADO_COM_ALERTAS'
  | 'REQUER_CONFERENCIA'
  | 'INCOMPATIVEL'
  | 'ERRO';

export const RELIABILITY_LABELS: Readonly<Record<FileReliability, string>> = {
  VALIDADO: 'Validado',
  VALIDADO_COM_ALERTAS: 'Validado com alertas',
  REQUER_CONFERENCIA: 'Requer conferência',
  INCOMPATIVEL: 'Incompatível',
  ERRO: 'Erro',
};

export const RELIABILITY_DESCRIPTIONS: Readonly<Record<FileReliability, string>> = {
  VALIDADO: 'Leiaute reconhecido e nenhum alerta registrado na leitura.',
  VALIDADO_COM_ALERTAS: 'O arquivo foi lido, mas há alertas que merecem leitura antes do uso.',
  REQUER_CONFERENCIA:
    'A leitura depende de conferência humana: leiaute não verificado, campos não identificados ' +
    'ou registros relevantes não mapeados.',
  INCOMPATIVEL: 'O CNPJ do arquivo não corresponde à empresa selecionada. Não participa dos cruzamentos.',
  ERRO: 'O arquivo não pôde ser interpretado.',
};

/** Cópia persistida do log de parsing. */
export interface FileParseLog {
  readonly warnings: readonly FileMessage[];
  readonly errors: readonly FileMessage[];
  readonly unsupportedRecords: readonly { code: string; count: number }[];
  readonly unsupportedLayout: {
    readonly declaredVersion: string | null;
    readonly verifiedVersions: readonly string[];
  } | null;
}

/** Resumo estrutural do arquivo, calculado no processamento. */
export interface FileInspection {
  readonly totalLines: number;
  readonly totalRecords: number;
  readonly registers: readonly { code: string; description: string | null; count: number; supported: boolean }[];
}

export interface AuditFile {
  readonly id: string;
  readonly organizationId: string;
  readonly auditId: string;
  readonly originalName: string;
  readonly storagePath: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly detectedSource: DataSourceKind | null;
  readonly detectedTaxId: string | null;
  readonly detectedLegalName: string | null;
  readonly detectedCompetencia: Competencia | null;
  readonly detectedStartDate: string | null;
  readonly detectedEndDate: string | null;
  readonly identityCheck: IdentityCheck;
  readonly reliability: FileReliability;
  readonly status: FileProcessingStatus;
  readonly messages: readonly FileMessage[];
  readonly stats: FileStats | null;
  /** Versão do parser que interpretou este arquivo. */
  readonly parserVersion: string | null;
  readonly parseLog: FileParseLog | null;
  readonly inspection: FileInspection | null;
  /** Set when this file was extracted from a container (ZIP). */
  readonly parentFileId: string | null;
  readonly uploadedAt: string;
  readonly processedAt: string | null;
}

export interface FileMessage {
  readonly level: 'INFO' | 'ALERTA' | 'ERRO';
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
}

export interface FileStats {
  readonly found: number;
  readonly processed: number;
  readonly duplicated: number;
  readonly invalid: number;
  readonly ignored: number;
}

export type Severity = 'INFO' | 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';

export const SEVERITIES: readonly Severity[] = ['INFO', 'BAIXA', 'MEDIA', 'ALTA', 'CRITICA'];

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  INFO: 'Informativa',
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
  CRITICA: 'Crítica',
};

export type FindingStatus =
  | 'OK'
  | 'ALERTA'
  | 'DIVERGENCIA'
  | 'NAO_APLICAVEL'
  | 'NAO_VERIFICADO';

export const FINDING_STATUS_LABELS: Readonly<Record<FindingStatus, string>> = {
  OK: 'OK',
  ALERTA: 'Alerta',
  DIVERGENCIA: 'Divergência',
  NAO_APLICAVEL: 'Não aplicável',
  NAO_VERIFICADO: 'Não verificado',
};

/** Workflow status assigned by the auditor (requirement 22). */
export type ReviewStatus =
  | 'PENDENTE'
  | 'EM_ANALISE'
  | 'PROCEDENTE'
  | 'IMPROCEDENTE'
  | 'CORRIGIDO'
  | 'IGNORADO';

export const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = {
  PENDENTE: 'Pendente',
  EM_ANALISE: 'Em análise',
  PROCEDENTE: 'Procedente',
  IMPROCEDENTE: 'Improcedente',
  CORRIGIDO: 'Corrigido',
  IGNORADO: 'Ignorado',
};

export const REVIEW_STATUSES = Object.keys(REVIEW_STATUS_LABELS) as ReviewStatus[];

/**
 * Distinguishes an arithmetic fact from a tax conclusion (requirement 35).
 *
 * `FATO` findings are fully determined by the data. `INDICIO` findings require
 * a human to decide whether the difference is actually an error, because the
 * answer depends on the nature of the operation or on a tax interpretation.
 */
export type FindingNature = 'FATO' | 'INDICIO';

export interface FindingEvidence {
  readonly id: string;
  readonly label: string;
  /** Where the value came from, in words the auditor can verify. */
  readonly origin: string;
  readonly value: string | null;
  readonly source: DataSourceKind | null;
  readonly fileName: string | null;
  /** Código do registro SPED ou elemento do XML que produziu o valor. */
  readonly recordCode: string | null;
  /**
   * Nome oficial do campo lido, exatamente como consta no leiaute da obrigação
   * (`VL_DOC`, `CHV_NFE`, `vNF`). Guardado separado de `origin`, que é a frase
   * explicativa: conferir um resultado contra o Guia Prático exige o nome do
   * campo isolado, não embutido em texto corrido.
   */
  readonly fieldName: string | null;
  /** Linha do arquivo original, quando a origem é orientada a linha. */
  readonly lineNumber: number | null;
  /**
   * Versão do parser que leu o arquivo de origem. Sem ela não é possível saber
   * se um resultado antigo foi produzido pela leitura atual do campo.
   */
  readonly parserVersion: string | null;
  readonly reference: string | null;
}

export interface AuditFinding {
  readonly id: string;
  readonly organizationId: string;
  readonly auditId: string;
  readonly ruleCode: string;
  readonly ruleName: string;
  /** Versão da regra que produziu a ocorrência (rastreabilidade, fase 3). */
  readonly ruleVersion: string;
  readonly module: AuditModule;
  readonly severity: Severity;
  readonly status: FindingStatus;
  readonly nature: FindingNature;
  readonly title: string;
  readonly description: string;
  readonly documentRef: string | null;
  readonly originLabel: string | null;
  readonly originValue: Cents | null;
  readonly targetLabel: string | null;
  readonly targetValue: Cents | null;
  readonly difference: Cents | null;
  /** Explicit note when the conclusion depends on human analysis. */
  readonly humanReviewNote: string | null;
  readonly evidence: readonly FindingEvidence[];
  readonly reviewStatus: ReviewStatus;
  readonly reviewNote: string | null;
  readonly reviewer: string | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Confirmação manual de um campo extraído (fase 2, requisitos 10 e 11).
 *
 * Guarda o valor original lido pelo parser ao lado do valor confirmado, quem
 * confirmou e quando. O arquivo original nunca é alterado.
 */
export interface FieldConfirmation {
  readonly id: string;
  readonly organizationId: string;
  readonly auditId: string;
  readonly fileId: string;
  /** Chave do campo, conforme o catálogo de campos confirmáveis. */
  readonly field: string;
  readonly originalValue: string | null;
  readonly confirmedValue: string;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
  readonly note: string | null;
}

export interface AuditComment {
  readonly id: string;
  readonly organizationId: string;
  readonly findingId: string;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

/**
 * Tratamento de um CFOP na composição da receita (fase 2, requisitos 5, 6 e 23).
 *
 * O sistema não define tratamento tributário por conta própria. Um CFOP sem
 * regra configurada fica em REVISAR, e o documento correspondente aparece
 * separado do faturamento considerado — nunca escondido, nunca somado por
 * suposição.
 */
export type CfopTreatment = 'INCLUIR' | 'EXCLUIR' | 'REVISAR';

export const CFOP_TREATMENT_LABELS: Readonly<Record<CfopTreatment, string>> = {
  INCLUIR: 'Incluir na receita',
  EXCLUIR: 'Excluir da receita',
  REVISAR: 'Revisar',
};

export const CFOP_TREATMENTS = Object.keys(CFOP_TREATMENT_LABELS) as CfopTreatment[];

/** Procedência da regra: configurada pelo usuário ou carregada pela demonstração. */
export type CfopRuleSource = 'CONFIGURADO' | 'DEMONSTRACAO';

export interface CfopRule {
  readonly id: string;
  readonly organizationId: string;
  readonly cfop: string;
  readonly description: string | null;
  readonly treatment: CfopTreatment;
  /** Justificativa registrada por quem configurou. */
  readonly reason: string | null;
  readonly ruleSource: CfopRuleSource;
  readonly updatedBy: string | null;
  readonly updatedAt: string;
}

/** Per-organization override of a rule's default configuration. */
export interface RuleSetting {
  readonly id: string;
  readonly organizationId: string;
  readonly ruleCode: string;
  readonly enabled: boolean;
  readonly severity: Severity | null;
  readonly absoluteToleranceCents: number | null;
  readonly percentageTolerance: number | null;
  readonly updatedAt: string;
}

export interface ScoreWeights {
  readonly INFO: number;
  readonly BAIXA: number;
  readonly MEDIA: number;
  readonly ALTA: number;
  readonly CRITICA: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = Object.freeze({
  INFO: 0,
  BAIXA: 1,
  MEDIA: 3,
  ALTA: 7,
  CRITICA: 15,
});

export interface OrganizationSettings {
  readonly organizationId: string;
  readonly scoreWeights: ScoreWeights;
  readonly maxUploadBytes: number;
  readonly updatedAt: string;
}
