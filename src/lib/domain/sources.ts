/**
 * Catalogue of fiscal/accounting obligations known to the system.
 *
 * Every obligation is declared here even when its parser is not implemented
 * yet: the catalogue is what the UI renders, what the rule engine uses to
 * decide whether a rule is applicable, and what a new parser plugs into.
 * Adding an obligation is a change in this file plus a parser module — never a
 * change in the audit rules or in the React components.
 */

export const DATA_SOURCES = [
  'XML_NFE',
  'XML_NFCE',
  'EFD_ICMS_IPI',
  'EFD_CONTRIBUICOES',
  'PGDAS_D',
  'NFSE',
  'CTE',
  'MDFE',
  'ESOCIAL',
  'EFD_REINF',
  'DCTFWEB',
  'MIT',
  'DARF',
  'ECD',
  'ECF',
  'BALANCETE',
  'RAZAO',
  'FOLHA_PAGAMENTO',
  'EXTRATO_BANCARIO',
] as const;

export type DataSourceKind = (typeof DATA_SOURCES)[number];

export type AuditModule = 'FISCAL' | 'FATURAMENTO' | 'TRIBUTARIO' | 'CONTABIL' | 'TRABALHISTA' | 'CADASTRAL';

export interface DataSourceDefinition {
  readonly kind: DataSourceKind;
  readonly label: string;
  readonly shortLabel: string;
  readonly module: AuditModule;
  /** File extensions accepted for this obligation. */
  readonly extensions: readonly string[];
  /** True when a parser for this obligation ships in the current release. */
  readonly implemented: boolean;
  readonly description: string;
}

