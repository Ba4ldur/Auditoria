/**
 * Regras ATT-FIS-001 a ATT-FIS-007 — XML de NF-e/NFC-e × EFD ICMS/IPI.
 *
 * Todas afirmam fatos aritméticos sobre os arquivos apresentados. Se um fato é
 * ou não um erro depende da natureza da operação e cabe ao auditor: cada
 * ocorrência carrega `analiseHumana` dizendo o que o sistema pode e o que não
 * pode concluir sozinho (requisito 35).
 *
 * Três decisões estruturam este módulo:
 *
 * - **O pareamento é único.** Todas as regras leem a mesma reconciliação
 *   (`reconcile`), calculada uma vez por dataset. Nenhuma regra pareia
 *   documentos por conta própria.
 * - **O escopo decide o critério.** Saída própria e entrada de terceiro não
 *   admitem as mesmas comparações. Onde a comparação não é válida, a regra
 *   reporta `NAO_APLICAVEL` com o motivo — nunca uma divergência.
 * - **Ressalva rebaixa a conclusão, não a esconde.** Documento complementar,
 *   ajuste, devolução ou regime especial continuam sendo comparados e a
 *   diferença continua sendo exibida, mas como `INDICIO`, com o campo e o valor
 *   que justificam a ressalva na evidência.
 */

import { formatBRL, type Cents } from '@/lib/core/money';
import { formatIsoDate } from '@/lib/core/dates';
import type { Invoice } from '@/lib/domain/model';
import { compareValues } from '../tolerance';
import {
  FISCAL_SCOPE_LABELS,
  blockingCaveats,
  reconcile,
  scopeOf,
  type Caveat,
  type DocumentPair,
  type FiscalScope,
  type Reconciliation,
} from '../reconciliation';
import { DEFAULT_TOLERANCE, type AuditRule, type RuleContext, type RuleFinding, type RuleResult } from '../types';
import {
  MAX_INDIVIDUAL_FINDINGS,
  describeInvoice,
  invoiceReference,
  tracer,
  type EvidenceDraft,
  type Tracer,
} from './helpers';

const REQUIRED = ['XML_NFE', 'EFD_ICMS_IPI'] as const;

/** Modelos que obrigatoriamente possuem chave de acesso. */
const KEYED_MODELS = new Set(['55', '65']);

// -----------------------------------------------------------------------------
// Blocos compartilhados
// -----------------------------------------------------------------------------

/**
 * Bloqueia a regra quando falta um dos lados do cruzamento.
 *
 * Ausência de documento não é conformidade: o resultado é `NAO_VERIFICADO`, que
 * não entra no score.
 */
function notVerified(context: RuleContext, codigo: string): RuleResult | null {
  const hasEfd = context.dataset.availableSources.has('EFD_ICMS_IPI');
  const hasXml =
    context.dataset.availableSources.has('XML_NFE') || context.dataset.availableSources.has('XML_NFCE');
  if (hasEfd && hasXml) return null;

  const absent = [...(hasEfd ? [] : ['EFD ICMS/IPI']), ...(hasXml ? [] : ['XML de NF-e/NFC-e'])];
  return {
    cruzamentosCorretos: 0,
    findings: [
      {
        resultado: 'NAO_VERIFICADO',
        natureza: 'FATO',
        titulo: `${codigo}: cruzamento não executado`,
        descricao: `Documentos necessários ausentes nesta auditoria: ${absent.join(', ')}.`,
        evidencias: [],
      },
    ],
    naoAplicavel: `Documentos necessários ausentes: ${absent.join(', ')}.`,
  };
}

/** Evidência da chave usada para parear, do lado do XML. */
function keyEvidence(trace: Tracer, invoice: Invoice, key: string): EvidenceDraft {
  return trace.evidence('Chave de acesso', 'Identificador do documento no XML', key, {
    source: invoice.source,
    from: invoice.origin,
    field: 'infNFe/@Id',
    reference: key,
  });
}

/** Evidências das ressalvas de um par, com o campo e o valor que as geraram. */
function caveatEvidences(trace: Tracer, caveats: readonly Caveat[]): EvidenceDraft[] {
  return caveats.map((caveat) =>
    trace.evidence(
      `Ressalva: ${caveat.titulo}`,
      caveat.explicacao,
      caveat.campo ? `${caveat.campo} = ${caveat.valor ?? 'vazio'}` : (caveat.valor ?? 'declarado pela fonte'),
      { from: caveat.origem, field: caveat.campo },
    ),
  );
}

function scopeEvidence(trace: Tracer, scope: FiscalScope): EvidenceDraft {
  return trace.evidence(
    'Escopo do cruzamento',
    'Sentido da operação sob a ótica da empresa auditada, apurado pelo CNPJ do emitente e do destinatário',
    FISCAL_SCOPE_LABELS[scope],
  );
}

/**
 * Limita o detalhamento individual para que uma falha sistemática produza um
 * relatório legível, e declara quantas ocorrências ficaram agrupadas.
 */
