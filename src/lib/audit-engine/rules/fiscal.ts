/**
 * Rules ATT-FIS-*: cross-checks between the issued documents (XML) and the
 * documents as booked in the EFD ICMS/IPI.
 *
 * All of them state arithmetic facts. Whether a fact is an actual error depends
 * on the nature of the operation and is left to the auditor: each finding
 * carries an explicit `analiseHumana` note saying what the system can and
 * cannot conclude (requirement 35).
 */

import { formatBRL, type Cents } from '@/lib/core/money';
import { formatIsoDate } from '@/lib/core/dates';
import type { Invoice } from '@/lib/domain/model';
import { compareValues } from '../tolerance';
import { DEFAULT_TOLERANCE, type AuditRule, type RuleContext, type RuleFinding, type RuleResult } from '../types';
import { xmlInvoices, invoicesFrom } from '@/lib/normalization/dataset';
import {
  MAX_INDIVIDUAL_FINDINGS,
  byAccessKey,
  describeInvoice,
  evidence,
  invoiceReference,
  isEffective,
  missingSources,
  moneyEvidence,
} from './helpers';

const REQUIRED = ['XML_NFE', 'EFD_ICMS_IPI'] as const;

function notVerified(context: RuleContext, codigo: string): RuleResult | null {
  const missing = missingSources(context.dataset, ['EFD_ICMS_IPI']);
  const hasXml =
    context.dataset.availableSources.has('XML_NFE') || context.dataset.availableSources.has('XML_NFCE');
  if (missing.length === 0 && hasXml) return null;

  const absent = [...missing, ...(hasXml ? [] : ['XML de NF-e/NFC-e'])];
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

/** Pairs of (XML document, EFD document) matched by access key. */
interface MatchedPair {
  readonly key: string;
  readonly xml: Invoice;
  readonly efd: Invoice;
}

function matchByKey(context: RuleContext): {
  pairs: MatchedPair[];
  xmlOnly: Invoice[];
  efdOnly: Invoice[];
  xmlWithoutKey: Invoice[];
} {
  const xml = xmlInvoices(context.dataset).filter(isEffective);
  const efd = invoicesFrom(context.dataset, 'EFD_ICMS_IPI').filter(isEffective);

  const efdIndex = byAccessKey(efd);
  const xmlIndex = byAccessKey(xml);

  const pairs: MatchedPair[] = [];
  const xmlOnly: Invoice[] = [];
  const xmlWithoutKey: Invoice[] = [];

  for (const invoice of xml) {
    if (!invoice.accessKey) {
      xmlWithoutKey.push(invoice);
      continue;
    }
    const counterpart = efdIndex.get(invoice.accessKey);
    if (counterpart) pairs.push({ key: invoice.accessKey, xml: invoice, efd: counterpart });
    else xmlOnly.push(invoice);
  }

  const efdOnly = efd.filter((invoice) => invoice.accessKey && !xmlIndex.has(invoice.accessKey));

  return { pairs, xmlOnly, efdOnly, xmlWithoutKey };
}

function truncate(findings: RuleFinding[], codigo: string, total: number): RuleFinding[] {
  if (findings.length <= MAX_INDIVIDUAL_FINDINGS) return findings;
  const kept = findings.slice(0, MAX_INDIVIDUAL_FINDINGS);
  kept.push({
    resultado: 'ALERTA',
    natureza: 'FATO',
    titulo: `${codigo}: ocorrências adicionais não detalhadas`,
    descricao:
      `Foram encontradas ${total} ocorrências. As primeiras ${MAX_INDIVIDUAL_FINDINGS} estão detalhadas ` +
      'individualmente; as demais foram agrupadas nesta ocorrência para manter o relatório legível.',
    evidencias: [
      evidence('Total de ocorrências', 'Contagem apurada pela regra', String(total)),
      evidence('Detalhadas', 'Limite de detalhamento da regra', String(MAX_INDIVIDUAL_FINDINGS)),
    ],
  });
  return kept;
}

export const attFis001: AuditRule = {
  id: 'att-fis-001',
  codigo: 'ATT-FIS-001',
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
    'estabelecimento e do período, e exige análise humana.',
  executar(context) {
    const blocked = notVerified(context, 'ATT-FIS-001');
    if (blocked) return blocked;

    const { pairs, xmlOnly, xmlWithoutKey } = matchByKey(context);
    const findings: RuleFinding[] = xmlOnly.map((invoice) => ({
      resultado: 'DIVERGENCIA',
      natureza: 'FATO',
      titulo: `Documento ${describeInvoice(invoice)} não localizado na EFD ICMS/IPI`,
      descricao:
        `A chave de acesso ${invoice.accessKey} consta no XML importado e não foi encontrada em nenhum registro ` +
        'C100 do arquivo da EFD ICMS/IPI desta competência.',
      documento: invoiceReference(invoice),
      rotuloOrigem: 'Valor total do XML',
      valorOrigem: invoice.totalValue,
      rotuloDestino: 'EFD ICMS/IPI',
      valorDestino: null,
      diferenca: invoice.totalValue,
      analiseHumana:
        'Verifique se a operação deve constar nesta EFD: documentos de outro estabelecimento, de outra competência ' +
        'ou com tratamento específico podem legitimamente não estar escriturados neste arquivo.',
      evidencias: [
        evidence('Chave de acesso', 'Elemento infNFe/@Id do XML', invoice.accessKey, {
          source: invoice.source,
          fileName: invoice.fileName,
        }),
        evidence('Emissao', 'Elemento ide/dhEmi do XML', formatIsoDate(invoice.issueDate), {
          source: invoice.source,
          fileName: invoice.fileName,
        }),
        moneyEvidence('Valor total', 'Elemento total/ICMSTot/vNF do XML', invoice.totalValue, {
          source: invoice.source,
          fileName: invoice.fileName,
        }),
        evidence(
          'Busca na EFD',
          'Comparacao com o campo CHV_NFE de todos os registros C100 do arquivo',
          'Chave não encontrada',
          { source: 'EFD_ICMS_IPI' },
        ),
      ],
    }));

    if (xmlWithoutKey.length > 0) {
      findings.push({
        resultado: 'ALERTA',
        natureza: 'FATO',
        gravidade: 'BAIXA',
        titulo: 'Documentos XML sem chave de acesso legível',
        descricao:
          `${xmlWithoutKey.length} documento(s) do XML não possuem chave de acesso legível e por isso ficaram fora ` +
          'do cruzamento por chave.',
        evidencias: [
          evidence('Quantidade', 'Contagem apurada pela regra', String(xmlWithoutKey.length)),
        ],
      });
    }

    return {
      cruzamentosCorretos: pairs.length,
      findings: truncate(findings, 'ATT-FIS-001', xmlOnly.length),
    };
  },
};

export const attFis002: AuditRule = {
  id: 'att-fis-002',
  codigo: 'ATT-FIS-002',
  nome: 'Documento escriturado na EFD ICMS/IPI sem XML correspondente',
  descricao:
    'Localiza registros C100 com chave de acesso que não possuem XML correspondente entre os arquivos importados.',
  modulo: 'FISCAL',
  gravidade: 'MEDIA',
  documentosNecessarios: [...REQUIRED],
  toleranciaPadrao: DEFAULT_TOLERANCE,
  limitacoes:
    'A ausência do XML pode significar apenas que o arquivo não foi entregue para auditoria, e não que o documento ' +
    'seja indevido. A regra atesta a ausência do arquivo de origem, não a inexistencia do documento.',
  executar(context) {
    const blocked = notVerified(context, 'ATT-FIS-002');
    if (blocked) return blocked;

    const { pairs, efdOnly } = matchByKey(context);
    const findings: RuleFinding[] = efdOnly.map((invoice) => ({
      resultado: 'DIVERGENCIA',
      natureza: 'FATO',
      titulo: `Documento ${describeInvoice(invoice)} escriturado sem XML de origem`,
      descricao:
        `A chave de acesso ${invoice.accessKey} consta no registro C100 da EFD ICMS/IPI e não foi encontrada entre ` +
        'os XML importados nesta auditoria.',
      documento: invoiceReference(invoice),
      rotuloOrigem: 'EFD ICMS/IPI',
      valorOrigem: invoice.totalValue,
      rotuloDestino: 'XML',
      valorDestino: null,
      diferenca: invoice.totalValue,
      analiseHumana:
        'Confirme se o XML simplesmente não foi entregue para a auditoria antes de tratar a ocorrência como erro de ' +
        'escrituracao.',
      evidencias: [
        evidence('Chave de acesso', 'Campo CHV_NFE do registro C100', invoice.accessKey, {
          source: 'EFD_ICMS_IPI',
          fileName: invoice.fileName,
        }),
        moneyEvidence('Valor do documento', 'Campo VL_DOC do registro C100', invoice.totalValue, {
          source: 'EFD_ICMS_IPI',
          fileName: invoice.fileName,
        }),
        evidence(
          'Busca nos XML',
          'Comparacao com a chave de acesso de todos os XML importados',
          'Chave não encontrada',
          { source: 'XML_NFE' },
        ),
      ],
    }));

    return {
      cruzamentosCorretos: pairs.length,
      findings: truncate(findings, 'ATT-FIS-002', efdOnly.length),
    };
  },
};

/** Factory for the value-comparison rules ATT-FIS-003 to ATT-FIS-005. */
function valueComparisonRule(spec: {
  id: string;
  codigo: string;
  nome: string;
  descricao: string;
  gravidade: AuditRule['gravidade'];
  limitacoes: string;
  originLabel: string;
  targetLabel: string;
  xmlEvidence: string;
  efdEvidence: string;
  pick: (invoice: Invoice) => Cents;
  analiseHumana: string;
}): AuditRule {
  return {
    id: spec.id,
    codigo: spec.codigo,
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

      const { pairs } = matchByKey(context);
      const findings: RuleFinding[] = [];
      let correct = 0;

      for (const pair of pairs) {
        const comparison = compareValues(spec.pick(pair.xml), spec.pick(pair.efd), context.config.tolerancia);
        if (comparison.withinTolerance) {
          correct += 1;
          continue;
        }
        findings.push({
          resultado: 'DIVERGENCIA',
          natureza: 'FATO',
          titulo: `${spec.nome} — ${describeInvoice(pair.xml)}`,
          descricao:
            `${spec.originLabel}: ${formatBRL(comparison.origin)}. ${spec.targetLabel}: ${formatBRL(comparison.target)}. ` +
            `Diferença de ${formatBRL(comparison.difference)}. ${comparison.toleranceLabel}`,
          documento: invoiceReference(pair.xml),
          rotuloOrigem: spec.originLabel,
          valorOrigem: comparison.origin,
          rotuloDestino: spec.targetLabel,
          valorDestino: comparison.target,
          diferenca: comparison.difference,
          analiseHumana: spec.analiseHumana,
          evidencias: [
            evidence('Chave de acesso', 'Chave utilizada para parear os documentos', pair.key),
            moneyEvidence(spec.originLabel, spec.xmlEvidence, comparison.origin, {
              source: pair.xml.source,
              fileName: pair.xml.fileName,
            }),
            moneyEvidence(spec.targetLabel, spec.efdEvidence, comparison.target, {
              source: 'EFD_ICMS_IPI',
              fileName: pair.efd.fileName,
            }),
            evidence('Tolerância', 'Configuração da regra', comparison.toleranceLabel),
          ],
        });
      }

      return { cruzamentosCorretos: correct, findings: truncate(findings, spec.codigo, findings.length) };
    },
  };
}

