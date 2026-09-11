import Link from 'next/link';
import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { compareCompetencia, formatCompetencia } from '@/lib/core/competencia';
import { formatIsoDateTime } from '@/lib/core/dates';
import { BAND_LABELS } from '@/lib/audit-engine';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { LinkButton } from '@/components/ui/button';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';
import { LineChart } from '@/components/charts/line-chart';

export const metadata: Metadata = { title: 'Relatórios' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const store = getStore();
  const [audits, companies] = await Promise.all([store.listAudits(), store.listCompanies()]);
  const companyById = new Map(companies.map((company) => [company.id, company]));

  const concluded = audits.filter(
    (audit) => audit.status === 'CONCLUIDA' || audit.status === 'CONCLUIDA_COM_ERROS',
  );

  const byCompany = new Map<string, typeof concluded>();
  for (const audit of concluded) {
    const bucket = byCompany.get(audit.companyId);
    if (bucket) bucket.push(audit);
    else byCompany.set(audit.companyId, [audit]);
  }

  return (
    <>
      <PageHeader
        eyebrow="Documentacao"
        title="Relatórios"
        description="Relatório de conformidade fiscal por empresa e competência, com a evolução do score ao longo do histórico."
      />

      {concluded.length === 0 ? (
        <EmptyState
          title="Nenhuma auditoria concluída"
          description="Os relatórios são gerados a partir de auditorias processadas. Importe os arquivos de uma competência e execute o processamento."
          action={
            <LinkButton href="/auditorias/nova" variant="gold">
              Nova auditoria
            </LinkButton>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {[...byCompany.entries()].map(([companyId, list]) => {
            const company = companyById.get(companyId);
            const ordered = [...list].sort((a, b) => compareCompetencia(a.competencia, b.competencia));

            return (
              <Card key={companyId}>
                <CardHeader
                  title={company?.legalName ?? 'Empresa removida'}
                  description={`${ordered.length} auditoria(s) concluída(s).`}
                  action={
                    company ? (
                      <LinkButton href={`/empresas/${company.id}`} variant="secondary" size="sm">
                        Ver empresa
                      </LinkButton>
                    ) : null
                  }
                />
                <CardBody>
                  <LineChart
                    points={ordered.map((audit) => ({
                      label: formatCompetencia(audit.competencia),
                      value: audit.score ?? 0,
                    }))}
                    height={170}
                  />
                </CardBody>
                <TableWrapper>
                  <thead>
                    <tr>
                      <Th>Competência</Th>
                      <Th align="right">Score</Th>
                      <Th>Classificação</Th>
                      <Th align="right">Documentos</Th>
                      <Th>Concluída em</Th>
                      <Th align="center">Relatório</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.length === 0 ? (
                      <EmptyRow colSpan={6}>Sem auditorias concluídas.</EmptyRow>
                    ) : (
                      [...ordered].reverse().map((audit) => (
                        <Tr key={audit.id}>
                          <Td>{formatCompetencia(audit.competencia)}</Td>
                          <Td align="right" className="font-semibold">
                            {audit.score ?? '—'}
                          </Td>
                          <Td>
                            {audit.band ? (
                              <Badge tone={audit.band === 'CRITICO' ? 'danger' : audit.band === 'ATENCAO' ? 'warning' : 'success'}>
                                {BAND_LABELS[audit.band]}
                              </Badge>
                            ) : (
                              '—'
                            )}
                          </Td>
                          <Td align="right">{audit.documentCount.toLocaleString('pt-BR')}</Td>
                          <Td className="text-xs text-ink-muted">{formatIsoDateTime(audit.finishedAt)}</Td>
                          <Td align="center">
                            <Link
                              href={`/auditorias/${audit.id}/relatorio`}
                              className="text-xs font-medium text-navy-700 hover:underline"
                            >
                              Abrir
                            </Link>
                          </Td>
                        </Tr>
                      ))
                    )}
                  </tbody>
                </TableWrapper>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