function truncate(findings: RuleFinding[], codigo: string, trace: Tracer): RuleFinding[] {
  if (findings.length <= MAX_INDIVIDUAL_FINDINGS) return findings;
  const total = findings.length;
  const kept = findings.slice(0, MAX_INDIVIDUAL_FINDINGS);
  kept.push({
    resultado: 'ALERTA',
    natureza: 'FATO',
    titulo: `${codigo}: ocorrências adicionais não detalhadas`,
    descricao:
      `Foram encontradas ${total} ocorrências. As primeiras ${MAX_INDIVIDUAL_FINDINGS} estão detalhadas ` +
      'individualmente; as demais foram agrupadas nesta ocorrência para manter o relatório legível.',
    evidencias: [
      trace.evidence('Total de ocorrências', 'Contagem apurada pela regra', String(total)),
      trace.evidence('Detalhadas', 'Limite de detalhamento da regra', String(MAX_INDIVIDUAL_FINDINGS)),
    ],
  });
  return kept;
}

/**
 * Ocorrência agregada para um conjunto de documentos que a regra decidiu não
 * concluir. Existe para que o auditor veja o que ficou de fora e por quê, em
 * vez de o silêncio passar por conformidade.
 */
function aggregate(spec: {
  resultado: RuleFinding['resultado'];
  natureza: RuleFinding['natureza'];
  titulo: string;
  descricao: string;
  analiseHumana: string;
  documentos: readonly Invoice[];
  evidencias: readonly EvidenceDraft[];
  trace: Tracer;
}): RuleFinding {
  const amostra = spec.documentos.slice(0, 5).map((invoice) => invoiceReference(invoice));
  return {
    resultado: spec.resultado,
    natureza: spec.natureza,
    titulo: spec.titulo,
    descricao: spec.descricao,
    analiseHumana: spec.analiseHumana,
    evidencias: [
      spec.trace.evidence(
        'Documentos abrangidos',
        'Contagem apurada pela regra sobre os documentos pareados',
        String(spec.documentos.length),
      ),
      ...(amostra.length > 0
        ? [
            spec.trace.evidence(
              'Amostra de chaves',
              `Primeiras ${amostra.length} de ${spec.documentos.length} ocorrências, para conferência`,
              amostra.join(', '),
            ),
          ]
        : []),
      ...spec.evidencias,
    ],
  };
}

// -----------------------------------------------------------------------------
// ATT-FIS-001
// -----------------------------------------------------------------------------

