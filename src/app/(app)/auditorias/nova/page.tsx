import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { makeCompetencia } from '@/lib/core/competencia';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { NewAuditForm } from './new-audit-form';

export const metadata: Metadata = { title: 'Nova auditoria' };
export const dynamic = 'force-dynamic';

/** Defaults to the previous month, the period normally being audited. */
function previousCompetencia(): string {
  const now = new Date();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  const competencia = month === 0 ? makeCompetencia(year - 1, 12) : makeCompetencia(year, month);
  const [yyyy, mm] = competencia.split('-');
  return `${mm}/${yyyy}`;
}

export default async function NewAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const { empresa } = await searchParams;
  const companies = await getStore().listCompanies();

  return (
    <>
      <PageHeader
        eyebrow="Execução"
        title="Nova auditoria"
        description="Selecione a empresa e a competência. Em seguida você importa os arquivos e inicia o processamento."
        actions={
          <LinkButton href="/auditorias" variant="secondary">
            Voltar
          </LinkButton>
        }
      />

      {companies.length === 0 ? (
        <EmptyState
          title="Nenhuma empresa cadastrada"
          description="A auditoria é sempre vinculada a uma empresa, para impedir que arquivos de contribuintes diferentes sejam misturados."
          action={
            <LinkButton href="/empresas/nova" variant="gold">
              Cadastrar empresa
            </LinkButton>
          }
        />
      ) : (
        <Card className="max-w-3xl">
          <CardHeader title="Identificação da auditoria" />
          <CardBody>
            <NewAuditForm
              companies={companies.map((company) => ({
                id: company.id,
                legalName: company.legalName,
                cnpj: company.cnpj,
              }))}
              defaultCompanyId={empresa ?? ''}
              defaultCompetencia={previousCompetencia()}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
