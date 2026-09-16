/**
 * Cobertura do leiaute da EFD ICMS/IPI por este parser.
 *
 * Existe para responder, sem ambiguidade, a uma pergunta que decide a confiança
 * no resultado: **o que o sistema leu, o que ele leu sem usar, e o que ele não
 * leu**. Um registro não interpretado não é detalhe de implementação — é uma
 * parte da escrituração que não participou de nenhum cruzamento, e o auditor
 * precisa saber disso antes de tratar o silêncio do relatório como conformidade.
 *
 * A classificação é mantida à mão, e não derivada do código, de propósito:
 * derivá-la diria apenas quais registros têm handler, não o que a falta de cada
 * um significa para a auditoria.
 */

/**
 * Nível de cobertura de um registro.
 *
 * A distinção que importa não é "tem handler", e sim **o conteúdo do registro
 * chega a algum cruzamento**. Um registro lido, catalogado e inspecionável cujo
 * conteúdo nenhuma regra consulta continua sendo uma parte da escrituração
 * fora da análise — e dizer que ele é "suportado" esconderia exatamente isso.
 */
export type CoverageLevel =
  /** Lido, catalogado e o conteúdo participa de pelo menos um cruzamento. */
  | 'SUPORTADO'
  /** Lido e inspecionável campo a campo, mas nenhuma regra consulta o conteúdo. */
  | 'PARCIALMENTE_SUPORTADO'
  /** Não interpretado: o conteúdo não chega ao modelo normalizado. */
  | 'NAO_SUPORTADO';

export const COVERAGE_LEVEL_LABELS: Readonly<Record<CoverageLevel, string>> = {
  SUPORTADO: 'Suportado',
  PARCIALMENTE_SUPORTADO: 'Parcialmente suportado',
  NAO_SUPORTADO: 'Não suportado',
};

export interface RegisterCoverage {
  readonly code: string;
  readonly description: string;
  readonly level: CoverageLevel;
  /**
   * Para registros suportados, o que a leitura alimenta. Para os parciais, o
   * que é lido e por que isso ainda não chega a um cruzamento. Para os não
   * suportados, o que passaria a ser verificável se fossem lidos.
   */
  readonly detail: string;
}

