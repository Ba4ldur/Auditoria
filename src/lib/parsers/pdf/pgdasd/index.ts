/**
 * PGDAS-D parser (textual PDF, no OCR).
 *
 * The extract issued by the Simples Nacional portal has no stable machine
 * layout: wording, line breaks and column order change between versions and
 * between the "extrato" and the "declaracao" prints. The parser therefore works
 * on labelled patterns rather than on fixed positions, and every extracted
 * value carries:
 *   - a confidence level, and
 *   - the exact text fragment it was read from (traceability, requirement 21).
 *
 * A field that cannot be determined with confidence is NEVER guessed: it is
 * returned as "nao identificado automaticamente" and the interface asks the
 * auditor to confirm it manually (requirement 14).
 */

import { parseDecimalToCents, ZERO, type Cents } from '@/lib/core/money';
import { parseCompetencia, type Competencia } from '@/lib/core/competencia';
import { formatCnpj, isValidCnpj, onlyDigits } from '@/lib/core/cnpj';
import { deterministicId } from '@/lib/core/hash';
import { ok, type Result } from '@/lib/core/result';
import {
  EMPTY_IDENTITY,
  extracted,
  notIdentified,
  type Declaration,
  type DeclarationLine,
  type ExtractedField,
  type ExtractionConfidence,
  type RevenueRecord,
  type SegregatedRevenue,
  type TaxKind,
  type TaxRecord,
} from '@/lib/domain/model';
import type { FileMessage } from '@/lib/domain/entities';
import { extractPdfText, isPdf, normalizeForMatch } from '../text';
import type { DetectionHint, DetectionInput, FileParser, ParsedPayload, ParserInput } from '../../types';

const MONEY = String.raw`(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})`;

interface MatchOutcome {
  readonly raw: string;
  readonly evidence: string;
  readonly patternIndex: number;
}

/**
 * Runs the patterns in order of specificity. The index of the pattern that
 * matched drives the confidence: the first pattern is the exact wording of the
 * official extract, later ones are progressively looser fallbacks.
 */
function matchFirst(text: string, patterns: readonly RegExp[]): MatchOutcome | null {
  for (const [index, pattern] of patterns.entries()) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const start = Math.max(0, match.index - 10);
      return {
        raw: match[1],
        evidence: text.slice(start, Math.min(text.length, match.index + match[0].length + 10)).trim(),
        patternIndex: index,
      };
    }
  }
  return null;
}

function confidenceFor(patternIndex: number): ExtractionConfidence {
  if (patternIndex === 0) return 'ALTA';
  if (patternIndex === 1) return 'MEDIA';
  return 'BAIXA';
}

function moneyField(text: string, patterns: readonly RegExp[]): ExtractedField<Cents> {
  const outcome = matchFirst(text, patterns);
  if (!outcome) return notIdentified<Cents>();
  const value = parseDecimalToCents(outcome.raw);
  if (value === null) return notIdentified<Cents>();
  return extracted(value, confidenceFor(outcome.patternIndex), outcome.evidence);
}

const CNPJ_PATTERNS = [
  /CNPJ\s*(?:MATRIZ|BASICO|DA\s+MATRIZ)?\s*:?\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/,
  /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/,
];

