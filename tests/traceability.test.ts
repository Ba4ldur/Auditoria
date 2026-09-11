import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { parseFile } from '@/lib/parsers';
import { efdIcmsIpiParser } from '@/lib/parsers/sped/efd-icms-ipi';
import { efdContribuicoesParser } from '@/lib/parsers/sped/efd-contribuicoes';
import { readSpedRecords } from '@/lib/parsers/sped/reader';
import { describeOrigin } from '@/lib/domain/model';
import { classifyReliability, toFileParseLog } from '@/lib/pipeline/reliability';
import {
  EFD_CONTRIB_PARSER_VERSION,
  EFD_ICMS_IPI_PARSER_VERSION,
  PGDAS_PARSER_VERSION,
  XML_PARSER_VERSION,
  ZIP_PARSER_VERSION,
} from '@/lib/parsers/versions';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  buildEfdContribTxt,
  buildEfdIcmsTxt,
  buildNfeXml,
  buildPgdasdText,
  nfeAccessKey,
  type NfeSpec,
} from '@/lib/demo/fixtures';
import { buildTextPdf } from '@/lib/demo/pdf-writer';

function sale(numero: number, overrides: Partial<NfeSpec> = {}): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-07',
    naturezaOperacao: 'VENDA',
    tpNF: '1',
    emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
    destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: 'RJ' },
    items: [
      {
        codigo: 'PROD001',
        descricao: 'PRODUTO',
        ncm: '84713012',
        cfop: '5102',
        cst: '00',
        unidade: 'UN',
        quantidade: 1,
        valorUnitario: 1000,
        aliquotaIcms: 18,
      },
    ],
    ...overrides,
  };
}

const bytes = (text: string, encoding: BufferEncoding = 'utf8'): Uint8Array =>
  new Uint8Array(Buffer.from(text, encoding));

