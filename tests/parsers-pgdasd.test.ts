import { describe, expect, it } from 'vitest';
import { parsePgdasdText, pgdasdParser } from '@/lib/parsers/pdf/pgdasd';
import { extractPdfText, isPdf } from '@/lib/parsers/pdf/text';
import { buildTextPdf } from '@/lib/demo/pdf-writer';
import { DEMO_COMPANY, buildPgdasdText } from '@/lib/demo/fixtures';

const SPEC = {
  competenciaLabel: '08/2026',
  receitaBruta: 462180.22,
  rbt12: 4820500.0,
  valorDevido: 28450.19,
  segregacoes: [
    { label: 'Revenda de mercadorias', amount: 300000.0 },
    { label: 'Prestacao de serviços', amount: 162180.22 },
  ],
  tributos: [
    { label: 'IRPJ', amount: 1422.51 },
    { label: 'CSLL', amount: 1138.01 },
    { label: 'COFINS', amount: 3414.02 },
    { label: 'PIS/Pasep', amount: 824.05 },
    { label: 'CPP', amount: 12225.58 },
    { label: 'ICMS', amount: 9426.02 },
  ],
} as const;

describe('parser do PGDAS-D', () => {
  it('extrai os campos principais do extrato', () => {
    const { declaration } = parsePgdasdText(buildPgdasdText(SPEC).join('\n'), {
      fileId: 'f1',
      fileName: 'PGDAS_082026.pdf',
    });

    expect(declaration.taxId).toBe(DEMO_COMPANY.cnpj);
    // O extrato do PGDAS-D e gerado sem acentuacao (WinAnsi), portanto a
    // comparacao usa a forma transliterada do nome ficticio.
    expect(declaration.legalName).toBe(
      DEMO_COMPANY.legalName.normalize('NFD').replace(/\p{Diacritic}/gu, ''),
    );
    expect(declaration.competencia).toBe('2026-08');
    expect(declaration.period.grossRevenue.value).toBe(46218022);
    expect(declaration.period.rbt12.value).toBe(482050000);
    expect(declaration.period.totalDue.value).toBe(2845019);
    expect(declaration.confidence).toBe('ALTA');
    expect(declaration.unresolvedFields).toHaveLength(0);
  });

  it('extrai receita segregada e tributos informados', () => {
    const { declaration } = parsePgdasdText(buildPgdasdText(SPEC).join('\n'), {
      fileId: 'f1',
      fileName: 'PGDAS_082026.pdf',
    });

    expect(declaration.period.segregatedRevenue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Revenda de mercadorias', amount: 30000000 }),
      ]),
    );
    const icms = declaration.lines.find((line) => line.kind === 'ICMS');
    expect(icms?.amount).toBe(942602);
  });

  it('não inventa valores ausentes: marca o campo como não identificado', () => {
    const partial = ['SIMPLES NACIONAL', `Nome Empresarial: ${DEMO_COMPANY.legalName}`].join('\n');
    const { declaration, messages } = parsePgdasdText(partial, {
      fileId: 'f1',
      fileName: 'incompleto.pdf',
    });

    expect(declaration.period.grossRevenue.value).toBeNull();
    expect(declaration.period.grossRevenue.confidence).toBe('NAO_IDENTIFICADO');
    expect(declaration.competencia).toBeNull();
    expect(declaration.unresolvedFields).toContain('Receita bruta do período de apuração');
    expect(declaration.unresolvedFields).toContain('CNPJ');
    expect(messages.some((m) => m.code === 'PGDASD_CAMPOS_NAO_IDENTIFICADOS')).toBe(true);
  });

  it('guarda a evidência textual de onde o valor foi lido', () => {
    const { declaration } = parsePgdasdText(buildPgdasdText(SPEC).join('\n'), {
      fileId: 'f1',
      fileName: 'PGDAS.pdf',
    });
    expect(declaration.period.grossRevenue.evidence).toContain('RECEITA BRUTA DO PA');
  });

  it('le um PDF textual de ponta a ponta', async () => {
    const pdf = buildTextPdf(buildPgdasdText(SPEC));
    expect(isPdf(pdf)).toBe(true);

    const text = await extractPdfText(pdf);
    expect(text.ok).toBe(true);
    if (!text.ok) return;
    expect(text.value.full).toContain('PGDAS-D');

    const result = await pgdasdParser.parse({ bytes: pdf, fileName: 'PGDAS_082026.pdf', fileId: 'f9' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.declarations[0]?.competencia).toBe('2026-08');
    expect(result.value.revenues[0]?.amount).toBe(46218022);
    expect(result.value.revenues[0]?.description).toContain('Receita Bruta do PA');
    const das = result.value.taxes.find((tax) => tax.tax === 'DAS_TOTAL');
    expect(das?.amount).toBe(2845019);
  });

  it('recusa PDF sem camada de texto em vez de recorrer a OCR', async () => {
    const empty = buildTextPdf([]);
    const result = await extractPdfText(empty);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PDF_SEM_TEXTO');
  });
});