export const attFis001: AuditRule = {
  id: 'att-fis-001',
  codigo: 'ATT-FIS-001',
  versao: '2.0.0',
  nome: 'XML de NF-e sem escrituração na EFD ICMS/IPI',
  descricao:
    'Localiza documentos existentes no XML cuja chave de acesso não foi encontrada em nenhum registro C100 da EFD ICMS/IPI.',
  modulo: 'FISCAL',
  gravidade: 'ALTA',
  documentosNecessarios: [...REQUIRED],
  toleranciaPadrao: DEFAULT_TOLERANCE,
  limitacoes:
    'O sistema determina automaticamente apenas o FATO de a chave não constar na EFD apresentada. A CONCLUSÃO de que o ' +
    'documento deveria obrigatoriamente estar escriturado naquele arquivo depende da natureza da operação, do ' +
    'estabelecimento e do período, e exige análise humana. NFC-e não escriturada documento a documento não é acusada ' +
    'como ausente: pode estar em registros de consolidação que este parser ainda não lê.',
  executar(context) {
    const blocked = notVerified(context, 'ATT-FIS-001');
    if (blocked) return blocked;

    const trace = tracer(context.dataset);
    const recon = reconcile(context.dataset);
    const consolidacao = new Set(recon.nfceSemModelo65NaEfd.map((invoice) => invoice.id));
    const ausentes = recon.xmlOnly.filter((invoice) => !consolidacao.has(invoice.id));

    const findings: RuleFinding[] = ausentes.map((invoice) => {
      const scope = scopeOf(invoice, null);
      const entrada = scope === 'ENTRADA_TERCEIRO';
      return {
        resultado: scope === 'INDEFINIDO' ? 'ALERTA' : 'DIVERGENCIA',
        natureza: scope === 'INDEFINIDO' ? 'INDICIO' : 'FATO',
        titulo: `Documento ${describeInvoice(invoice)} não localizado na EFD ICMS/IPI`,
        descricao:
          `A chave de acesso ${invoice.accessKey} consta no XML importado e não foi encontrada em nenhum registro ` +
          `C100 do arquivo da EFD ICMS/IPI desta competência. Escopo: ${FISCAL_SCOPE_LABELS[scope].toLowerCase()}.`,
        documento: invoiceReference(invoice),
        rotuloOrigem: 'Valor total do XML',
        valorOrigem: invoice.totalValue,
        rotuloDestino: 'EFD ICMS/IPI',
        valorDestino: null,
        diferenca: invoice.totalValue,
        analiseHumana: entrada
          ? 'Documento recebido de terceiro. Confirme se a entrada deve ser escriturada neste estabelecimento e nesta ' +
            'competência: a data de entrada pode deslocar a escrituração para outro período.'
          : scope === 'INDEFINIDO'
            ? 'Não foi possível determinar de que lado da operação a empresa está: o XML não traz CNPJ de emitente e ' +
              'destinatário conciliáveis com o cadastro. Confirme o documento antes de qualquer conclusão.'
            : 'Verifique se a operação deve constar nesta EFD: documentos de outro estabelecimento, de outra ' +
              'competência ou com tratamento específico podem legitimamente não estar escriturados neste arquivo.',
        evidencias: [
          keyEvidence(trace, invoice, invoice.accessKey ?? ''),
          scopeEvidence(trace, scope),
          trace.evidence('Emissão', 'Data de emissão declarada no XML', formatIsoDate(invoice.issueDate), {
            source: invoice.source,
            from: invoice.origin,
            field: 'ide/dhEmi',
          }),
          trace.money('Valor total', 'Total do documento declarado no XML', invoice.totalValue, {
            source: invoice.source,
            from: invoice.origin,
            field: 'total/ICMSTot/vNF',
          }),
          trace.evidence(
            'Busca na EFD',
            'Comparação com o campo CHV_NFE de todos os registros C100 do arquivo',
            'Chave não encontrada',
            { source: 'EFD_ICMS_IPI', field: 'CHV_NFE' },
          ),
          trace.evidence(
            'Tolerância',
            'O cruzamento é por presença da chave, não por valor: nenhuma tolerância se aplica',
            'Não aplicável',
          ),
        ],
      };
    });

    if (recon.nfceSemModelo65NaEfd.length > 0) {
      findings.push(
        aggregate({
          resultado: 'NAO_VERIFICADO',
          natureza: 'FATO',
          titulo: 'NFC-e não conferidas: a EFD não escritura documentos de modelo 65',
          descricao:
            `${recon.nfceSemModelo65NaEfd.length} NFC-e do XML não têm registro C100 correspondente, e o arquivo da ` +
            'EFD não escritura nenhum documento de modelo 65. Este parser lê a escrituração documento a documento ' +
            '(C100) e não os registros de consolidação do bloco C, de modo que a ausência não pode ser afirmada.',
          analiseHumana:
            'Verifique no arquivo da EFD se as operações com consumidor final estão escrituradas por registros de ' +
            'consolidação. Enquanto isso não for confirmado, estas NFC-e não são apuradas como não escrituradas.',
          documentos: recon.nfceSemModelo65NaEfd,
          evidencias: [
            trace.evidence(
              'Documentos de modelo 65 na EFD',
              'Contagem de registros C100 com COD_MOD igual a 65',
              '0',
              { source: 'EFD_ICMS_IPI', field: 'COD_MOD' },
            ),
          ],
          trace,
        }),
      );
    }

    if (recon.xmlWithoutKey.length > 0) {
      findings.push(
        aggregate({
          resultado: 'ALERTA',
          natureza: 'FATO',
          titulo: 'Documentos XML sem chave de acesso legível',
          descricao:
            `${recon.xmlWithoutKey.length} documento(s) do XML não possuem chave de acesso legível e por isso ficaram ` +
            'fora do cruzamento por chave.',
          analiseHumana:
            'Confira os arquivos indicados: XML truncado, sem protocolo ou com chave inválida não pode ser pareado ' +
            'com a escrituração, e sua ausência no cruzamento não significa conformidade.',
          documentos: recon.xmlWithoutKey,
          evidencias: [],
          trace,
        }),
      );
    }

    return {
      cruzamentosCorretos: recon.pairs.length,
      findings: truncate(findings, 'ATT-FIS-001', trace),
    };
  },
};

// -----------------------------------------------------------------------------
// ATT-FIS-002
// -----------------------------------------------------------------------------

