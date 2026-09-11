/**
 * Correção manual de campos extraídos (fase 2, requisitos 10 e 11).
 *
 * Quando o parser não consegue determinar um campo com segurança — o caso
 * típico é o PGDAS-D, cujo PDF não tem leiaute estável — o auditor confirma o
 * valor na interface. A correção atua **somente na camada normalizada**: o
 * arquivo original (PDF, XML, TXT, ZIP) nunca é alterado, e o valor extraído
 * originalmente continua guardado ao lado do valor confirmado.
 */

import { parseDecimalToCents, type Cents } from '@/lib/core/money';
import { parseCompetencia } from '@/lib/core/competencia';
import { deterministicId } from '@/lib/core/hash';
import { extracted, type Declaration, type RevenueRecord, type TaxRecord } from '@/lib/domain/model';
import type { FieldConfirmation } from '@/lib/domain/entities';
import type { ParsedPayload } from '@/lib/parsers/types';

export type ConfirmableFieldType = 'VALOR' | 'COMPETENCIA';

export interface ConfirmableField {
  readonly key: string;
  readonly label: string;
  readonly type: ConfirmableFieldType;
  readonly help: string;
}

/** Campos que o auditor pode confirmar em uma declaração PGDAS-D. */
export const PGDASD_CONFIRMABLE_FIELDS: readonly ConfirmableField[] = [
  {
    key: 'competencia',
    label: 'Período de apuração',
    type: 'COMPETENCIA',
    help: 'Formato MM/AAAA, como consta no extrato.',
  },
  {
    key: 'grossRevenue',
    label: 'Receita bruta do período de apuração',
    type: 'VALOR',
    help: 'Valor do campo "Receita Bruta do PA (RPA)".',
  },
  {
    key: 'rbt12',
    label: 'RBT12',
    type: 'VALOR',
    help: 'Receita bruta acumulada nos doze meses anteriores.',
  },
  {
    key: 'totalDue',
    label: 'Total do débito exigível',
    type: 'VALOR',
    help: 'Valor total apurado no documento.',
  },
];

export function confirmableFieldsFor(source: string): readonly ConfirmableField[] {
  return source === 'PGDAS_D' ? PGDASD_CONFIRMABLE_FIELDS : [];
}

function parseConfirmed(field: ConfirmableField, value: string): string | Cents | null {
  if (field.type === 'COMPETENCIA') return parseCompetencia(value);
  return parseDecimalToCents(value);
}

/** Valida uma confirmação antes de gravá-la. */
export function validateConfirmation(fieldKey: string, value: string): string | null {
  const field = PGDASD_CONFIRMABLE_FIELDS.find((candidate) => candidate.key === fieldKey);
  if (!field) return `Campo desconhecido: ${fieldKey}.`;
  if (value.trim() === '') return 'Informe o valor confirmado.';
  if (parseConfirmed(field, value) === null) {
    return field.type === 'COMPETENCIA'
      ? 'Competência inválida. Use o formato MM/AAAA.'
      : 'Valor inválido. Use o formato 1.234,56.';
  }
  return null;
}

/**
 * Aplica as confirmações ao resultado do parser.
 *
 * Os registros derivados (receita e tributos) são recalculados a partir dos
 * valores confirmados, para que o motor de regras trabalhe com o que o auditor
 * conferiu — e não com o que o PDF sugeriu.
 */
export function applyFieldConfirmations(
  payload: ParsedPayload,
  confirmations: readonly FieldConfirmation[],
): ParsedPayload {
  if (payload.source !== 'PGDAS_D' || payload.declarations.length === 0) return payload;

  const applicable = confirmations.filter(
    (confirmation) => confirmation.fileId === payload.declarations[0]?.origin.fileId,
  );
  if (applicable.length === 0) return payload;

  const byField = new Map(applicable.map((confirmation) => [confirmation.field, confirmation]));

  const declarations = payload.declarations.map((declaration) =>
    applyToDeclaration(declaration, byField),
  );
  const declaration = declarations[0];
  if (!declaration) return payload;

  const competencia = declaration.competencia;
  const revenues: RevenueRecord[] = [];
  const taxes: TaxRecord[] = [...payload.taxes];

  if (competencia && declaration.period.grossRevenue.value !== null) {
    const previous = payload.revenues[0];
    revenues.push({
      id: previous?.id ?? deterministicId(`revenue:PGDAS_D:${declaration.id}`),
      source: 'PGDAS_D',
      competencia,
      basis: 'DECLARACAO',
      amount: declaration.period.grossRevenue.value,
      description: descriptionFor(declaration, byField.get('grossRevenue')),
      documentCount: null,
      origin: declaration.origin,
    });
  }

  return { ...payload, declarations, revenues, taxes };
}

function descriptionFor(
  declaration: Declaration,
  confirmation: FieldConfirmation | undefined,
): string {
  const fileName = declaration.origin.fileName ?? 'documento PGDAS-D';
  if (!confirmation) {
    return (
      `Campo "Receita Bruta do PA" localizado no documento ${fileName}` +
      ` (confiança ${declaration.period.grossRevenue.confidence.toLowerCase()}).`
    );
  }
  return (
    `Valor confirmado manualmente por ${confirmation.confirmedBy} em ` +
    `${confirmation.confirmedAt.slice(0, 10)}, sobre o documento ${fileName}. ` +
    `Valor originalmente extraído: ${confirmation.originalValue ?? 'não identificado'}.`
  );
}

function applyToDeclaration(
  declaration: Declaration,
  byField: ReadonlyMap<string, FieldConfirmation>,
): Declaration {
  const period = { ...declaration.period };
  let competencia = declaration.competencia;

  for (const field of PGDASD_CONFIRMABLE_FIELDS) {
    const confirmation = byField.get(field.key);
    if (!confirmation) continue;
    const parsed = parseConfirmed(field, confirmation.confirmedValue);
    if (parsed === null) continue;

    const evidence = `Confirmado manualmente por ${confirmation.confirmedBy}.`;

    if (field.key === 'competencia') {
      competencia = parsed as string;
      period.competencia = extracted(parsed as string, 'ALTA', evidence);
    } else if (field.key === 'grossRevenue') {
      period.grossRevenue = extracted(parsed as Cents, 'ALTA', evidence);
    } else if (field.key === 'rbt12') {
      period.rbt12 = extracted(parsed as Cents, 'ALTA', evidence);
    } else if (field.key === 'totalDue') {
      period.totalDue = extracted(parsed as Cents, 'ALTA', evidence);
    }
  }

  const unresolved = declaration.unresolvedFields.filter(
    (label) => !resolvedLabels(byField).has(label),
  );

  return {
    ...declaration,
    competencia,
    period,
    unresolvedFields: unresolved,
    confidence: unresolved.length === 0 ? 'ALTA' : declaration.confidence,
  };
}

/** Rótulos de campos não identificados que uma confirmação resolve. */
function resolvedLabels(byField: ReadonlyMap<string, FieldConfirmation>): Set<string> {
  const labels = new Set<string>();
  if (byField.has('competencia')) labels.add('Período de apuração');
  if (byField.has('grossRevenue')) labels.add('Receita bruta do período de apuração');
  if (byField.has('rbt12')) labels.add('RBT12');
  if (byField.has('totalDue')) labels.add('Valor total devido');
  return labels;
}
