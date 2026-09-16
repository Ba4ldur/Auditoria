/**
 * Inspeção do C100 com os registros filhos (fase 4).
 *
 * A vinculação entre um C100 e seus C170/C190/C195/C197 é **posicional** — o
 * SPED não referencia o documento nos filhos. `readC100Document` varre o
 * arquivo do início e associa cada filho ao último C100 lido; estes testes
 * cobrem o caso comum (documento com filhos), o caso em que o documento não
 * tem nenhum, e as duas formas de localizar o documento (chave e linha).
 */

import { describe, expect, it } from 'vitest';
import { readC100Document } from '@/lib/parsers/sped/inspect';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  buildEfdIcmsTxt,
  nfeAccessKey,
  type NfeSpec,
} from '@/lib/demo/fixtures';

function sale(numero: number, overrides: Partial<NfeSpec> = {}): NfeSpec {
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: '2026-08-10',
    naturezaOperacao: 'VENDA',
    tpNF: '1',
    emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: 'SP' },
    destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: 'RJ' },
    items: [
      {
        codigo: 'PROD001',
        descricao: 'PRODUTO A',
        ncm: '84713012',
        cfop: '5102',
        cst: '00',
        unidade: 'UN',
        quantidade: 1,
        valorUnitario: 1000,
        aliquotaIcms: 18,
      },
      {
        codigo: 'PROD002',
        descricao: 'PRODUTO B',
        ncm: '39269090',
        cfop: '5102',
        cst: '00',
        unidade: 'CX',
        quantidade: 2,
        valorUnitario: 500,
        aliquotaIcms: 18,
      },
    ],
    ...overrides,
  };
}

describe('C100 com filhos', () => {
  const specs = [sale(1001), sale(1002)];
  const content = buildEfdIcmsTxt({
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    documents: specs.map((spec) => ({ spec })),
    icmsARecolher: 540,
  });

  it('traz o C100, os dois C170 (um por item) e o C190, na ordem do arquivo', () => {
    const key = nfeAccessKey(specs[0]!);
    const document = readC100Document(content, 'EFD_ICMS_IPI', { chave: key });

    expect(document).not.toBeNull();
    expect(document?.document.code).toBe('C100');
    expect(document?.children.map((child) => child.code)).toEqual(['C170', 'C170', 'C190']);
    expect(document?.childCounts).toEqual({ C170: 2, C190: 1 });
  });

  it('não vaza registros do documento seguinte', () => {
    // O segundo documento também tem C170/C190 próprios; o primeiro não pode
    // incluí-los, já que a vinculação é só posicional.
    const key = nfeAccessKey(specs[0]!);
    const document = readC100Document(content, 'EFD_ICMS_IPI', { chave: key });

    expect(document?.children).toHaveLength(3); // 2 C170 + 1 C190, não mais.
    expect(document?.document.rawLine).toContain(key);
  });

  it('cada campo interpretado traz o conteúdo bruto da posição ao lado da leitura', () => {
    const key = nfeAccessKey(specs[0]!);
    const document = readC100Document(content, 'EFD_ICMS_IPI', { chave: key });

    const chvNfe = document?.document.fields.find((field) => field.name === 'CHV_NFE');
    expect(chvNfe?.raw).toBe(key);
    expect(chvNfe?.interpreted).toBe(key);

    const vlDoc = document?.document.fields.find((field) => field.name === 'VL_DOC');
    expect(vlDoc?.raw).toBeTruthy();
    expect(vlDoc?.interpreted).toContain('centavos');
  });
});

describe('C100 sem filhos', () => {
  // Escrito à mão, fora do gerador de fixtures: o gerador sempre emite um
  // C190 por documento, e este caso — documento sem nenhum registro
  // vinculado — precisa de controle total sobre o conteúdo do arquivo.
  const key = '3'.repeat(44);
  const content = [
    '|0000|017|0|01082026|31082026|EMPRESA TESTE|11222333000181||SP|123456789|9999999||||A|0|',
    '|C001|0|',
    `|C100|1|0|P001|55|00|1|1|${key}|10082026|10082026|1000,00|0|0,00||1000,00|9|0,00|0,00|0,00|180,00|180,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`,
    '|C990|4|',
    '|9999|5|',
  ].join('\n');

  it('devolve o documento com children vazio, e não null', () => {
    const document = readC100Document(content, 'EFD_ICMS_IPI', { chave: key });

    expect(document).not.toBeNull();
    expect(document?.children).toEqual([]);
    expect(document?.childCounts).toEqual({});
  });

  it('o próprio C100 continua interpretável campo a campo', () => {
    const document = readC100Document(content, 'EFD_ICMS_IPI', { chave: key });
    const vlDoc = document?.document.fields.find((field) => field.name === 'VL_DOC');
    expect(vlDoc?.raw).toBe('1000,00');
  });
});

describe('localização', () => {
  const specs = [sale(2001), sale(2002), sale(2003)];
  const content = buildEfdIcmsTxt({
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    documents: specs.map((spec) => ({ spec })),
    icmsARecolher: 810,
  });

  it('localiza por chave de acesso', () => {
    const key = nfeAccessKey(specs[1]!);
    const document = readC100Document(content, 'EFD_ICMS_IPI', { chave: key });
    expect(document?.document.fields.find((field) => field.name === 'CHV_NFE')?.raw).toBe(key);
  });

  it('localiza por número da linha do próprio C100', () => {
    const linha = [...content.split('\n').entries()].find(([, text]) =>
      text.startsWith(`|C100|`) && text.includes(nfeAccessKey(specs[2]!)),
    )?.[0];
    // Linhas do leitor SPED são base 1.
    const lineNumber = (linha ?? 0) + 1;

    const byLine = readC100Document(content, 'EFD_ICMS_IPI', { linha: lineNumber });
    expect(byLine?.document.line).toBe(lineNumber);
    expect(byLine?.document.fields.find((field) => field.name === 'CHV_NFE')?.raw).toBe(
      nfeAccessKey(specs[2]!),
    );
  });

  it('chave e linha localizam o mesmo documento quando ambos apontam para ele', () => {
    const key = nfeAccessKey(specs[0]!);
    const byKey = readC100Document(content, 'EFD_ICMS_IPI', { chave: key });
    const byLine = readC100Document(content, 'EFD_ICMS_IPI', { linha: byKey!.document.line });

    expect(byLine?.document.rawLine).toBe(byKey?.document.rawLine);
    expect(byLine?.children.map((child) => child.rawLine)).toEqual(
      byKey?.children.map((child) => child.rawLine),
    );
  });

  it('chave que não existe no arquivo devolve null, não lança erro', () => {
    expect(readC100Document(content, 'EFD_ICMS_IPI', { chave: '9'.repeat(44) })).toBeNull();
  });

  it('linha que não corresponde a um C100 devolve null', () => {
    expect(readC100Document(content, 'EFD_ICMS_IPI', { linha: 1 })).toBeNull();
  });

  it('sem chave nem linha informadas, não localiza nada', () => {
    expect(readC100Document(content, 'EFD_ICMS_IPI', {})).toBeNull();
  });

  it('chave com máscara (pontuação) é normalizada antes da busca', () => {
    const key = nfeAccessKey(specs[0]!);
    const masked = `${key.slice(0, 4)}.${key.slice(4, 8)}-${key.slice(8)}`;
    const document = readC100Document(content, 'EFD_ICMS_IPI', { chave: masked });
    expect(document?.document.fields.find((field) => field.name === 'CHV_NFE')?.raw).toBe(key);
  });
});