export const attFis002: AuditRule = {
  id: 'att-fis-002',
  codigo: 'ATT-FIS-002',
  versao: '2.0.0',
  nome: 'Documento escriturado na EFD ICMS/IPI sem XML correspondente',
  descricao:
    'Localiza registros C100 com chave de acesso que não possuem XML correspondente entre os arquivos importados, e ' +
    'chaves escrituradas mais de uma vez no mesmo arquivo.',
  modulo: 'FISCAL',
  gravidade: 'MEDIA',
  documentosNecessarios: [...REQUIRED],
  toleranciaPadrao: DEFAULT_TOLERANCE,
  limitacoes:
    'A ausência do XML pode significar apenas que o arquivo não foi entregue para auditoria, e não que o documento ' +
    'seja indevido. A regra atesta a ausência do arquivo de origem, não a inexistência do documento. Entradas de ' +
    'terceiros são reportadas em conjunto, porque não ter o XML do fornecedor é a situação esperada.',
  executar(context) {
    const blocked = notVerified(context, 'ATT-FIS-002');
    if (blocked) return blocked;

    const trace = tracer(context.dataset);
    const recon = reconcile(context.dataset);

    const proprias = recon.efdOnly.filter((invoice) => scopeOf(null, invoice) === 'SAIDA_PROPRIA');
    const entradas = recon.efdOnly.filter((invoice) => scopeOf(null, invoice) === 'ENTRADA_TERCEIRO');
    const indefinidos = recon.efdOnly.filter((invoice) => scopeOf(null, invoice) === 'INDEFINIDO');

    const findings: RuleFinding[] = proprias.map((invoice) => ({
      resultado: 'DIVERGENCIA',
      natureza: 'FATO',
      titulo: `Documento ${describeInvoice(invoice)} escriturado sem XML de origem`,
      descricao:
        `A chave de acesso ${invoice.accessKey} consta no registro C100 da EFD ICMS/IPI como saída própria e não foi ` +
        'encontrada entre os XML importados nesta auditoria.',
      documento: invoiceReference(invoice),
      rotuloOrigem: 'EFD ICMS/IPI',
      valorOrigem: invoice.totalValue,
      rotuloDestino: 'XML',
      valorDestino: null,
      diferenca: invoice.totalValue,
      analiseHumana:
        'Confirme se o XML simplesmente não foi entregue para a auditoria antes de tratar a ocorrência como erro de ' +
        'escrituração. Tratando-se de documento emitido pela própria empresa, o arquivo deveria estar disponível.',
      evidencias: [
        trace.evidence('Chave de acesso', 'Chave do documento escriturado', invoice.accessKey, {
          source: 'EFD_ICMS_IPI',
          from: invoice.origin,
          field: 'CHV_NFE',
          reference: invoice.accessKey,
        }),
        scopeEvidence(trace, 'SAIDA_PROPRIA'),
        trace.money('Valor do documento', 'Total escriturado no registro C100', invoice.totalValue, {
          source: 'EFD_ICMS_IPI',
          from: invoice.origin,
          field: 'VL_DOC',
        }),
        trace.evidence(
          'Busca nos XML',
          'Comparação com a chave de acesso de todos os XML importados',
          'Chave não encontrada',
          { source: 'XML_NFE', field: 'infNFe/@Id' },
        ),
      ],
    }));

    if (entradas.length > 0) {
      findings.push(
        aggregate({
          resultado: 'ALERTA',
          natureza: 'INDICIO',
          titulo: 'Entradas escrituradas sem o XML do emitente',
          descricao:
            `${entradas.length} registro(s) C100 de entrada não têm XML correspondente entre os arquivos importados. ` +
            'O XML de uma entrada é emitido por terceiro e frequentemente não integra o acervo entregue para auditoria.',
          analiseHumana:
            'Só trate como falha de guarda documental se a empresa deveria manter esses XML. A ausência aqui não ' +
            'indica, por si só, escrituração indevida.',
          documentos: entradas,
          evidencias: [
            trace.evidence(
              'Origem dos registros',
              'Registros C100 com IND_OPER indicando entrada',
              'EFD ICMS/IPI, registro C100',
              { source: 'EFD_ICMS_IPI', field: 'IND_OPER' },
            ),
          ],
          trace,
        }),
      );
    }

    if (indefinidos.length > 0) {
      findings.push(
        aggregate({
          resultado: 'ALERTA',
          natureza: 'INDICIO',
          titulo: 'Documentos escriturados sem XML e com sentido da operação indeterminado',
          descricao:
            `${indefinidos.length} registro(s) C100 sem XML correspondente não puderam ser classificados como entrada ` +
            'ou saída a partir dos dados do arquivo.',
          analiseHumana:
            'Confira o campo IND_OPER desses registros e o cadastro do participante antes de qualquer conclusão.',
          documentos: indefinidos,
          evidencias: [],
          trace,
        }),
      );
    }

    for (const duplicate of recon.efdDuplicates) {
      findings.push({
        resultado: 'DIVERGENCIA',
        natureza: 'FATO',
        titulo: `Chave escriturada mais de uma vez — ${describeInvoice(duplicate.invoice)}`,
        descricao:
          `A chave de acesso ${duplicate.key} aparece em ${duplicate.occurrences.length} registros C100 da EFD ` +
          'ICMS/IPI. Cruzamentos por chave consideram apenas a primeira ocorrência.',
        documento: duplicate.key,
        analiseHumana:
          'Escrituração em duplicidade altera a apuração do período. Confirme nas linhas indicadas se os registros ' +
          'se referem ao mesmo documento antes de concluir.',
        evidencias: [
          trace.evidence('Chave de acesso', 'Chave repetida na escrituração', duplicate.key, {
            source: 'EFD_ICMS_IPI',
            field: 'CHV_NFE',
            reference: duplicate.key,
          }),
          ...duplicate.occurrences.map((origem, index) =>
            trace.evidence(
              `Ocorrência ${index + 1}`,
              'Linha do arquivo da EFD em que a chave foi escriturada',
              origem.lineNumber === null ? 'linha não registrada' : `linha ${origem.lineNumber}`,
              { source: 'EFD_ICMS_IPI', from: origem, field: 'CHV_NFE' },
            ),
          ),
        ],
      });
    }

    const semChave = recon.efdWithoutKey.filter((invoice) => KEYED_MODELS.has(invoice.model ?? ''));
    if (semChave.length > 0) {
      findings.push(
        aggregate({
          resultado: 'ALERTA',
          natureza: 'FATO',
          titulo: 'Registros C100 de NF-e/NFC-e sem chave de acesso',
          descricao:
            `${semChave.length} registro(s) C100 de modelo 55 ou 65 não trazem CHV_NFE preenchida e ficaram fora do ` +
            'cruzamento por chave.',
          analiseHumana:
            'Documento eletrônico escriturado sem chave não pode ser confrontado com o XML. Verifique a geração do ' +
            'arquivo antes de considerar os cruzamentos desta competência completos.',
          documentos: semChave,
          evidencias: [
            trace.evidence('Campo conferido', 'Campo CHV_NFE do registro C100', 'vazio', {
              source: 'EFD_ICMS_IPI',
              field: 'CHV_NFE',
            }),
          ],
          trace,
        }),
      );
    }

    return {
      cruzamentosCorretos: recon.pairs.length,
      findings: truncate(findings, 'ATT-FIS-002', trace),
    };
  },
};

