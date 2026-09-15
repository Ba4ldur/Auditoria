/**
 * Cobertura do leiaute da EFD ICMS/IPI por este parser.
 *
 * Existe para responder, sem ambiguidade, a uma pergunta que decide a confiança
 * no resultado: **o que o sistema leu e o que ele não leu**. Um registro não
 * interpretado não é um detalhe de implementação — é uma parte da escrituração
 * que não participou de nenhum cruzamento, e o auditor precisa saber disso
 * antes de tratar o silêncio do relatório como conformidade.
 *
 * A lista é mantida à mão, e não derivada do código, de propósito: derivá-la
 * diria apenas quais registros têm handler, não o que a falta de cada um
 * significa para a auditoria.
 */

export interface SupportedRegister {
  readonly code: string;
  readonly description: string;
  /** O que a leitura deste registro alimenta no motor de regras. */
  readonly feeds: string;
}

export interface UnsupportedRegister {
  readonly code: string;
  readonly description: string;
  /** O que passa a ser verificável quando este registro for lido. */
  readonly unlocks: string;
}

export const SUPPORTED_REGISTERS: readonly SupportedRegister[] = [
  { code: '0000', description: 'Abertura, identificação da entidade e versão do leiaute', feeds: 'Identidade do arquivo, competência e verificação da versão do leiaute' },
  { code: '0005', description: 'Dados complementares da entidade', feeds: 'Nome fantasia na tela do arquivo' },
  { code: '0100', description: 'Dados do contabilista', feeds: 'Identificação do responsável pela escrituração' },
  { code: '0150', description: 'Cadastro do participante', feeds: 'CNPJ de emitente e destinatário, base do escopo do cruzamento' },
  { code: '0190', description: 'Unidades de medida', feeds: 'Descrição das unidades nos itens' },
  { code: '0200', description: 'Cadastro de itens', feeds: 'NCM, CEST e descrição dos itens escriturados' },
  { code: 'C100', description: 'Nota fiscal, NF-e e NFC-e, documento a documento', feeds: 'Todo o cruzamento por chave: ATT-FIS-001 a ATT-FIS-003 e ATT-FIS-007 a ATT-FIS-009' },
  { code: 'C170', description: 'Itens do documento', feeds: 'CFOP por item e comparação documento a documento' },
  { code: 'C190', description: 'Registro analítico do documento', feeds: 'CFOP predominante (ATT-FIS-006) e valores por CST/CFOP' },
  { code: 'C195', description: 'Observações do lançamento fiscal', feeds: 'Texto das observações vinculadas ao documento' },
  { code: 'C197', description: 'Ajustes e informações do documento', feeds: 'Ajustes de ICMS vinculados ao documento' },
  { code: 'E100', description: 'Período da apuração do ICMS', feeds: 'Competência da apuração' },
  { code: 'E110', description: 'Apuração do ICMS — operações próprias', feeds: 'ICMS a recolher do período' },
  { code: 'E111', description: 'Ajuste, benefício ou incentivo da apuração', feeds: 'Ajustes da apuração' },
];

/**
 * Registros de consolidação e de ECF do bloco C, ainda não interpretados.
 *
 * É por causa desta lista que NFC-e sem C100 correspondente sai como
 * `NAO_VERIFICADO` e não como divergência: sem ler estes registros, o sistema
 * não tem como afirmar que a operação não foi escriturada.
 *
 * Qual deles se aplica depende da legislação da unidade federada e do
 * equipamento emissor. O sistema **não determina** qual é o registro exigido em
 * cada caso — apenas declara que nenhum deles é lido hoje.
 */
export const UNSUPPORTED_REGISTERS: readonly UnsupportedRegister[] = [
  { code: 'C300', description: 'Resumo diário de notas fiscais de venda a consumidor', unlocks: 'Conferência de vendas a consumidor escrituradas por resumo diário' },
  { code: 'C310', description: 'Documentos cancelados do resumo diário', unlocks: 'Identificação dos documentos cancelados dentro do resumo' },
  { code: 'C320', description: 'Registro analítico do resumo diário', unlocks: 'Valores por CST e alíquota do resumo diário' },
  { code: 'C321', description: 'Itens do resumo diário', unlocks: 'Composição por item do resumo diário' },
  { code: 'C350', description: 'Nota fiscal de venda a consumidor', unlocks: 'Conferência documento a documento de venda a consumidor em papel' },
  { code: 'C370', description: 'Itens do documento de venda a consumidor', unlocks: 'Itens das vendas a consumidor' },
  { code: 'C390', description: 'Registro analítico das notas de venda a consumidor', unlocks: 'Valores por CST/CFOP das vendas a consumidor' },
  { code: 'C400', description: 'Equipamento emissor de cupom fiscal (ECF)', unlocks: 'Identificação do equipamento emissor' },
  { code: 'C405', description: 'Redução Z', unlocks: 'Totais diários do equipamento emissor' },
  { code: 'C410', description: 'PIS e COFINS totalizados no dia', unlocks: 'Contribuições apuradas no movimento do ECF' },
  { code: 'C420', description: 'Registro totalizador parcial do ECF', unlocks: 'Composição dos totalizadores do cupom' },
  { code: 'C425', description: 'Resumo de itens do movimento diário', unlocks: 'Itens vendidos no movimento diário' },
  { code: 'C460', description: 'Documento fiscal emitido por ECF', unlocks: 'Cupom fiscal documento a documento' },
  { code: 'C465', description: 'Complemento do cupom (CF-e)', unlocks: 'Chave do cupom fiscal eletrônico' },
  { code: 'C470', description: 'Itens do documento emitido por ECF', unlocks: 'Itens do cupom fiscal' },
  { code: 'C490', description: 'Registro analítico do movimento diário do ECF', unlocks: 'Valores por CST/CFOP do movimento do ECF' },
  { code: 'C495', description: 'Resumo mensal por item do ECF', unlocks: 'Consolidação mensal por item' },
];

/** Frase única usada na regra, na tela e na documentação. */
export const NFCE_CONSOLIDATION_NOTICE =
  'NFC-e escriturada por registros consolidados ainda não suportados.';

export const UNSUPPORTED_REGISTERS_SUMMARY =
  `Registros do bloco C ainda não interpretados: ${UNSUPPORTED_REGISTERS.map((item) => item.code).join(', ')}.`;