export const DATA_SOURCE_DEFINITIONS: Readonly<Record<DataSourceKind, DataSourceDefinition>> = {
  XML_NFE: {
    kind: 'XML_NFE',
    label: 'XML de NF-e (modelo 55)',
    shortLabel: 'NF-e',
    module: 'FISCAL',
    extensions: ['.xml', '.zip'],
    implemented: true,
    description: 'Nota Fiscal Eletrônica em XML, individual ou dentro de arquivo ZIP.',
  },
  XML_NFCE: {
    kind: 'XML_NFCE',
    label: 'XML de NFC-e (modelo 65)',
    shortLabel: 'NFC-e',
    module: 'FISCAL',
    extensions: ['.xml', '.zip'],
    implemented: true,
    description: 'Nota Fiscal de Consumidor Eletrônica em XML.',
  },
  EFD_ICMS_IPI: {
    kind: 'EFD_ICMS_IPI',
    label: 'EFD ICMS/IPI',
    shortLabel: 'EFD ICMS/IPI',
    module: 'FISCAL',
    extensions: ['.txt'],
    implemented: true,
    description: 'Escrituração Fiscal Digital do ICMS e do IPI (SPED Fiscal).',
  },
  EFD_CONTRIBUICOES: {
    kind: 'EFD_CONTRIBUICOES',
    label: 'EFD-Contribuicoes',
    shortLabel: 'EFD-Contrib.',
    module: 'TRIBUTARIO',
    extensions: ['.txt'],
    implemented: true,
    description: 'Escrituração Fiscal Digital das Contribuições (PIS/Pasep e COFINS).',
  },
  PGDAS_D: {
    kind: 'PGDAS_D',
    label: 'PGDAS-D',
    shortLabel: 'PGDAS-D',
    module: 'FATURAMENTO',
    extensions: ['.pdf'],
    implemented: true,
    description: 'Declaração do Simples Nacional (extrato / recibo em PDF textual).',
  },
  NFSE: {
    kind: 'NFSE',
    label: 'NFS-e',
    shortLabel: 'NFS-e',
    module: 'FISCAL',
    extensions: ['.xml', '.zip'],
    implemented: false,
    description: 'Nota Fiscal de Serviço Eletrônica.',
  },
  CTE: {
    kind: 'CTE',
    label: 'CT-e',
    shortLabel: 'CT-e',
    module: 'FISCAL',
    extensions: ['.xml', '.zip'],
    implemented: false,
    description: 'Conhecimento de Transporte Eletrônico.',
  },
  MDFE: {
    kind: 'MDFE',
    label: 'MDF-e',
    shortLabel: 'MDF-e',
    module: 'FISCAL',
    extensions: ['.xml', '.zip'],
    implemented: false,
    description: 'Manifesto Eletrônico de Documentos Fiscais.',
  },
  ESOCIAL: {
    kind: 'ESOCIAL',
    label: 'eSocial',
    shortLabel: 'eSocial',
    module: 'TRABALHISTA',
    extensions: ['.xml', '.zip'],
    implemented: false,
    description: 'Eventos do eSocial.',
  },
  EFD_REINF: {
    kind: 'EFD_REINF',
    label: 'EFD-Reinf',
    shortLabel: 'EFD-Reinf',
    module: 'TRABALHISTA',
    extensions: ['.xml', '.zip'],
    implemented: false,
    description: 'Escrituração Fiscal Digital de Retenções e Outras Informacoes Fiscais.',
  },
  DCTFWEB: {
    kind: 'DCTFWEB',
    label: 'DCTFWeb',
    shortLabel: 'DCTFWeb',
    module: 'TRIBUTARIO',
    extensions: ['.pdf', '.xml'],
    implemented: false,
    description: 'Declaração de Débitos e Créditos Tributários Federais Previdenciarios e de Outras Entidades.',
  },
  MIT: {
    kind: 'MIT',
    label: 'MIT',
    shortLabel: 'MIT',
    module: 'TRIBUTARIO',
    extensions: ['.pdf', '.xml'],
    implemented: false,
    description: 'Módulo de Inclusão de Tributos da DCTFWeb.',
  },
  DARF: {
    kind: 'DARF',
    label: 'DARF',
    shortLabel: 'DARF',
    module: 'TRIBUTARIO',
    extensions: ['.pdf'],
    implemented: false,
    description: 'Documento de Arrecadação de Receitas Federais.',
  },
  ECD: {
    kind: 'ECD',
    label: 'ECD',
    shortLabel: 'ECD',
    module: 'CONTABIL',
    extensions: ['.txt'],
    implemented: false,
    description: 'Escrituração Contábil Digital.',
  },
  ECF: {
    kind: 'ECF',
    label: 'ECF',
    shortLabel: 'ECF',
    module: 'CONTABIL',
    extensions: ['.txt'],
    implemented: false,
    description: 'Escrituração Contábil Fiscal.',
  },
  BALANCETE: {
    kind: 'BALANCETE',
    label: 'Balancete',
    shortLabel: 'Balancete',
    module: 'CONTABIL',
    extensions: ['.pdf', '.csv', '.txt'],
    implemented: false,
    description: 'Balancete de verificação.',
  },
  RAZAO: {
    kind: 'RAZAO',
    label: 'Razão contábil',
    shortLabel: 'Razão',
    module: 'CONTABIL',
    extensions: ['.pdf', '.csv', '.txt'],
    implemented: false,
    description: 'Livro razão.',
  },
  FOLHA_PAGAMENTO: {
    kind: 'FOLHA_PAGAMENTO',
    label: 'Folha de pagamento',
    shortLabel: 'Folha',
    module: 'TRABALHISTA',
    extensions: ['.pdf', '.csv', '.txt'],
    implemented: false,
    description: 'Resumo da folha de pagamento.',
  },
  EXTRATO_BANCARIO: {
    kind: 'EXTRATO_BANCARIO',
    label: 'Extrato bancario',
    shortLabel: 'Extrato',
    module: 'CONTABIL',
    extensions: ['.pdf', '.csv', '.ofx'],
    implemented: false,
    description: 'Extrato de conta corrente para conciliacao financeira.',
  },
};

export const IMPLEMENTED_SOURCES: readonly DataSourceKind[] = DATA_SOURCES.filter(
  (kind) => DATA_SOURCE_DEFINITIONS[kind].implemented,
);

export function sourceLabel(kind: DataSourceKind): string {
  return DATA_SOURCE_DEFINITIONS[kind].label;
}

export function sourceShortLabel(kind: DataSourceKind): string {
  return DATA_SOURCE_DEFINITIONS[kind].shortLabel;
}

export const AUDIT_MODULE_LABELS: Readonly<Record<AuditModule, string>> = {
  FISCAL: 'Fiscal',
  FATURAMENTO: 'Faturamento',
  TRIBUTARIO: 'Tributário',
  CONTABIL: 'Contábil',
  TRABALHISTA: 'Trabalhista',
  CADASTRAL: 'Cadastral',
};