// -----------------------------------------------------------------------------
// ATT-FIS-003 a ATT-FIS-005 — comparação de valores
// -----------------------------------------------------------------------------

interface ValueRuleSpec {
  readonly id: string;
  readonly codigo: string;
  readonly versao: string;
  readonly nome: string;
  readonly descricao: string;
  readonly gravidade: AuditRule['gravidade'];
  readonly limitacoes: string;
  readonly originLabel: string;
  readonly targetLabel: string;
  readonly xmlOrigin: string;
  readonly xmlField: string;
  readonly efdOrigin: string;
  readonly efdField: string;
  readonly pick: (invoice: Invoice) => Cents;
  readonly analiseHumana: string;
  /**
   * Escopos em que a comparação é conclusiva. Os demais são reportados como
   * `NAO_APLICAVEL`, com o motivo — nunca comparados às escondidas.
   */
  readonly escoposComparaveis: readonly FiscalScope[];
  /** Por que o escopo excluído não admite a comparação. */
  readonly motivoEscopoExcluido: string;
}

function valueComparisonRule(spec: ValueRuleSpec): AuditRule {
  return {
    id: spec.id,
    codigo: spec.codigo,
    versao: spec.versao,
    nome: spec.nome,
    descricao: spec.descricao,
    modulo: 'FISCAL',
    gravidade: spec.gravidade,
    documentosNecessarios: [...REQUIRED],
    toleranciaPadrao: DEFAULT_TOLERANCE,
    limitacoes: spec.limitacoes,
    executar(context) {
      const blocked = notVerified(context, spec.codigo);
      if (blocked) return blocked;

      const trace = tracer(context.dataset);
      const recon = reconcile(context.dataset);
      const comparaveis = new Set(spec.escoposComparaveis);

      const findings: RuleFinding[] = [];
      const foraDeEscopo: DocumentPair[] = [];
      let correct = 0;

      for (const pair of recon.pairs) {
        if (!comparaveis.has(pair.scope)) {
          foraDeEscopo.push(pair);
          continue;
        }

        const comparison = compareValues(
          spec.pick(pair.xml),
          spec.pick(pair.efd),
          context.config.tolerancia,
        );
        if (comparison.withinTolerance) {
          correct += 1;
          continue;
        }

        const ressalvas = blockingCaveats(pair);
        const comRessalva = ressalvas.length > 0;

        findings.push({
          resultado: comRessalva ? 'ALERTA' : 'DIVERGENCIA',
          natureza: comRessalva ? 'INDICIO' : 'FATO',
          titulo: `${spec.nome} — ${describeInvoice(pair.xml)}`,
          descricao:
            `${spec.originLabel}: ${formatBRL(comparison.origin)}. ${spec.targetLabel}: ${formatBRL(comparison.target)}. ` +
            `Diferença de ${formatBRL(comparison.difference)}. ${comparison.toleranceLabel}` +
            (comRessalva
              ? ` Diferença apresentada como indício: ${ressalvas.map((item) => item.titulo.toLowerCase()).join('; ')}.`
              : ''),
          documento: invoiceReference(pair.xml),
          rotuloOrigem: spec.originLabel,
          valorOrigem: comparison.origin,
          rotuloDestino: spec.targetLabel,
          valorDestino: comparison.target,
          diferenca: comparison.difference,
          analiseHumana: comRessalva
            ? `${ressalvas.map((item) => item.explicacao).join(' ')} ${spec.analiseHumana}`
            : spec.analiseHumana,
          evidencias: [
            keyEvidence(trace, pair.xml, pair.key),
            scopeEvidence(trace, pair.scope),
            trace.money(spec.originLabel, spec.xmlOrigin, comparison.origin, {
              source: pair.xml.source,
              from: pair.xml.origin,
              field: spec.xmlField,
            }),
            trace.money(spec.targetLabel, spec.efdOrigin, comparison.target, {
              source: 'EFD_ICMS_IPI',
              from: pair.efd.origin,
              field: spec.efdField,
            }),
            trace.evidence('Tolerância aplicada', 'Configuração da regra nesta organização', comparison.toleranceLabel),
            ...caveatEvidences(trace, pair.ressalvas),
          ],
        });
      }

      if (foraDeEscopo.length > 0) {
        findings.push(
          aggregate({
            resultado: 'NAO_APLICAVEL',
            natureza: 'FATO',
            titulo: `${spec.codigo}: documentos fora do escopo da comparação`,
            descricao:
              `${foraDeEscopo.length} documento(s) pareados não foram comparados. ${spec.motivoEscopoExcluido}`,
            analiseHumana:
              'A comparação não foi executada para estes documentos porque o critério da regra não é válido para ' +
              'eles. Isso não significa conformidade: se a conferência for necessária, ela precisa ser feita à luz ' +
              'do tratamento tributário aplicável a cada operação.',
            documentos: foraDeEscopo.map((pair) => pair.xml),
            evidencias: [
              trace.evidence(
                'Escopos comparados por esta regra',
                'Definição da regra',
                spec.escoposComparaveis.map((scope) => FISCAL_SCOPE_LABELS[scope]).join(', '),
              ),
            ],
            trace,
          }),
        );
      }

      return { cruzamentosCorretos: correct, findings: truncate(findings, spec.codigo, trace) };
    },
  };
}

