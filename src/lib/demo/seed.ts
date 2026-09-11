/**
 * Demonstration dataset (requirement 32).
 *
 * Builds a fictitious company and one audit whose files carry deliberately
 * planted inconsistencies, then runs them through the real pipeline — upload,
 * identification, parsing, normalisation and the rule engine. Nothing is
 * mocked: what the demo shows is what the system actually computes.
 */

import { zipSync } from 'fflate';
import { makeCompetencia } from '@/lib/core/competencia';
import { getStore } from '@/lib/data';
import { ingestUpload } from '@/lib/pipeline/upload';
import { processAudit } from '@/lib/pipeline/process';
import type { Company } from '@/lib/domain/entities';
import { buildTextPdf } from './pdf-writer';
import {
  DEMO_COMPANY,
  DEMO_CUSTOMER,
  DEMO_SUPPLIER,
  buildEfdContribTxt,
  buildEfdIcmsTxt,
  buildNfeXml,
  buildPgdasdText,
  computeNfeTotals,
  type EfdDocumentSpec,
  type NfeSpec,
} from './fixtures';

const COMPETENCIA = makeCompetencia(2026, 8);
const COMPETENCIA_LABEL = '08/2026';

interface DemoFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

const PRODUCTS = [
  { codigo: 'PROD001', descricao: 'NOTEBOOK DEMONSTRAÇÃO 14"', ncm: '84713012', unidade: 'UN' },
  { codigo: 'PROD002', descricao: 'EMBALAGEM DEMONSTRAÇÃO', ncm: '39269090', unidade: 'CX' },
] as const;

function saleSpec(numero: number, valorUnitario: number, quantidade: number, cfop = '5102'): NfeSpec {
  const product = PRODUCTS[numero % 2 === 0 ? 0 : 1] ?? PRODUCTS[0];
  return {
    numero,
    serie: 1,
    modelo: '55',
    emissao: `2026-08-${String((numero % 27) + 1).padStart(2, '0')}`,
    naturezaOperacao: 'VENDA DE MERCADORIA ADQUIRIDA DE TERCEIROS',
    tpNF: '1',
    emitente: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: DEMO_COMPANY.uf },
    destinatario: { cnpj: DEMO_CUSTOMER.cnpj, nome: DEMO_CUSTOMER.legalName, uf: DEMO_CUSTOMER.uf },
    items: [
      {
        codigo: product.codigo,
        descricao: product.descricao,
        ncm: product.ncm,
        cfop,
        cst: '00',
        unidade: product.unidade,
        quantidade,
        valorUnitario,
        aliquotaIcms: 18,
      },
    ],
  };
}

function purchaseSpec(numero: number, valorUnitario: number): NfeSpec {
  return {
    ...saleSpec(numero, valorUnitario, 1, '1102'),
    naturezaOperacao: 'COMPRA PARA COMERCIALIZACAO',
    tpNF: '1',
    emitente: { cnpj: DEMO_SUPPLIER.cnpj, nome: DEMO_SUPPLIER.legalName, uf: DEMO_SUPPLIER.uf },
    destinatario: { cnpj: DEMO_COMPANY.cnpj, nome: DEMO_COMPANY.legalName, uf: DEMO_COMPANY.uf },
  };
}

/**
 * The scenario. Each inconsistency below is planted on purpose so that every
 * family of rule has something to find.
 */
