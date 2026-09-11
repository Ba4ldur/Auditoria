import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { formatIsoDateTime } from '@/lib/core/dates';
import { CFOP_TREATMENT_LABELS } from '@/lib/domain/entities';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Notice, PageHeader } from '@/components/ui/page';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';
import { CfopRuleForm } from './cfop-form';
import { deleteCfopRuleAction } from './actions';

export const metadata: Metadata = { title: 'Política de Receita' };
export const dynamic = 'force-dynamic';

const TREATMENT_TONES = {
  INCLUIR: 'success',
  EXCLUIR: 'neutral',
  REVISAR: 'warning',
} as const;

export default async function RevenuePolicyPage() {
  const rules = await getStore().listCfopRules();
  const demonstration = rules.filter((rule) => rule.ruleSource === 'DEMONSTRACAO');

  return (
    <>
      <PageHeader
        eyebrow="Configurações"
        title="Política de Receita"
        description="Define, por CFOP, quais operações compõem a receita apurada a partir dos documentos fiscais."
        actions={
          <LinkButton href="/configuracoes" variant="secondary">
            Voltar
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <Notice tone="info" title="O sistema não define tratamento tributário">
          <p>
            Um CFOP sem classificação permanece em <strong>revisão</strong>: os documentos aparecem com o
            valor, separados do faturamento considerado, e as regras de faturamento não são executadas até
            que a decisão seja registrada aqui. Isso evita que um cruzamento conclua algo a partir de uma
            suposição do sistema.
          </p>
        </Notice>

        {demonstration.length > 0 ? (
          <Notice tone="warning" title="Regras de demonstração carregadas">
            {demonstration.length} CFOP(s) foram classificados pela base de demonstração e estão marcados
            como tal. Servem apenas para exercitar a interface — revise ou remova antes de usar com dados
            reais.
          </Notice>
        ) : null}
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Classificar CFOP"
          description="Informar novamente um CFOP já classificado substitui a regra existente."
        />
        <CardBody>
          <CfopRuleForm />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`CFOPs classificados (${rules.length})`} />
        <TableWrapper>
          <thead>
            <tr>
              <Th>CFOP</Th>
              <Th>Descrição</Th>
              <Th>Tratamento</Th>
              <Th>Motivo</Th>
              <Th>Última alteração</Th>
              <Th align="center">Ações</Th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <EmptyRow colSpan={6}>
                Nenhum CFOP classificado. Enquanto a política estiver vazia, todos os documentos de saída
                ficam em revisão e as regras de faturamento reportam NÃO VERIFICADO.
              </EmptyRow>
            ) : (
              rules.map((rule) => (
                <Tr key={rule.id}>
                  <Td className="font-mono text-xs">{rule.cfop}</Td>
                  <Td className="text-xs text-ink-muted">{rule.description ?? '—'}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={TREATMENT_TONES[rule.treatment]}>
                        {CFOP_TREATMENT_LABELS[rule.treatment]}
                      </Badge>
                      {rule.ruleSource === 'DEMONSTRACAO' ? (
                        <Badge tone="warning">Demonstração</Badge>
                      ) : null}
                    </div>
                  </Td>
                  <Td className="max-w-sm text-xs text-ink-muted">{rule.reason ?? '—'}</Td>
                  <Td className="text-xs text-ink-muted">
                    {formatIsoDateTime(rule.updatedAt)}
                    {rule.updatedBy ? <span className="block">por {rule.updatedBy}</span> : null}
                  </Td>
                  <Td align="center">
                    <form action={deleteCfopRuleAction}>
                      <input type="hidden" name="cfop" value={rule.cfop} />
                      <button
                        type="submit"
                        className="rounded-md px-2 py-1 text-xs text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger"
                      >
                        Remover
                      </button>
                    </form>
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </TableWrapper>
      </Card>
    </>
  );
}
