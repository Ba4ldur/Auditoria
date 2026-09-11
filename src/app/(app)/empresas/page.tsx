import Link from 'next/link';
import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { formatCnpj } from '@/lib/core/cnpj';
import { TAX_REGIME_LABELS } from '@/lib/domain/model';
import { LinkButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Empresas' };
export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const store = getStore();
  const companies = await store.listCompanies();
  const audits = await store.listAudits();

  const auditCount = new Map<string, number>();
  for (const audit of audits) {
    auditCount.set(audit.companyId, (auditCount.get(audit.companyId) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        eyebrow="Cadastro"
        title="Empresas"
        description="Empresas auditadas pela organização. Todo arquivo importado e conferido contra o CNPJ cadastrado aqui."
        actions={
          <LinkButton href="/empresas/nova" variant="gold">
            Cadastrar empresa
          </LinkButton>
        }
      />

      <Card>
        <TableWrapper>
          <thead>
            <tr>
              <Th>Razão social</Th>
              <Th>CNPJ</Th>
              <Th>UF / Município</Th>
              <Th>Regime tributário</Th>
              <Th align="right">Auditorias</Th>
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 ? (
              <EmptyRow colSpan={5}>
                Nenhuma empresa cadastrada. Cadastre a primeira para iniciar uma auditoria.
              </EmptyRow>
            ) : (
              companies.map((company) => (
                <Tr key={company.id}>
                  <Td>
                    <Link
                      href={`/empresas/${company.id}`}
                      className="font-medium text-navy-700 hover:text-navy-900 hover:underline"
                    >
                      {company.legalName}
                    </Link>
                    {company.tradeName ? (
                      <span className="block text-xs text-ink-muted">{company.tradeName}</span>
                    ) : null}
                  </Td>
                  <Td className="tabular font-mono text-xs">{formatCnpj(company.cnpj)}</Td>
                  <Td className="text-xs text-ink-muted">
                    {company.uf}
                    {company.municipality ? ` · ${company.municipality}` : ''}
                  </Td>
                  <Td>
                    <Badge tone="neutral">{TAX_REGIME_LABELS[company.taxRegime]}</Badge>
                  </Td>
                  <Td align="right">{auditCount.get(company.id) ?? 0}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </TableWrapper>
      </Card>
    </>
  );
}
