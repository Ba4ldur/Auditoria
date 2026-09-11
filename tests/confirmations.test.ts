import { describe, expect, it } from 'vitest';
import {
  PGDASD_CONFIRMABLE_FIELDS,
  applyFieldConfirmations,
  confirmableFieldsFor,
  validateConfirmation,
} from '@/lib/pipeline/confirmations';
import { parseFile } from '@/lib/parsers';
import { buildTextPdf } from '@/lib/demo/pdf-writer';
import { buildPgdasdText, DEMO_COMPANY } from '@/lib/demo/fixtures';
import type { FieldConfirmation } from '@/lib/domain/entities';
import type { ParsedPayload } from '@/lib/parsers/types';

function confirmation(
  field: string,
  confirmedValue: string,
  fileId: string,
  originalValue: string | null = null,
): FieldConfirmation {
  return {
    id: `c-${field}`,
    organizationId: 'org-1',
    auditId: 'audit-1',
    fileId,
    field,
    originalValue,
    confirmedValue,
    confirmedBy: 'Auditor Teste',
    confirmedAt: '2026-09-11T12:00:00.000Z',
    note: null,
  };
}

/** PGDAS-D sem o campo de receita, para simular extração incompleta. */
function incompletePdf(): Uint8Array {
  return buildTextPdf([
    'SIMPLES NACIONAL',
    'EXTRATO DO SIMPLES NACIONAL - PGDAS-D',
    `CNPJ Matriz: ${DEMO_COMPANY.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')}`,
    `Nome Empresarial: ${DEMO_COMPANY.legalName}`,
    'Periodo de Apuracao (PA): 08/2026',
  ]);
}

async function parsePgdasd(bytes: Uint8Array, fileId: string): Promise<ParsedPayload> {
  const result = await parseFile(bytes, 'PGDAS.pdf', fileId);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('catálogo de campos confirmáveis', () => {
  it('expõe os campos do PGDAS-D e nada para as demais obrigações', () => {
    expect(confirmableFieldsFor('PGDAS_D')).toBe(PGDASD_CONFIRMABLE_FIELDS);
    expect(confirmableFieldsFor('EFD_ICMS_IPI')).toHaveLength(0);
    expect(confirmableFieldsFor('XML_NFE')).toHaveLength(0);
  });
});

describe('validação da confirmação manual', () => {
  it('aceita valores no formato brasileiro', () => {
    expect(validateConfirmation('grossRevenue', '462.180,22')).toBeNull();
    expect(validateConfirmation('competencia', '08/2026')).toBeNull();
  });

  it('recusa valores inválidos com mensagem específica', () => {
    expect(validateConfirmation('grossRevenue', 'abc')).toContain('Valor inválido');
    expect(validateConfirmation('competencia', '13/2026')).toContain('Competência inválida');
    expect(validateConfirmation('grossRevenue', '')).toContain('Informe o valor');
    expect(validateConfirmation('campoInexistente', '10,00')).toContain('desconhecido');
  });
});

describe('aplicação da confirmação sobre o modelo normalizado', () => {
  it('substitui o valor extraído e recalcula a receita derivada', async () => {
    const payload = await parsePgdasd(incompletePdf(), 'file-1');

    expect(payload.declarations[0]?.period.grossRevenue.value).toBeNull();
    expect(payload.revenues).toHaveLength(0);

    const corrected = applyFieldConfirmations(payload, [
      confirmation('grossRevenue', '462.180,22', 'file-1'),
    ]);

    expect(corrected.declarations[0]?.period.grossRevenue.value).toBe(46218022);
    expect(corrected.declarations[0]?.period.grossRevenue.confidence).toBe('ALTA');
    expect(corrected.revenues).toHaveLength(1);
    expect(corrected.revenues[0]?.amount).toBe(46218022);
    expect(corrected.revenues[0]?.description).toContain('confirmado manualmente');
    expect(corrected.revenues[0]?.description).toContain('Auditor Teste');
  });

  it('preserva o valor originalmente extraído na descrição', async () => {
    const payload = await parsePgdasd(incompletePdf(), 'file-1');
    const corrected = applyFieldConfirmations(payload, [
      confirmation('grossRevenue', '1.000,00', 'file-1', 'R$ 999,00'),
    ]);
    expect(corrected.revenues[0]?.description).toContain('R$ 999,00');
  });

  it('remove o campo da lista de não identificados', async () => {
    const payload = await parsePgdasd(incompletePdf(), 'file-1');
    expect(payload.declarations[0]?.unresolvedFields).toContain(
      'Receita bruta do período de apuração',
    );

    const corrected = applyFieldConfirmations(payload, [
      confirmation('grossRevenue', '1.000,00', 'file-1'),
    ]);
    expect(corrected.declarations[0]?.unresolvedFields).not.toContain(
      'Receita bruta do período de apuração',
    );
  });

  it('ignora confirmações de outro arquivo', async () => {
    const payload = await parsePgdasd(incompletePdf(), 'file-1');
    const corrected = applyFieldConfirmations(payload, [
      confirmation('grossRevenue', '9.999,00', 'outro-arquivo'),
    ]);
    expect(corrected.declarations[0]?.period.grossRevenue.value).toBeNull();
  });

  it('não altera obrigações que não têm campos confirmáveis', async () => {
    const payload = await parsePgdasd(
      buildTextPdf(
        buildPgdasdText({
          competenciaLabel: '08/2026',
          receitaBruta: 1000,
          rbt12: 12000,
          valorDevido: 60,
        }),
      ),
      'file-2',
    );
    const alien = { ...payload, source: 'EFD_ICMS_IPI' as const };
    expect(applyFieldConfirmations(alien, [confirmation('grossRevenue', '1,00', 'file-2')])).toBe(
      alien,
    );
  });

  it('corrige a competência quando o período não foi reconhecido', async () => {
    const payload = await parsePgdasd(
      buildTextPdf(['SIMPLES NACIONAL', 'EXTRATO DO SIMPLES NACIONAL - PGDAS-D', 'Documento sem periodo']),
      'file-3',
    );
    expect(payload.declarations[0]?.competencia).toBeNull();

    const corrected = applyFieldConfirmations(payload, [
      confirmation('competencia', '07/2026', 'file-3'),
    ]);
    expect(corrected.declarations[0]?.competencia).toBe('2026-07');
  });
});