function buildScenario(): {
  files: DemoFile[];
  planted: string[];
} {
  const sales: NfeSpec[] = [
    saleSpec(1001, 12500, 1),
    saleSpec(1002, 8400.5, 2),
    saleSpec(1003, 15200, 1),
    saleSpec(1004, 6750.25, 3),
    saleSpec(1005, 22100, 1),
    saleSpec(1006, 9300, 2),
    saleSpec(1007, 4820.8, 4),
    saleSpec(1008, 18650, 1),
  ];
  const purchase = purchaseSpec(2001, 30000);
  const cancelled: NfeSpec = { ...saleSpec(1009, 5000, 1), cancelada: true };

  // Documento escriturado sem XML correspondente (ATT-FIS-002).
  const onlyBooked = saleSpec(1099, 7400, 1);

  const bookedTotals = computeNfeTotals(sales[0]!);
  const bookedDocuments: EfdDocumentSpec[] = [
    // Valor do documento divergente do XML (ATT-FIS-003).
    { spec: sales[0]!, override: { valorDocumento: bookedTotals.total - 1250.4 } },
    { spec: sales[1]! },
    // CFOP escriturado diferente do CFOP do XML (ATT-FIS-006).
    { spec: sales[2]!, override: { cfop: '5405' } },
    { spec: sales[3]! },
    // ICMS escriturado a menor (ATT-FIS-005).
    { spec: sales[4]!, override: { icms: computeNfeTotals(sales[4]!).icms - 320.5 } },
    { spec: sales[5]! },
    { spec: sales[6]! },
    // sales[7] fica de fora da EFD (ATT-FIS-001).
    { spec: onlyBooked },
    { spec: cancelled },
    { spec: purchase },
  ];

  const xmlRevenue = sales.reduce((sum, spec) => sum + computeNfeTotals(spec).total, 0);

  const zipEntries: Record<string, Uint8Array> = {};
  for (const spec of sales.slice(0, 5)) {
    zipEntries[`NFe-${spec.numero}.xml`] = new Uint8Array(
      Buffer.from(buildNfeXml(spec), 'utf8'),
    );
  }
  // Documento repetido dentro do proprio lote, para demonstrar a deduplicacao.
  zipEntries['duplicados/NFe-1001-copia.xml'] = new Uint8Array(
    Buffer.from(buildNfeXml(sales[0]!), 'utf8'),
  );
  zipEntries['leia-me.txt'] = new Uint8Array(Buffer.from('arquivo ignorado', 'utf8'));

  const files: DemoFile[] = [
    {
      name: 'XML-NFe-082026.zip',
      bytes: zipSync(zipEntries),
      mimeType: 'application/zip',
    },
    ...sales.slice(5).map((spec) => ({
      name: `NFe-${spec.numero}.xml`,
      bytes: new Uint8Array(Buffer.from(buildNfeXml(spec), 'utf8')),
      mimeType: 'application/xml',
    })),
    {
      name: `NFe-${cancelled.numero}-cancelada.xml`,
      bytes: new Uint8Array(Buffer.from(buildNfeXml(cancelled), 'utf8')),
      mimeType: 'application/xml',
    },
    {
      name: `NFe-${purchase.numero}-entrada.xml`,
      bytes: new Uint8Array(Buffer.from(buildNfeXml(purchase), 'utf8')),
      mimeType: 'application/xml',
    },
    {
      name: 'EFD-ICMS-IPI-082026.txt',
      bytes: new Uint8Array(
        Buffer.from(
          buildEfdIcmsTxt({
            startDate: '2026-08-01',
            endDate: '2026-08-31',
            documents: bookedDocuments,
            icmsARecolher: 18420.65,
          }),
          'latin1',
        ),
      ),
      mimeType: 'text/plain',
    },
    {
      name: 'EFD-Contribuicoes-082026.txt',
      bytes: new Uint8Array(
        Buffer.from(
          buildEfdContribTxt({
            startDate: '2026-08-01',
            endDate: '2026-08-31',
            documents: sales,
            pisApurado: 1580.4,
            cofinsApurada: 7280.1,
            outrasReceitas: 4200,
          }),
          'latin1',
        ),
      ),
      mimeType: 'text/plain',
    },
    {
      name: 'PGDAS-D-082026.pdf',
      bytes: buildTextPdf(
        buildPgdasdText({
          competenciaLabel: COMPETENCIA_LABEL,
          // Receita declarada abaixo do somatorio dos documentos (ATT-FAT-001/002/003).
          receitaBruta: Math.round((xmlRevenue - 25050.2) * 100) / 100,
          rbt12: 1284500.75,
          valorDevido: 9820.44,
          segregacoes: [
            { label: 'Revenda de mercadorias', amount: Math.round((xmlRevenue - 25050.2) * 100) / 100 },
          ],
          tributos: [
            { label: 'IRPJ', amount: 491.02 },
            { label: 'CSLL', amount: 392.82 },
            { label: 'COFINS', amount: 1178.45 },
            { label: 'PIS/Pasep', amount: 284.79 },
            { label: 'CPP', amount: 4222.79 },
            { label: 'ICMS', amount: 3250.57 },
          ],
        }),
      ),
      mimeType: 'application/pdf',
    },
  ];

  return {
    files,
    planted: [
      'Uma NF-e emitida e não escriturada na EFD ICMS/IPI (ATT-FIS-001).',
      'Um documento escriturado na EFD sem XML correspondente (ATT-FIS-002).',
      'Um documento com valor total escriturado a menor (ATT-FIS-003).',
      'Um documento com ICMS escriturado a menor (ATT-FIS-005).',
      'Um documento com CFOP escriturado diferente do CFOP do XML (ATT-FIS-006).',
      'Receita declarada no PGDAS-D abaixo do somatório dos documentos fiscais (ATT-FAT-001 a ATT-FAT-003).',
      'Um XML repetido dentro do ZIP, para demonstrar a deduplicação pela chave.',
      'Uma NF-e cancelada, que não compoe o faturamento apurado.',
    ],
  };
}