const ESCOPO_TODOS: readonly FiscalScope[] = ['SAIDA_PROPRIA', 'ENTRADA_TERCEIRO', 'INDEFINIDO'];
const ESCOPO_SAIDA: readonly FiscalScope[] = ['SAIDA_PROPRIA'];

export const attFis003 = valueComparisonRule({
  id: 'att-fis-003',
  codigo: 'ATT-FIS-003',
  versao: '2.0.0',
  nome: 'Valor total do documento divergente entre XML e EFD',
  descricao: 'Compara o valor total do documento no XML com o campo VL_DOC do registro C100.',
  gravidade: 'ALTA',
  limitacoes:
    'A diferença é um fato aritmético. Documentos complementares, de ajuste e de devolução são comparados, porém a ' +
    'diferença é apresentada como indício, com o campo que justifica a ressalva.',
  originLabel: 'Valor total no XML',
  targetLabel: 'Valor escriturado (VL_DOC)',
  xmlOrigin: 'Total do documento declarado no XML',
  xmlField: 'total/ICMSTot/vNF',
  efdOrigin: 'Valor total do documento escriturado no registro C100',
  efdField: 'VL_DOC',
  pick: (invoice) => invoice.totals.total,
  analiseHumana:
    'Verifique se há documento complementar, ajuste posterior ou escrituração parcial antes de concluir por erro.',
  // O total do documento não muda conforme quem escritura: é comparável nos
  // dois sentidos da operação.
  escoposComparaveis: ESCOPO_TODOS,
  motivoEscopoExcluido: '',
});

export const attFis004 = valueComparisonRule({
  id: 'att-fis-004',
  codigo: 'ATT-FIS-004',
  versao: '2.0.0',
  nome: 'Base de cálculo do ICMS divergente entre XML e EFD',
  descricao:
    'Compara a base de cálculo do ICMS do XML com o campo VL_BC_ICMS do registro C100, nas saídas próprias.',
  gravidade: 'ALTA',
  limitacoes:
    'Redução de base de cálculo, diferimento e operações com tratamento específico alteram a base escriturada sem ' +
    'que isso configure erro. A regra afirma apenas a diferença numérica, e apenas nas saídas próprias: na entrada, ' +
    'o declarante escritura a base segundo o crédito a que tem direito, não segundo o destaque do emitente.',
  originLabel: 'Base de ICMS no XML',
  targetLabel: 'Base de ICMS escriturada (VL_BC_ICMS)',
  xmlOrigin: 'Base de cálculo do ICMS declarada no XML',
  xmlField: 'total/ICMSTot/vBC',
  efdOrigin: 'Base de cálculo do ICMS escriturada no registro C100',
  efdField: 'VL_BC_ICMS',
  pick: (invoice) => invoice.totals.baseIcms,
  analiseHumana:
    'Avalie o tratamento tributário aplicado à operação antes de concluir por erro de escrituração.',
  escoposComparaveis: ESCOPO_SAIDA,
  motivoEscopoExcluido:
    'Nas entradas, o destinatário escritura a base de cálculo conforme o direito ao crédito do imposto, que pode ser ' +
    'legitimamente diferente do valor destacado pelo emitente — em operações sem direito a crédito, inclusive zero. ' +
    'Comparar o destaque com o escriturado produziria divergência onde não há erro.',
});

export const attFis005 = valueComparisonRule({
  id: 'att-fis-005',
  codigo: 'ATT-FIS-005',
  versao: '2.0.0',
  nome: 'Valor do ICMS divergente entre XML e EFD',
  descricao: 'Compara o valor do ICMS do XML com o campo VL_ICMS do registro C100, nas saídas próprias.',
  gravidade: 'ALTA',
  limitacoes:
    'A diferença é um fato aritmético e não determina, por si só, insuficiência de recolhimento: a apuração do ' +
    'período considera créditos, ajustes e estornos registrados no bloco E. Nas entradas a comparação não é ' +
    'executada, porque o valor escriturado é o crédito apropriado, não o imposto destacado.',
  originLabel: 'ICMS no XML',
  targetLabel: 'ICMS escriturado (VL_ICMS)',
  xmlOrigin: 'Valor do ICMS declarado no XML',
  xmlField: 'total/ICMSTot/vICMS',
  efdOrigin: 'Valor do ICMS escriturado no registro C100',
  efdField: 'VL_ICMS',
  pick: (invoice) => invoice.totals.icms,
  analiseHumana:
    'Compare com o bloco E (apuração) antes de concluir por diferença de imposto devido.',
  escoposComparaveis: ESCOPO_SAIDA,
  motivoEscopoExcluido:
    'Nas entradas, o campo VL_ICMS do C100 registra o crédito apropriado pelo destinatário, que pode ser inferior ao ' +
    'destaque do documento ou nulo, conforme o direito ao crédito. A comparação direta com o XML não é conclusiva.',
});

