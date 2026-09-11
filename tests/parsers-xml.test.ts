import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { parseNfeXml, decodeXml } from '@/lib/parsers/xml/nfe';
import { extractZip } from '@/lib/parsers/archive/zip';
import { detectParser } from '@/lib/parsers';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  buildNfeXml,
  computeNfeTotals,
  nfeAccessKey,
  type NfeSpec,
} from '@/lib/demo/fixtures';

function saleSpec(numero: number, overrides: Partial<NfeSpec> = {}): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-10',
    naturezaOperacao: 'VENDA DE MERCADORIA',
    tpNF: '1',
    emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: DEMO_COMPANY.uf },
    destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: DEMO_CUSTOMER.uf },
    items: [
      {
        codigo: 'PROD001',
        descricao: 'PRODUTO DEMONSTRAÇÃO A',
        ncm: '84713012',
        cfop: '6102',
        cst: '00',
        unidade: 'UN',
        quantidade: 10,
        valorUnitario: 125.5,
        aliquotaIcms: 12,
      },
    ],
    ...overrides,
  };
}

describe('parser de XML de NF-e', () => {
  it('extrai os campos exigidos no nível do documento', () => {
    const spec = saleSpec(1001);
    const result = parseNfeXml(buildNfeXml(spec), { fileId: 'f1', fileName: 'nfe-1001.xml' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const invoice = result.value.invoice;
    expect(invoice.accessKey).toBe(nfeAccessKey(spec));
    expect(invoice.model).toBe('55');
    expect(invoice.serie).toBe('1');
    expect(invoice.number).toBe('1001');
    expect(invoice.issueDate).toBe('2026-08-10');
    expect(invoice.emitterTaxId).toBe(DEMO_COMPANY.cnpj);
    expect(invoice.recipientTaxId).toBe(DEMO_CUSTOMER.cnpj);
    expect(invoice.emitterUf).toBe('SP');
    expect(invoice.recipientUf).toBe('RJ');
    expect(invoice.naturezaOperacao).toBe('VENDA DE MERCADORIA');
    expect(invoice.status).toBe('AUTORIZADA');
    expect(invoice.direction).toBe('SAIDA');
    expect(invoice.cfopPrincipal).toBe('6102');
    expect(invoice.source).toBe('XML_NFE');
  });

  it('extrai valores monetarios em centavos, sem perda de precisao', () => {
    const spec = saleSpec(1002);
    const totals = computeNfeTotals(spec);
    const result = parseNfeXml(buildNfeXml(spec), { fileId: 'f1', fileName: 'nfe.xml' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { totals: parsed } = result.value.invoice;
    expect(parsed.produtos).toBe(Math.round(totals.produtos * 100));
    expect(parsed.total).toBe(Math.round(totals.total * 100));
    expect(parsed.baseIcms).toBe(Math.round(totals.baseIcms * 100));
    expect(parsed.icms).toBe(Math.round(totals.icms * 100));
    expect(parsed.pis).toBe(Math.round(totals.pis * 100));
    expect(parsed.cofins).toBe(Math.round(totals.cofins * 100));
  });

  it('extrai o nível de item', () => {
    const spec = saleSpec(1003, {
      items: [
        {
          codigo: 'PROD001',
          descricao: 'PRODUTO A',
          ncm: '84713012',
          cfop: '5102',
          cst: '00',
          unidade: 'UN',
          quantidade: 2,
          valorUnitario: 100,
          aliquotaIcms: 18,
        },
        {
          codigo: 'PROD002',
          descricao: 'PRODUTO B',
          ncm: '39269090',
          cfop: '5102',
          cst: '00',
          unidade: 'CX',
          quantidade: 3,
          valorUnitario: 50,
          aliquotaIcms: 18,
        },
      ],
    });

    const result = parseNfeXml(buildNfeXml(spec), { fileId: 'f1', fileName: 'nfe.xml' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const items = result.value.invoice.items;
    expect(items).toHaveLength(2);
    expect(items[0]?.codigo).toBe('PROD001');
    expect(items[0]?.ncm).toBe('84713012');
    expect(items[0]?.valorProduto).toBe(20000);
    expect(items[0]?.icms).toBe(3600);
    expect(items[1]?.unidade).toBe('CX');
    expect(items[1]?.valorProduto).toBe(15000);
  });

  it('identifica documento cancelado pelo protocolo', () => {
    const result = parseNfeXml(buildNfeXml(saleSpec(1004, { cancelada: true })), {
      fileId: 'f1',
      fileName: 'nfe.xml',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invoice.status).toBe('CANCELADA');
  });

  it('identifica NFC-e pelo modelo 65', () => {
    const result = parseNfeXml(buildNfeXml(saleSpec(1005, { modelo: '65' })), {
      fileId: 'f1',
      fileName: 'nfce.xml',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invoice.source).toBe('XML_NFCE');
    expect(result.value.invoice.documentKind).toBe('NFCE');
  });

  it('não lanca exceção para XML malformado ou de outro tipo', () => {
    expect(parseNfeXml('<<< não e xml', { fileId: null, fileName: 'x.xml' }).ok).toBe(false);
    const other = parseNfeXml('<?xml version="1.0"?><outro><a>1</a></outro>', {
      fileId: null,
      fileName: 'x.xml',
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe('XML_NAO_E_NFE');
  });

  it('decodifica XML declarado em ISO-8859-1', () => {
    const latin = Buffer.from(
      '<?xml version="1.0" encoding="ISO-8859-1"?><a>ACENTUAÇÃO</a>',
      'latin1',
    );
    expect(decodeXml(new Uint8Array(latin))).toContain('ACENTUAÇÃO');
  });
});

describe('parser de ZIP de XML', () => {
  it('processa cada XML, elimina duplicidades pela chave e reporta inválidos', () => {
    const first = buildNfeXml(saleSpec(2001));
    const second = buildNfeXml(saleSpec(2002));

    const archive = zipSync({
      'nfe-2001.xml': Buffer.from(first, 'utf8'),
      'copia/nfe-2001-copia.xml': Buffer.from(first, 'utf8'),
      'nfe-2002.xml': Buffer.from(second, 'utf8'),
      'quebrado.xml': Buffer.from('<<< inválido', 'utf8'),
      'leiame.txt': Buffer.from('ignorado', 'utf8'),
      '__MACOSX/._nfe-2001.xml': Buffer.from('lixo', 'utf8'),
    });

    const result = extractZip(archive, 'lote.zip');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.stats.found).toBe(4);
    expect(result.value.stats.processed).toBe(2);
    expect(result.value.stats.duplicated).toBe(1);
    expect(result.value.stats.invalid).toBe(1);
    expect(result.value.stats.ignored).toBe(1);
    expect(result.value.invoices).toHaveLength(2);
  });

  it('reporta erro individual sem abortar o lote', () => {
    const archive = zipSync({
      'ok.xml': Buffer.from(buildNfeXml(saleSpec(2003)), 'utf8'),
      'ruim.xml': Buffer.from('nada', 'utf8'),
    });
    const result = extractZip(archive, 'lote.zip');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invoices).toHaveLength(1);
    expect(result.value.messages.some((message) => message.message.includes('ruim.xml'))).toBe(true);
  });
});

describe('deteccao automática de tipo', () => {
  it('reconhece XML de NF-e', () => {
    const bytes = new Uint8Array(Buffer.from(buildNfeXml(saleSpec(3001)), 'utf8'));
    expect(detectParser(bytes, 'nfe.xml')?.hint.source).toBe('XML_NFE');
  });

  it('reconhece arquivo compactado pela assinatura PK', () => {
    const archive = zipSync({ 'a.xml': Buffer.from(buildNfeXml(saleSpec(3002)), 'utf8') });
    const detection = detectParser(archive, 'lote.zip');
    expect(detection).not.toBeNull();
    expect(detection?.hint.reason).toContain('ZIP');
  });

  it('recusa formato desconhecido', () => {
    expect(detectParser(new Uint8Array([1, 2, 3]), 'arquivo.bin')).toBeNull();
  });
});