const NAME_PATTERNS = [
  /NOME\s+EMPRESARIAL\s*:?\s*([A-Z0-9&.,'\-\/ ]{4,120}?)(?:\s{2,}|CNPJ|PERIODO|$)/,
  /RAZAO\s+SOCIAL\s*:?\s*([A-Z0-9&.,'\-\/ ]{4,120}?)(?:\s{2,}|CNPJ|PERIODO|$)/,
];

const PERIOD_PATTERNS = [
  /PERIODO\s+DE\s+APURACAO\s*(?:\(PA\))?\s*:?\s*(\d{2}\/\d{4})/,
  /\bPA\s*:?\s*(\d{2}\/\d{4})/,
  /COMPETENCIA\s*:?\s*(\d{2}\/\d{4})/,
];

const GROSS_REVENUE_PATTERNS = [
  new RegExp(String.raw`RECEITA\s+BRUTA\s+DO\s+PA\s*(?:\(RPA\))?[^\d]{0,60}${MONEY}`),
  new RegExp(String.raw`RECEITA\s+BRUTA\s+DO\s+PERIODO\s+DE\s+APURACAO[^\d]{0,60}${MONEY}`),
  new RegExp(String.raw`RECEITA\s+BRUTA\s+MENSAL[^\d]{0,60}${MONEY}`),
];

const RBT12_PATTERNS = [
  new RegExp(String.raw`RBT12[^\d]{0,60}${MONEY}`),
  new RegExp(String.raw`RECEITA\s+BRUTA\s+(?:DOS\s+)?(?:ACUMULADA\s+)?(?:NOS\s+)?(?:DOZE|12)\s+MESES\s+ANTERIORES[^\d]{0,60}${MONEY}`),
];

const TOTAL_DUE_PATTERNS = [
  new RegExp(String.raw`TOTAL\s+DO\s+DEBITO\s+EXIGIVEL[^\d]{0,60}${MONEY}`),
  new RegExp(String.raw`VALOR\s+TOTAL\s+DEVIDO[^\d]{0,60}${MONEY}`),
  new RegExp(String.raw`TOTAL\s+DEVIDO[^\d]{0,60}${MONEY}`),
  new RegExp(String.raw`TOTAL\s+GERAL\s+DO\s+DAS[^\d]{0,60}${MONEY}`),
];

/** Taxes itemised inside the PGDAS-D extract. */
const TAX_PATTERNS: readonly { kind: TaxKind; label: string; pattern: RegExp }[] = [
  { kind: 'IRPJ', label: 'IRPJ', pattern: new RegExp(String.raw`\bIRPJ\b[^\d]{0,40}${MONEY}`) },
  { kind: 'CSLL', label: 'CSLL', pattern: new RegExp(String.raw`\bCSLL\b[^\d]{0,40}${MONEY}`) },
  { kind: 'COFINS', label: 'COFINS', pattern: new RegExp(String.raw`\bCOFINS\b[^\d]{0,40}${MONEY}`) },
  { kind: 'PIS', label: 'PIS/Pasep', pattern: new RegExp(String.raw`PIS(?:\/PASEP)?\b[^\d]{0,40}${MONEY}`) },
  { kind: 'CPP', label: 'CPP', pattern: new RegExp(String.raw`\bCPP\b[^\d]{0,40}${MONEY}`) },
  { kind: 'ICMS', label: 'ICMS', pattern: new RegExp(String.raw`\bICMS\b[^\d]{0,40}${MONEY}`) },
  { kind: 'IPI', label: 'IPI', pattern: new RegExp(String.raw`\bIPI\b[^\d]{0,40}${MONEY}`) },
  { kind: 'ISS', label: 'ISS', pattern: new RegExp(String.raw`\bISS\b[^\d]{0,40}${MONEY}`) },
];

/** Revenue segregation labels used by the Simples Nacional activity tables. */
const SEGREGATION_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  {
    label: 'Revenda de mercadorias',
    pattern: new RegExp(String.raw`REVENDA\s+DE\s+MERCADORIAS[^\d]{0,80}${MONEY}`),
  },
  {
    label: 'Venda de mercadorias industrializadas pelo contribuinte',
    pattern: new RegExp(String.raw`VENDA\s+DE\s+MERCADORIAS\s+INDUSTRIALIZADAS[^\d]{0,80}${MONEY}`),
  },
  {
    label: 'Prestacao de serviços',
    pattern: new RegExp(String.raw`PRESTACAO\s+DE\s+SERVICOS[^\d]{0,80}${MONEY}`),
  },
  {
    label: 'Locacao de bens moveis',
    pattern: new RegExp(String.raw`LOCACAO\s+DE\s+BENS\s+MOVEIS[^\d]{0,80}${MONEY}`),
  },
];

export interface PgdasdExtraction {
  readonly declaration: Declaration;
  readonly messages: readonly FileMessage[];
}

export function parsePgdasdText(
  rawText: string,
  context: { fileId: string; fileName: string },
): PgdasdExtraction {
  const text = normalizeForMatch(rawText);
  const messages: FileMessage[] = [];
  const unresolved: string[] = [];

  const cnpjOutcome = matchFirst(text, CNPJ_PATTERNS);
  const cnpjDigits = cnpjOutcome ? onlyDigits(cnpjOutcome.raw) : '';
  const taxId = cnpjDigits.length === 14 ? cnpjDigits : null;
  if (taxId && !isValidCnpj(taxId)) {
    messages.push({
      level: 'ALERTA',
      code: 'PGDASD_CNPJ_INVALIDO',
      message: `CNPJ ${formatCnpj(taxId)} localizado no PDF não passou na validação de dígitos verificadores.`,
    });
  }
  if (!taxId) unresolved.push('CNPJ');

  const nameOutcome = matchFirst(text, NAME_PATTERNS);
  const legalName = nameOutcome ? nameOutcome.raw.trim() : null;
  if (!legalName) unresolved.push('Nome empresarial');

  const periodOutcome = matchFirst(text, PERIOD_PATTERNS);
  const competenciaValue = periodOutcome ? parseCompetencia(periodOutcome.raw) : null;
  const competencia: ExtractedField<Competencia> = competenciaValue
    ? extracted(competenciaValue, confidenceFor(periodOutcome?.patternIndex ?? 2), periodOutcome?.evidence ?? null)
    : notIdentified<Competencia>();
  if (!competenciaValue) unresolved.push('Período de apuração');

  const grossRevenue = moneyField(text, GROSS_REVENUE_PATTERNS);
  if (grossRevenue.value === null) unresolved.push('Receita bruta do período de apuração');

  const rbt12 = moneyField(text, RBT12_PATTERNS);
  if (rbt12.value === null) unresolved.push('RBT12');

  const totalDue = moneyField(text, TOTAL_DUE_PATTERNS);
  if (totalDue.value === null) unresolved.push('Valor total devido');

  const segregatedRevenue: SegregatedRevenue[] = [];
  for (const { label, pattern } of SEGREGATION_PATTERNS) {
    const match = pattern.exec(text);
    const amount = match?.[1] ? parseDecimalToCents(match[1]) : null;
    if (amount !== null) segregatedRevenue.push({ label, amount });
  }

  const lines: DeclarationLine[] = [];
  for (const { kind, label, pattern } of TAX_PATTERNS) {
    const match = pattern.exec(text);
    const amount = match?.[1] ? parseDecimalToCents(match[1]) : null;
    if (amount !== null) lines.push({ label, amount, kind });
  }
  if (totalDue.value !== null) {
    lines.push({ label: 'Total do débito exigível', amount: totalDue.value, kind: 'DAS_TOTAL' });
  }

  const confidence = overallConfidence([competencia, grossRevenue, totalDue]);
  if (unresolved.length > 0) {
    messages.push({
      level: 'ALERTA',
      code: 'PGDASD_CAMPOS_NAO_IDENTIFICADOS',
      message:
        'Campos não identificados automaticamente no PGDAS-D. Confirme manualmente antes de considerar os cruzamentos conclusivos.',
      detail: unresolved.join('; '),
    });
  }

  const declaration: Declaration = {
    id: deterministicId(`declaration:PGDAS_D:${context.fileId}`),
    source: 'PGDAS_D',
    competencia: competenciaValue,
    taxId,
    legalName,
    period: { competencia, grossRevenue, rbt12, segregatedRevenue, totalDue },
    lines,
    confidence,
    unresolvedFields: unresolved,
    fileId: context.fileId,
    fileName: context.fileName,
  };

  return { declaration, messages };
}

function overallConfidence(fields: readonly ExtractedField<unknown>[]): ExtractionConfidence {
  const order: ExtractionConfidence[] = ['ALTA', 'MEDIA', 'BAIXA', 'NAO_IDENTIFICADO'];
  let worst = 0;
  for (const field of fields) {
    worst = Math.max(worst, order.indexOf(field.confidence));
  }
  return order[worst] ?? 'NAO_IDENTIFICADO';
}

function detectPgdasd(input: DetectionInput): DetectionHint | null {
  if (!isPdf(input.bytes)) return null;
  const name = normalizeForMatch(input.fileName);
  const confidence = /PGDAS/.test(name) ? 0.85 : 0.4;
  return {
    source: 'PGDAS_D',
    confidence,
    reason:
      confidence >= 0.85
        ? 'PDF com nome compatível com PGDAS-D.'
        : 'PDF textual; o conteudo será analisado como PGDAS-D.',
  };
}

async function parsePgdasdFile(input: ParserInput): Promise<Result<ParsedPayload>> {
  const textResult = await extractPdfText(input.bytes);
  if (!textResult.ok) return textResult;

  const context = { fileId: input.fileId, fileName: input.fileName };
  const { declaration, messages: parseMessages } = parsePgdasdText(textResult.value.full, context);
  const messages: FileMessage[] = [...parseMessages];

  const revenues: RevenueRecord[] = [];
  const taxes: TaxRecord[] = [];
  const competencia = declaration.competencia;

  if (competencia && declaration.period.grossRevenue.value !== null) {
    revenues.push({
      id: deterministicId(`revenue:PGDAS_D:${input.fileId}`),
      source: 'PGDAS_D',
      competencia,
      basis: 'DECLARACAO',
      amount: declaration.period.grossRevenue.value,
      description:
        `Campo "Receita Bruta do PA" localizado no documento ${input.fileName}` +
        ` (confiança ${declaration.period.grossRevenue.confidence.toLowerCase()}).`,
      documentCount: null,
      fileId: input.fileId,
      fileName: input.fileName,
    });
  }

  if (competencia) {
    for (const line of declaration.lines) {
      if (!line.kind || line.kind === 'DAS_TOTAL') continue;
      taxes.push({
        id: deterministicId(`tax:PGDAS_D:${line.kind}:${input.fileId}`),
        source: 'PGDAS_D',
        competencia,
        tax: line.kind,
        metric: 'DEVIDO_PERIODO',
        base: null,
        amount: line.amount,
        description: `Tributo "${line.label}" informado no PGDAS-D (${input.fileName}).`,
        fileId: input.fileId,
        fileName: input.fileName,
      });
    }
    if (declaration.period.totalDue.value !== null) {
      taxes.push({
        id: deterministicId(`tax:PGDAS_D:DAS_TOTAL:${input.fileId}`),
        source: 'PGDAS_D',
        competencia,
        tax: 'DAS_TOTAL',
        metric: 'DEVIDO_PERIODO',
        base: declaration.period.grossRevenue.value ?? ZERO,
        amount: declaration.period.totalDue.value,
        description: `Total do débito exigível informado no PGDAS-D (${input.fileName}).`,
        fileId: input.fileId,
        fileName: input.fileName,
      });
    }
  }

  messages.push({
    level: 'INFO',
    code: 'PGDASD_RESUMO',
    message:
      `PDF com ${textResult.value.totalPages} página(s) de texto; confiança geral da extracao: ` +
      `${declaration.confidence.toLowerCase()}.`,
  });

  return ok({
    source: 'PGDAS_D',
    identity: {
      ...EMPTY_IDENTITY,
      taxId: declaration.taxId,
      legalName: declaration.legalName,
      competencia: declaration.competencia,
    },
    invoices: [],
    revenues,
    taxes,
    declarations: [declaration],
    participants: [],
    messages,
    stats: { found: 1, processed: 1, duplicated: 0, invalid: 0, ignored: 0 },
  });
}

export const pgdasdParser: FileParser = {
  source: 'PGDAS_D',
  detect: detectPgdasd,
  parse: parsePgdasdFile,
};