// -----------------------------------------------------------------------------
// ATT-FIS-006
// -----------------------------------------------------------------------------

export const attFis006: AuditRule = {
  id: 'att-fis-006',
  codigo: 'ATT-FIS-006',
  versao: '2.0.0',
  nome: 'CFOP divergente entre XML e EFD',
  descricao:
    'Compara o CFOP predominante do documento no XML com o CFOP predominante escriturado nos registros C170/C190, ' +
    'nas saídas próprias.',
  modulo: 'FISCAL',
  gravidade: 'MEDIA',
  documentosNecessarios: [...REQUIRED],
  toleranciaPadrao: DEFAULT_TOLERANCE,
  limitacoes:
    'Documentos com vários CFOPs são comparados pelo CFOP de maior valor; a divergência indica que a classificação ' +
    'no XML e na escrituração não coincide, o que exige verificação do documento completo. A regra não compara ' +
    'entradas: o CFOP é declarado sob a ótica de cada declarante, e o código de saída do emitente (5xxx/6xxx) nunca ' +
    'coincide com o código de entrada do destinatário (1xxx/2xxx).',
  executar(context) {
    const blocked = notVerified(context, 'ATT-FIS-006');
    if (blocked) return blocked;

    const trace = tracer(context.dataset);
    const recon = reconcile(context.dataset);

    const findings: RuleFinding[] = [];
    const foraDeEscopo: DocumentPair[] = [];
    const semCfop: DocumentPair[] = [];
    let correct = 0;

    for (const pair of recon.pairs) {
      if (pair.scope !== 'SAIDA_PROPRIA') {
        foraDeEscopo.push(pair);
        continue;
      }

      const xmlCfop = pair.xml.cfopPrincipal;
      const efdCfop = pair.efd.cfopPrincipal;
      if (xmlCfop === null || efdCfop === null) {
        semCfop.push(pair);
        continue;
      }
      if (xmlCfop === efdCfop) {
        correct += 1;
        continue;
      }

      const ressalvas = blockingCaveats(pair);
      const comRessalva = ressalvas.length > 0;

      findings.push({
        resultado: comRessalva ? 'ALERTA' : 'DIVERGENCIA',
        natureza: comRessalva ? 'INDICIO' : 'FATO',
        titulo: `CFOP divergente — ${describeInvoice(pair.xml)}`,
        descricao: `CFOP predominante no XML: ${xmlCfop}. CFOP predominante na EFD: ${efdCfop}.`,
        documento: invoiceReference(pair.xml),
        rotuloOrigem: 'CFOP no XML',
        rotuloDestino: 'CFOP na EFD',
        analiseHumana:
          'Documentos com múltiplos CFOPs podem apresentar predominância diferente entre origem e escrituração sem ' +
          'que haja erro. Confira os itens do documento.',
        evidencias: [
          keyEvidence(trace, pair.xml, pair.key),
          scopeEvidence(trace, pair.scope),
          trace.evidence(
            'CFOP predominante no XML',
            'CFOP de maior valor entre os itens do XML',
            xmlCfop,
            { source: pair.xml.source, from: pair.xml.origin, field: 'det/prod/CFOP' },
          ),
          trace.evidence(
            'CFOPs no XML',
            'Todos os CFOPs declarados nos itens do XML',
            pair.xml.cfops.join(', ') || null,
            { source: pair.xml.source, from: pair.xml.origin, field: 'det/prod/CFOP' },
          ),
          trace.evidence(
            'CFOP predominante na EFD',
            'CFOP de maior valor entre os registros analíticos do documento',
            efdCfop,
            { source: 'EFD_ICMS_IPI', from: pair.efd.origin, field: 'CFOP' },
          ),
          trace.evidence(
            'CFOPs na EFD',
            'Todos os CFOPs escriturados nos registros C170/C190 do documento',
            pair.efd.cfops.join(', ') || null,
            { source: 'EFD_ICMS_IPI', from: pair.efd.origin, field: 'CFOP' },
          ),
          trace.evidence(
            'Tolerância',
            'A comparação é de código, não de valor: nenhuma tolerância se aplica',
            'Não aplicável',
          ),
          ...caveatEvidences(trace, pair.ressalvas),
        ],
      });
    }

    if (semCfop.length > 0) {
      findings.push(
        aggregate({
          resultado: 'NAO_VERIFICADO',
          natureza: 'FATO',
          titulo: 'ATT-FIS-006: documentos sem CFOP em um dos lados',
          descricao:
            `${semCfop.length} documento(s) pareados não puderam ser comparados porque o CFOP predominante não pôde ` +
            'ser determinado no XML, na escrituração, ou em ambos.',
          analiseHumana:
            'Sem CFOP em um dos lados não há o que comparar. Verifique se o XML traz o CFOP dos itens e se o ' +
            'documento possui registros C170 ou C190 na escrituração.',
          documentos: semCfop.map((pair) => pair.xml),
          evidencias: [
            trace.evidence(
              'Campos conferidos',
              'CFOP dos itens do XML e dos registros C170/C190 da EFD',
              'ausente em ao menos um dos lados',
              { field: 'CFOP' },
            ),
          ],
          trace,
        }),
      );
    }

    if (foraDeEscopo.length > 0) {
      findings.push(
        aggregate({
          resultado: 'NAO_APLICAVEL',
          natureza: 'FATO',
          titulo: 'ATT-FIS-006: documentos fora do escopo da comparação',
          descricao:
            `${foraDeEscopo.length} documento(s) pareados não foram comparados. O CFOP é declarado sob a ótica de ` +
            'cada declarante: o emitente classifica a operação como saída (5xxx/6xxx/7xxx) e o destinatário a ' +
            'escritura como entrada (1xxx/2xxx/3xxx). Confrontar os dois códigos acusaria divergência em todas as ' +
            'entradas, sem que houvesse erro.',
          analiseHumana:
            'A conferência do CFOP de entrada depende da correlação entre a operação do emitente e a natureza da ' +
            'entrada no destinatário, que não é parametrizada no sistema e exige análise de profissional habilitado.',
          documentos: foraDeEscopo.map((pair) => pair.xml),
          evidencias: [
            trace.evidence(
              'Escopo comparado por esta regra',
              'Definição da regra',
              FISCAL_SCOPE_LABELS.SAIDA_PROPRIA,
            ),
          ],
          trace,
        }),
      );
    }

    return { cruzamentosCorretos: correct, findings: truncate(findings, 'ATT-FIS-006', trace) };
  },
};