describe('rastreabilidade até a linha do SPED', () => {
  const specs = [sale(4001), sale(4002), sale(4003)];
  const content = buildEfdIcmsTxt({
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    documents: specs.map((spec) => ({ spec })),
    icmsARecolher: 540,
  });

  it('guarda arquivo, registro e linha de cada documento do C100', async () => {
    const result = await efdIcmsIpiParser.parse({
      bytes: bytes(content, 'latin1'),
      fileName: 'EFD_082026.txt',
      fileId: 'file-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lines = [...readSpedRecords(content)]
      .filter((record) => record.code === 'C100')
      .map((record) => record.line);

    for (const [index, invoice] of result.value.invoices.entries()) {
      expect(invoice.origin.fileId).toBe('file-1');
      expect(invoice.origin.fileName).toBe('EFD_082026.txt');
      expect(invoice.origin.recordCode).toBe('C100');
      expect(invoice.origin.lineNumber).toBe(lines[index]);
    }
  });

  it('aponta a linha correta do documento procurado pela chave', async () => {
    const result = await efdIcmsIpiParser.parse({
      bytes: bytes(content, 'latin1'),
      fileName: 'EFD.txt',
      fileId: 'file-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = result.value.invoices.find(
      (invoice) => invoice.accessKey === nfeAccessKey(specs[1]!),
    );
    const records = [...readSpedRecords(content)];
    const record = records.find(
      (candidate) => candidate.code === 'C100' && candidate.parts[9] === nfeAccessKey(specs[1]!),
    );
    expect(target?.origin.lineNumber).toBe(record?.line);
  });

  it('guarda a linha do E110 na apuração do ICMS', async () => {
    const result = await efdIcmsIpiParser.parse({
      bytes: bytes(content, 'latin1'),
      fileName: 'EFD.txt',
      fileId: 'file-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const icms = result.value.taxes.find((tax) => tax.tax === 'ICMS');
    expect(icms?.origin.recordCode).toBe('E110');
    expect(icms?.origin.lineNumber).toBeGreaterThan(0);
  });

  it('guarda a linha do M200 e do M600 na EFD-Contribuições', async () => {
    const contrib = buildEfdContribTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: [specs[0]!],
      pisApurado: 16.5,
      cofinsApurada: 76,
    });
    const result = await efdContribuicoesParser.parse({
      bytes: bytes(contrib, 'latin1'),
      fileName: 'CONTRIB.txt',
      fileId: 'file-2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pis = result.value.taxes.find((tax) => tax.tax === 'PIS');
    const cofins = result.value.taxes.find((tax) => tax.tax === 'COFINS');
    expect(pis?.origin.recordCode).toBe('M200');
    expect(cofins?.origin.recordCode).toBe('M600');
    expect(pis?.origin.lineNumber).toBeGreaterThan(0);
  });

  it('descreve a origem em texto legível para o auditor', () => {
    expect(
      describeOrigin({
        fileId: 'f',
        fileName: 'EFD_ICMS_IPI_082026.txt',
        recordCode: 'C100',
        lineNumber: 18432,
        entryName: null,
      }),
    ).toBe('EFD_ICMS_IPI_082026.txt · registro C100 · linha 18.432');
  });

  it('identifica a entrada do ZIP de onde o XML foi lido', async () => {
    const archive = zipSync({ 'lote/NFe-4001.xml': bytes(buildNfeXml(specs[0]!)) });
    const result = await parseFile(archive, 'XML-082026.zip', 'file-3');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const invoice = result.value.invoices[0];
    expect(invoice?.origin.fileId).toBe('file-3');
    expect(invoice?.origin.fileName).toBe('XML-082026.zip');
    expect(invoice?.origin.entryName).toBe('lote/NFe-4001.xml');
    expect(invoice?.origin.recordCode).toBe('infNFe');
    expect(invoice?.origin.lineNumber).toBeNull();
  });
});

describe('versão do parser registrada em cada leitura', () => {
  it('declara a versão utilizada em cada obrigação', async () => {
    const xml = await parseFile(bytes(buildNfeXml(sale(5001))), 'nfe.xml', 'f1');
    expect(xml.ok && xml.value.parserVersion).toBe(XML_PARSER_VERSION);

    const zip = await parseFile(zipSync({ 'a.xml': bytes(buildNfeXml(sale(5002))) }), 'lote.zip', 'f2');
    expect(zip.ok && zip.value.parserVersion).toBe(ZIP_PARSER_VERSION);

    const icms = await parseFile(
      bytes(
        buildEfdIcmsTxt({
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          documents: [{ spec: sale(5003) }],
          icmsARecolher: 180,
        }),
        'latin1',
      ),
      'efd.txt',
      'f3',
    );
    expect(icms.ok && icms.value.parserVersion).toBe(EFD_ICMS_IPI_PARSER_VERSION);

    const contrib = await parseFile(
      bytes(
        buildEfdContribTxt({
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          documents: [sale(5004)],
          pisApurado: 10,
          cofinsApurada: 50,
        }),
        'latin1',
      ),
      'contrib.txt',
      'f4',
    );
    expect(contrib.ok && contrib.value.parserVersion).toBe(EFD_CONTRIB_PARSER_VERSION);

    const pdf = await parseFile(
      buildTextPdf(
        buildPgdasdText({
          competenciaLabel: '08/2026',
          receitaBruta: 1000,
          rbt12: 12000,
          valorDevido: 60,
        }),
      ),
      'PGDAS.pdf',
      'f5',
    );
    expect(pdf.ok && pdf.value.parserVersion).toBe(PGDAS_PARSER_VERSION);
  });

  it('usa o formato semântico, independente da versão da aplicação', () => {
    for (const version of [
      XML_PARSER_VERSION,
      ZIP_PARSER_VERSION,
      EFD_ICMS_IPI_PARSER_VERSION,
      EFD_CONTRIB_PARSER_VERSION,
      PGDAS_PARSER_VERSION,
    ]) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('log de leitura', () => {
  const specs = [sale(6001)];

  it('registra os registros presentes e não mapeados', async () => {
    const content = buildEfdIcmsTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: specs.map((spec) => ({ spec })),
      icmsARecolher: 180,
    });
    const result = await efdIcmsIpiParser.parse({
      bytes: bytes(content, 'latin1'),
      fileName: 'efd.txt',
      fileId: 'f1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const codes = result.value.log.unsupportedRecords.map((entry) => entry.code);
    expect(codes).toContain('0001');
    expect(result.value.log.unsupportedLayout).toBeNull();
  });

  it('acusa leiaute cuja versão não foi verificada', async () => {
    const content = buildEfdIcmsTxt({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      documents: specs.map((spec) => ({ spec })),
      icmsARecolher: 180,
    }).replace('|0000|017|', '|0000|099|');

    const result = await efdIcmsIpiParser.parse({
      bytes: bytes(content, 'latin1'),
      fileName: 'efd.txt',
      fileId: 'f1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.log.unsupportedLayout?.declaredVersion).toBe('099');
    expect(result.value.log.unsupportedLayout?.verifiedVersions.length).toBeGreaterThan(0);
    expect(
      result.value.log.warnings.some((warning) => warning.code === 'SPED_VERSAO_NAO_VERIFICADA'),
    ).toBe(true);
  });
});

describe('status de confiabilidade do arquivo', () => {
  const clean = { warnings: [], errors: [], unsupportedRecords: [], unsupportedLayout: null };

  it('classifica como validado quando não há nada a registrar', () => {
    const outcome = classifyReliability({
      identityCheck: 'COMPATIVEL',
      failed: false,
      log: clean,
      messages: [],
      declarations: [],
    });
    expect(outcome.reliability).toBe('VALIDADO');
    expect(outcome.reasons).toHaveLength(0);
  });

  it('exige conferência quando o leiaute não foi verificado', () => {
    const outcome = classifyReliability({
      identityCheck: 'COMPATIVEL',
      failed: false,
      log: { ...clean, unsupportedLayout: { declaredVersion: '099', verifiedVersions: ['017'] } },
      messages: [],
      declarations: [],
    });
    expect(outcome.reliability).toBe('REQUER_CONFERENCIA');
    expect(outcome.reasons[0]).toContain('099');
  });

  it('exige conferência quando um registro relevante não é lido', () => {
    const outcome = classifyReliability({
      identityCheck: 'COMPATIVEL',
      failed: false,
      log: { ...clean, unsupportedRecords: [{ code: 'C170', count: 42 }] },
      messages: [],
      declarations: [],
    });
    expect(outcome.reliability).toBe('REQUER_CONFERENCIA');
    expect(outcome.reasons[0]).toContain('C170');
  });

  it('ignora registros irrelevantes para os cruzamentos', () => {
    const outcome = classifyReliability({
      identityCheck: 'COMPATIVEL',
      failed: false,
      log: { ...clean, unsupportedRecords: [{ code: '0001', count: 5 }] },
      messages: [],
      declarations: [],
    });
    expect(outcome.reliability).toBe('VALIDADO');
  });

  it('bloqueia arquivo de outro CNPJ', () => {
    const outcome = classifyReliability({
      identityCheck: 'INCOMPATIVEL',
      failed: false,
      log: clean,
      messages: [],
      declarations: [],
    });
    expect(outcome.reliability).toBe('INCOMPATIVEL');
  });

  it('classifica como erro quando a leitura falhou', () => {
    const outcome = classifyReliability({
      identityCheck: 'COMPATIVEL',
      failed: true,
      log: clean,
      messages: [],
      declarations: [],
    });
    expect(outcome.reliability).toBe('ERRO');
  });

  it('exige conferência quando uma declaração tem campo não identificado', () => {
    const outcome = classifyReliability({
      identityCheck: 'COMPATIVEL',
      failed: false,
      log: clean,
      messages: [],
      declarations: [
        {
          confidence: 'MEDIA',
          unresolvedFields: ['RBT12'],
        } as never,
      ],
    });
    expect(outcome.reliability).toBe('REQUER_CONFERENCIA');
    expect(outcome.reasons[0]).toContain('RBT12');
  });

  it('converte o log do parser sem perder nada', async () => {
    const result = await efdIcmsIpiParser.parse({
      bytes: bytes(
        buildEfdIcmsTxt({
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          documents: [{ spec: sale(7001) }],
          icmsARecolher: 180,
        }),
        'latin1',
      ),
      fileName: 'efd.txt',
      fileId: 'f1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const log = toFileParseLog(result.value.log);
    expect(log.unsupportedRecords).toEqual(result.value.log.unsupportedRecords);
    expect(log.unsupportedLayout).toEqual(result.value.log.unsupportedLayout);
  });
});