export const REGISTER_COVERAGE: readonly RegisterCoverage[] = [
  // ---------------------------------------------------------------- Bloco 0
  {
    code: '0000',
    description: 'Abertura do arquivo digital e identificação da entidade',
    level: 'SUPORTADO',
    detail: 'Identidade do arquivo, competência e verificação da versão do leiaute declarada em COD_VER.',
  },
  {
    code: '0005',
    description: 'Dados complementares da entidade',
    level: 'PARCIALMENTE_SUPORTADO',
    detail: 'O nome fantasia é lido e exibido na tela do arquivo; nenhum cruzamento consulta este registro.',
  },
  {
    code: '0100',
    description: 'Dados do contabilista',
    level: 'PARCIALMENTE_SUPORTADO',
    detail: 'Identificação do responsável pela escrituração, lida para exibição; nenhuma regra a utiliza.',
  },
  {
    code: '0150',
    description: 'Tabela de cadastro do participante',
    level: 'SUPORTADO',
    detail: 'CNPJ de emitente e destinatário — base do escopo do cruzamento (saída própria x entrada de terceiro).',
  },
  {
    code: '0190',
    description: 'Identificação das unidades de medida',
    level: 'PARCIALMENTE_SUPORTADO',
    detail: 'Descrição das unidades, usada apenas para rotular itens na tela.',
  },
  {
    code: '0200',
    description: 'Tabela de identificação do item (produtos e serviços)',
    level: 'SUPORTADO',
    detail: 'NCM, CEST e descrição dos itens, aplicados aos itens escriturados na comparação documento a documento.',
  },
  // ---------------------------------------------------------------- Bloco C
  {
    code: 'C100',
    description: 'Nota fiscal, nota fiscal avulsa, NF-e e NFC-e',
    level: 'SUPORTADO',
    detail:
      'Todo o cruzamento por chave: ATT-FIS-001 a ATT-FIS-003 e ATT-FIS-007 a ATT-FIS-009, além dos valores ' +
      'comparados com o XML.',
  },
  {
    code: 'C170',
    description: 'Itens do documento',
    level: 'SUPORTADO',
    detail: 'CFOP por item, valores e CST; alimenta o CFOP predominante e a comparação item a item na tela.',
  },
  {
    code: 'C190',
    description: 'Registro analítico do documento',
    level: 'SUPORTADO',
    detail: 'CFOP predominante (ATT-FIS-006) e valores por CST/CFOP. O campo VL_OPR é lido e inspecionável.',
  },
  {
    code: 'C195',
    description: 'Observações do lançamento fiscal',
    level: 'PARCIALMENTE_SUPORTADO',
    detail: 'O texto das observações é lido e fica inspecionável, mas nenhuma regra o consulta.',
  },
  {
    code: 'C197',
    description: 'Outras obrigações tributárias, ajustes e informações do documento',
    level: 'PARCIALMENTE_SUPORTADO',
    detail:
      'Os ajustes vinculados ao documento são lidos e ficam inspecionáveis, mas nenhuma regra os confronta com o ' +
      'imposto destacado ou com a apuração.',
  },
  // ---------------------------------------------------------------- Bloco E
  {
    code: 'E100',
    description: 'Período da apuração do ICMS',
    level: 'PARCIALMENTE_SUPORTADO',
    detail: 'Delimita o período da apuração lida no E110; não participa de cruzamento por si só.',
  },
  {
    code: 'E110',
    description: 'Apuração do ICMS — operações próprias',
    level: 'PARCIALMENTE_SUPORTADO',
    detail:
      'O ICMS a recolher do período é lido e gravado como tributo apurado, mas nenhuma regra o confronta com o ' +
      'somatório dos documentos. É a conferência que falta para fechar o bloco E.',
  },
  {
    code: 'E111',
    description: 'Ajuste, benefício ou incentivo da apuração do ICMS',
    level: 'PARCIALMENTE_SUPORTADO',
    detail: 'Os ajustes da apuração são lidos e ficam inspecionáveis; nenhuma regra os utiliza.',
  },
  // ------------------------------------------------- Consolidação e ECF (bloco C)
  {
    code: 'C300',
    description: 'Resumo diário de notas fiscais de venda a consumidor',
    level: 'NAO_SUPORTADO',
    detail: 'Conferência de vendas a consumidor escrituradas por resumo diário.',
  },
  {
    code: 'C310',
    description: 'Documentos cancelados do resumo diário',
    level: 'NAO_SUPORTADO',
    detail: 'Identificação dos documentos cancelados dentro do resumo.',
  },
  {
    code: 'C320',
    description: 'Registro analítico do resumo diário',
    level: 'NAO_SUPORTADO',
    detail: 'Valores por CST e alíquota do resumo diário.',
  },
  {
    code: 'C321',
    description: 'Itens do resumo diário',
    level: 'NAO_SUPORTADO',
    detail: 'Composição por item do resumo diário.',
  },
  {
    code: 'C350',
    description: 'Nota fiscal de venda a consumidor',
    level: 'NAO_SUPORTADO',
    detail: 'Conferência documento a documento de venda a consumidor em papel.',
  },
  {
    code: 'C370',
    description: 'Itens do documento de venda a consumidor',
    level: 'NAO_SUPORTADO',
    detail: 'Itens das vendas a consumidor.',
  },
  {
    code: 'C390',
    description: 'Registro analítico das notas de venda a consumidor',
    level: 'NAO_SUPORTADO',
    detail: 'Valores por CST/CFOP das vendas a consumidor.',
  },
  {
    code: 'C400',
    description: 'Equipamento emissor de cupom fiscal (ECF)',
    level: 'NAO_SUPORTADO',
    detail: 'Identificação do equipamento emissor.',
  },
  {
    code: 'C405',
    description: 'Redução Z',
    level: 'NAO_SUPORTADO',
    detail: 'Totais diários do equipamento emissor.',
  },
  {
    code: 'C410',
    description: 'PIS e COFINS totalizados no dia',
    level: 'NAO_SUPORTADO',
    detail: 'Contribuições apuradas no movimento do ECF.',
  },
  {
    code: 'C420',
    description: 'Registro totalizador parcial do ECF',
    level: 'NAO_SUPORTADO',
    detail: 'Composição dos totalizadores do cupom.',
  },
  {
    code: 'C425',
    description: 'Resumo de itens do movimento diário',
    level: 'NAO_SUPORTADO',
    detail: 'Itens vendidos no movimento diário.',
  },
  {
    code: 'C460',
    description: 'Documento fiscal emitido por ECF',
    level: 'NAO_SUPORTADO',
    detail: 'Cupom fiscal documento a documento.',
  },
  {
    code: 'C465',
    description: 'Complemento do cupom (CF-e)',
    level: 'NAO_SUPORTADO',
    detail: 'Chave do cupom fiscal eletrônico.',
  },
  {
    code: 'C470',
    description: 'Itens do documento emitido por ECF',
    level: 'NAO_SUPORTADO',
    detail: 'Itens do cupom fiscal.',
  },
  {
    code: 'C490',
    description: 'Registro analítico do movimento diário do ECF',
    level: 'NAO_SUPORTADO',
    detail: 'Valores por CST/CFOP do movimento do ECF.',
  },
  {
    code: 'C495',
    description: 'Resumo mensal por item do ECF',
    level: 'NAO_SUPORTADO',
    detail: 'Consolidação mensal por item.',
  },
];

const BY_CODE = new Map(REGISTER_COVERAGE.map((entry) => [entry.code, entry]));

/**
 * Cobertura de um registro encontrado no arquivo.
 *
 * Registro fora do catálogo é `NAO_SUPORTADO` com detalhe genérico: o arquivo
 * real traz registros que este catálogo não antecipou, e omiti-los da
 * classificação daria a impressão de que foram analisados.
 */
export function coverageOf(code: string): RegisterCoverage {
  return (
    BY_CODE.get(code) ?? {
      code,
      description: 'Registro não catalogado por este parser',
      level: 'NAO_SUPORTADO',
      detail:
        'O registro existe no arquivo e não é interpretado. Seu conteúdo não participou de nenhum cruzamento.',
    }
  );
}

export const SUPPORTED_REGISTERS = REGISTER_COVERAGE.filter((entry) => entry.level === 'SUPORTADO');
export const PARTIAL_REGISTERS = REGISTER_COVERAGE.filter(
  (entry) => entry.level === 'PARCIALMENTE_SUPORTADO',
);
export const UNSUPPORTED_REGISTERS = REGISTER_COVERAGE.filter(
  (entry) => entry.level === 'NAO_SUPORTADO',
);

/** Frase única usada na regra, na tela e na documentação. */
export const NFCE_CONSOLIDATION_NOTICE =
  'NFC-e escriturada por registros consolidados ainda não suportados.';

export const UNSUPPORTED_REGISTERS_SUMMARY =
  `Registros do bloco C ainda não interpretados: ${UNSUPPORTED_REGISTERS.map((item) => item.code).join(', ')}.`;