export const attFis003 = valueComparisonRule({
  id: 'att-fis-003',
  codigo: 'ATT-FIS-003',
  nome: 'Valor total do documento divergente entre XML e EFD',
  descricao: 'Compara o valor total do documento no XML com o campo VL_DOC do registro C100.',
  gravidade: 'ALTA',
  limitacoes:
    'A diferença e um fato aritmético. Documentos complementares, ajustes e escrituração extemporanea podem produzir ' +
    'diferenças legitimas e devem ser avaliados individualmente.',
  originLabel: 'Valor total no XML',
  targetLabel: 'Valor escriturado (VL_DOC)',
  xmlEvidence: 'Elemento total/ICMSTot/vNF do XML',
  efdEvidence: 'Campo VL_DOC do registro C100',
  pick: (invoice) => invoice.totals.total,
  analiseHumana:
    'Verifique se ha documento complementar, ajuste posterior ou escrituração parcial antes de concluir por erro.',
});

export const attFis004 = valueComparisonRule({
  id: 'att-fis-004',
  codigo: 'ATT-FIS-004',
  nome: 'Base de cálculo do ICMS divergente entre XML e EFD',
  descricao: 'Compara a base de cálculo do ICMS do XML com o campo VL_BC_ICMS do registro C100.',
  gravidade: 'ALTA',
  limitacoes:
    'Reducao de base de cálculo, diferimento e operações com tratamento específico alteram a base escriturada sem ' +
    'que isso configure erro. A regra afirma apenas a diferença numérica.',
  originLabel: 'Base de ICMS no XML',
  targetLabel: 'Base de ICMS escriturada (VL_BC_ICMS)',
  xmlEvidence: 'Elemento total/ICMSTot/vBC do XML',
  efdEvidence: 'Campo VL_BC_ICMS do registro C100',
  pick: (invoice) => invoice.totals.baseIcms,
  analiseHumana:
    'Avalie o tratamento tributário aplicado a operação antes de concluir por erro de escrituração.',
});

