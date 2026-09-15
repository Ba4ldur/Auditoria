/**
 * Versões dos parsers (fase 2, requisito 14).
 *
 * A versão da aplicação não serve para esta finalidade: um release pode não
 * tocar em nenhum parser, e uma correção de posição de campo precisa ser
 * rastreável por si só. Cada arquivo processado guarda a versão do parser que o
 * interpretou, para que seja possível saber exatamente o que produziu um
 * resultado antigo — e decidir o que precisa ser reprocessado.
 *
 * Incremente a versão sempre que mudar a leitura de um campo, a detecção de
 * tipo ou a lista de layouts verificados.
 */

// 1.1.0: leitura de ide/finNFe, dos grupos de IBS/CBS/IS e do destinatário na identidade.
export const XML_PARSER_VERSION = '1.1.0';
// 1.1.0: identidade do arquivo passa a incluir todas as partes das operações.
export const ZIP_PARSER_VERSION = '1.1.0';
// 1.1.0: COD_SIT passa a alimentar finalidade e escrituração extemporânea.
export const EFD_ICMS_IPI_PARSER_VERSION = '1.1.0';
export const EFD_CONTRIB_PARSER_VERSION = '1.0.0';
export const PGDAS_PARSER_VERSION = '1.0.0';

/** Versões declaradas, para exibição na tela de configurações. */
export const PARSER_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  'XML NF-e/NFC-e': XML_PARSER_VERSION,
  'ZIP de XML': ZIP_PARSER_VERSION,
  'EFD ICMS/IPI': EFD_ICMS_IPI_PARSER_VERSION,
  'EFD-Contribuições': EFD_CONTRIB_PARSER_VERSION,
  'PGDAS-D': PGDAS_PARSER_VERSION,
});