// -----------------------------------------------------------------------------
// ATT-FIS-007
// -----------------------------------------------------------------------------

export const attFis007: AuditRule = {
  id: 'att-fis-007',
  codigo: 'ATT-FIS-007',
  versao: '2.0.0',
  nome: 'Quantidade de documentos divergente entre XML e EFD',
  descricao:
    'Compara a quantidade de documentos com efeito fiscal presentes no XML com a quantidade escriturada na EFD ICMS/IPI.',
  modulo: 'FISCAL',
  gravidade: 'MEDIA',
  documentosNecessarios: [...REQUIRED],
  toleranciaPadrao: { absoluteTolerance: 0 as Cents, percentageTolerance: 0 },
  limitacoes:
    'A EFD escritura documentos próprios e de terceiros; o conjunto de XML entregue para auditoria pode ser apenas ' +
    'parcial. A regra afirma a diferença de contagem, não a sua causa.',
  executar(context) {
    const blocked = notVerified(context, 'ATT-FIS-007');
    if (blocked) return blocked;

    const trace = tracer(context.dataset);
    const recon: Reconciliation = reconcile(context.dataset);
    const { xmlConsiderados, efdConsiderados } = recon.totals;

    if (xmlConsiderados === efdConsiderados) {
      return { cruzamentosCorretos: 1, findings: [] };
    }

    return {
      cruzamentosCorretos: 0,
      findings: [
        {
          resultado: 'ALERTA',
          natureza: 'FATO',
          titulo: 'Quantidade de documentos diferente entre XML e EFD ICMS/IPI',
          descricao:
            `XML importados com efeito fiscal: ${xmlConsiderados}. Documentos escriturados na EFD: ${efdConsiderados}. ` +
            `Diferença de ${Math.abs(xmlConsiderados - efdConsiderados)} documento(s).`,
          rotuloOrigem: 'Documentos no XML',
          rotuloDestino: 'Documentos na EFD',
          analiseHumana:
            'A diferença é esperada quando o conjunto de XML entregue cobre apenas as saídas próprias, enquanto a EFD ' +
            'escritura também as entradas. Avalie o escopo dos arquivos importados.',
          evidencias: [
            trace.evidence(
              'Documentos no XML',
              'Contagem de XML importados com situação ativa',
              String(xmlConsiderados),
              { source: 'XML_NFE' },
            ),
            trace.evidence(
              'Documentos na EFD',
              'Contagem de registros C100 com situação ativa',
              String(efdConsiderados),
              { source: 'EFD_ICMS_IPI', field: 'COD_SIT' },
            ),
            trace.evidence(
              'Documentos pareados por chave',
              'Documentos presentes nas duas fontes',
              String(recon.pairs.length),
            ),
          ],
        },
      ],
    };
  },
};

export const FISCAL_RULES: readonly AuditRule[] = [
  attFis001,
  attFis002,
  attFis003,
  attFis004,
  attFis005,
  attFis006,
  attFis007,
];
