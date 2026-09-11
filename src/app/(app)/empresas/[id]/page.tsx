import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { formatCnpj } from '@/lib/core/cnpj';
import { formatCompetencia } from '@/lib/core/competencia';
import { formatIsoDateTime } from '@/lib/core/dates';
import { AUDIT_STATUS_LABELS } from '@/lib/domain/entities';
import { TAX_REGIME_LABELS } from '@/lib/domain/model';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';
import { updateCompanyAction } from '../actions';
import { CompanyForm } from '../company-form';
import { RegimeForm } from './regime-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const company = await getStore().getCompany(id);
  return { title: company?.legalName ?? 'Empresa' };
}

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const company = await store.getCompany(id);
  if (!company) notFound();

  const [audits, history] = await Promise.all([
    store.listAudits({ companyId: id }),
    store.listRegimeHistory(id),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Empresa"
        title={company.legalName}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs">{formatCnpj(company.cnpj)}</span>
            <span>·</span>
            <span>{TAX_REGIME_LABELS[company.taxRegime]}</span>
            <span>·</span>
            <span>
              {company.uf}
              {company.municipality ? ` / ${company.municipality}` : ''}
            </span>
          </span>
        }
        actions={
          <>
            <LinkButton href="/empresas" variant="secondary">
              Voltar
            </LinkButton>
            <LinkButton href={`/auditorias/nova?empresa=${company.id}`} variant="gold">
              Nova auditoria
            </LinkButton>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Dados cadastrais" description="Alterações valem para as proximas auditorias." />
          <CardBody>
            <CompanyForm
              action={updateCompanyAction}
              submitLabel="Salvar alterações"
              values={{
                id: company.id,
                legalName: company.legalName,
                tradeName: company.tradeName ?? '',
                cnpj: company.cnpj,
                stateRegistration: company.stateRegistration ?? '',
                municipalRegistration: company.municipalRegistration ?? '',
                uf: company.uf,
                municipality: company.municipality ?? '',
                taxRegime: company.taxRegime,
              }}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Histórico de regime tributário"
            description="Registra em quais competências cada regime esteve em vigor."
          />
          <CardBody className="flex flex-col gap-5">
            <RegimeForm companyId={company.id} currentRegime={company.taxRegime} />

            <TableWrapper className="-mx-5">
              <thead>
                <tr>
                  <Th>Regime</Th>
                  <Th>De</Th>
                  <Th>Até</Th>
                  <Th>Observação</Th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <EmptyRow colSpan={4}>Nenhum período registrado.</EmptyRow>
                ) : (
                  history.map((entry) => (
                    <Tr key={entry.id}>
                      <Td>
                        <Badge tone="neutral">{TAX_REGIME_LABELS[entry.taxRegime]}</Badge>
                      </Td>
                      <Td>{formatCompetencia(entry.validFrom)}</Td>
                      <Td>{entry.validTo ? formatCompetencia(entry.validTo) : 'Em vigor'}</Td>
                      <Td className="text-xs text-ink-muted">{entry.note ?? '—'}</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </TableWrapper>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Auditorias da empresa" />
        <TableWrapper>
          <thead>
            <tr>
              <Th>Competência</Th>
              <Th>Status</Th>
              <Th align="right">Documentos</Th>
              <Th align="right">Score</Th>
              <Th>Criada em</Th>
            </tr>
          </thead>
          <tbody>
            {audits.length === 0 ? (
              <EmptyRow colSpan={5}>Nenhuma auditoria para esta empresa.</EmptyRow>
            ) : (
              audits.map((audit) => (
                <Tr key={audit.id}>
                  <Td>
                    <Link
                      href={`/auditorias/${audit.id}`}
                      className="font-medium text-navy-700 hover:underline"
                    >
                      {formatCompetencia(audit.competencia)}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={audit.status === 'CONCLUIDA' ? 'success' : 'neutral'}>
                      {AUDIT_STATUS_LABELS[audit.status]}
                    </Badge>
                  </Td>
                  <Td align="right">{audit.documentCount.toLocaleString('pt-BR')}</Td>
                  <Td align="right">{audit.score ?? '—'}</Td>
                  <Td className="text-xs text-ink-muted">{formatIsoDateTime(audit.createdAt)}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </TableWrapper>
      </Card>
    </>
  );
}