export interface SeedResult {
  readonly companyId: string;
  readonly auditId: string;
  readonly score: number;
  readonly planted: readonly string[];
  readonly alreadyExisted: boolean;
}

export async function seedDemoData(): Promise<SeedResult> {
  const store = getStore();

  let company: Company | null = await store.findCompanyByCnpj(DEMO_COMPANY.cnpj);
  if (!company) {
    company = await store.createCompany({
      legalName: DEMO_COMPANY.legalName,
      tradeName: DEMO_COMPANY.tradeName,
      cnpj: DEMO_COMPANY.cnpj,
      stateRegistration: DEMO_COMPANY.stateRegistration,
      municipalRegistration: DEMO_COMPANY.municipalRegistration,
      uf: DEMO_COMPANY.uf,
      municipality: DEMO_COMPANY.municipality,
      taxRegime: 'SIMPLES_NACIONAL',
    });
    await store.addRegimeHistory({
      companyId: company.id,
      taxRegime: 'SIMPLES_NACIONAL',
      validFrom: makeCompetencia(2026, 1),
      validTo: null,
      note: 'Regime informado no cadastro de demonstração.',
    });
  }

  const existing = (await store.listAudits({ companyId: company.id })).find(
    (audit) => audit.competencia === COMPETENCIA,
  );
  if (existing && existing.status !== 'AGUARDANDO_ARQUIVOS') {
    return {
      companyId: company.id,
      auditId: existing.id,
      score: existing.score ?? 0,
      planted: buildScenario().planted,
      alreadyExisted: true,
    };
  }

  const audit =
    existing ??
    (await store.createAudit({
      companyId: company.id,
      competencia: COMPETENCIA,
      notes:
        'Auditoria de demonstração. Os arquivos foram gerados pelo próprio sistema com inconsistências ' +
        'propositais, para validar a interface e o motor de regras. Nenhum dado real de contribuinte e utilizado.',
    }));

  const scenario = buildScenario();
  for (const file of scenario.files) {
    await ingestUpload({
      auditId: audit.id,
      company,
      competencia: COMPETENCIA,
      fileName: file.name,
      mimeType: file.mimeType,
      bytes: file.bytes,
    });
  }

  const outcome = await processAudit(audit.id);

  return {
    companyId: company.id,
    auditId: audit.id,
    score: outcome.engine.score.score,
    planted: scenario.planted,
    alreadyExisted: false,
  };
}