export const attFis005 = valueComparisonRule({
  id: 'att-fis-005',
  codigo: 'ATT-FIS-005',
  nome: 'Valor do ICMS divergente entre XML e EFD',
  descricao: 'Compara o valor do ICMS do XML com o campo VL_ICMS do registro C100.',
  gravidade: 'ALTA',
  limitacoes:
    'A diferença é um fato aritmético e não determina, por si só, insuficiência de recolhimento: a apuração do ' +
    'período considera créditos, ajustes e estornos registrados no bloco E.',
  originLabel: 'ICMS no XML',
  targetLabel: 'ICMS escriturado (VL_ICMS)',
  xmlEvidence: 'Elemento total/ICMSTot/vICMS do XML',
  efdEvidence: 'Campo VL_ICMS do registro C100',
  pick: (invoice) => invoice.totals.icms,
  analiseHumana:
    'Compare com o bloco E (apuração) antes de concluir por diferença de imposto devido.',
});

export const attFis006: AuditRule = {
  id: 'att-fis-006',
  codigo: 'ATT-FIS-006',
  nome: 'CFOP divergente entre XML e EFD',
  descricao:
    'Compara o CFOP predominante do documento no XML com o CFOP predominante escriturado nos registros C170/C190.',
  modulo: 'FISCAL',
  gravidade: 'MEDIA',
  documentosNecessarios: [...REQUIRED],
  toleranciaPadrao: DEFAULT_TOLERANCE,
  limitacoes:
    'Documentos com varios CFOPs são comparados pelo CFOP de maior valor. A divergência indica que a classificação ' +
    'da operação no XML e na escrituração não coincide, o que exige verificação do documento completo.',
  executar(context) {
    const blocked = notVerified(context, 'ATT-FIS-006');
    if (blocked) return blocked;

    const { pairs } = matchByKey(context);
    const findings: RuleFinding[] = [];
    let correct = 0;

    for (const pair of pairs) {
      const xmlCfop = pair.xml.cfopPrincipal;
      const efdCfop = pair.efd.cfopPrincipal;
      if (xmlCfop === null || efdCfop === null) continue;
      if (xmlCfop === efdCfop) {
        correct += 1;
        continue;
      }
      findings.push({
        resultado: 'DIVERGENCIA',
        natureza: 'FATO',
        titulo: `CFOP divergente — ${describeInvoice(pair.xml)}`,
        descricao: `CFOP predominante no XML: ${xmlCfop}. CFOP predominante na EFD: ${efdCfop}.`,
        documento: invoiceReference(pair.xml),
        rotuloOrigem: 'CFOP no XML',
        rotuloDestino: 'CFOP na EFD',
        analiseHumana:
          'Documentos com múltiplos CFOPs podem apresentar predominancia diferente entre origem e escrituração sem ' +
          'que haja erro. Confira os itens do documento.',
        evidencias: [
          evidence('Chave de acesso', 'Chave utilizada para parear os documentos', pair.key),
          evidence('CFOPs no XML', 'Elemento det/prod/CFOP de cada item', pair.xml.cfops.join(', ') || null, {
            source: pair.xml.source,
            fileName: pair.xml.fileName,
          }),
          evidence('CFOPs na EFD', 'Campo CFOP dos registros C170/C190', pair.efd.cfops.join(', ') || null, {
            source: 'EFD_ICMS_IPI',
            fileName: pair.efd.fileName,
          }),
        ],
      });
    }

    return { cruzamentosCorretos: correct, findings: truncate(findings, 'ATT-FIS-006', findings.length) };
  },
};

export const attFis007: AuditRule = {
  id: 'att-fis-007',
  codigo: 'ATT-FIS-007',
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

    const xml = xmlInvoices(context.dataset).filter(isEffective);
    const efd = invoicesFrom(context.dataset, 'EFD_ICMS_IPI').filter(isEffective);

    if (xml.length === efd.length) {
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
            `XML importados com efeito fiscal: ${xml.length}. Documentos escriturados na EFD: ${efd.length}. ` +
            `Diferença de ${Math.abs(xml.length - efd.length)} documento(s).`,
          rotuloOrigem: 'Documentos no XML',
          rotuloDestino: 'Documentos na EFD',
          analiseHumana:
            'A diferença e esperada quando o conjunto de XML entregue cobre apenas as saídas próprias, enquanto a EFD ' +
            'escritura também as entradas. Avalie o escopo dos arquivos importados.',
          evidencias: [
            evidence('Documentos no XML', 'Contagem de XML importados com situação ativa', String(xml.length), {
              source: 'XML_NFE',
            }),
            evidence('Documentos na EFD', 'Contagem de registros C100 com situação ativa', String(efd.length), {
              source: 'EFD_ICMS_IPI',
            }),
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
