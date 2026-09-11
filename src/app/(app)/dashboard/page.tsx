import Link from 'next/link';
import type { Metadata } from 'next';
import { Building2, ClipboardCheck, Gauge, ShieldAlert, Siren } from 'lucide-react';
import { loadDashboard } from '@/lib/queries/dashboard';
import { formatIsoDateTime } from '@/lib/core/dates';
import { AUDIT_STATUS_LABELS } from '@/lib/domain/entities';
import { BAND_LABELS } from '@/lib/audit-engine';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat';
import { PageHeader } from '@/components/ui/page';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';
import { LineChart } from '@/components/charts/line-chart';
import { BarChart } from '@/components/charts/bar-chart';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const data = await loadDashboard();

  return (
    <>
      <PageHeader
        eyebrow="Visao geral"
        title="Dashboard"
        description="Situação consolidada das auditorias, da conformidade apurada e das divergências em aberto."
        actions={
          <LinkButton href="/auditorias/nova" variant="gold">
            Nova auditoria
          </LinkButton>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Empresas"
          value={data.companyCount}
          hint="Cadastradas na organização"
          icon={<Building2 size={18} aria-hidden />}
        />
        <StatCard
          label="Auditorias"
          value={data.auditCount}
          hint="Realizadas no histórico"
          icon={<ClipboardCheck size={18} aria-hidden />}
        />
        <StatCard
          label="Conformidade média"
          value={data.averageConformity === null ? '—' : `${data.averageConformity}%`}
          hint="Média dos scores apurados"
          tone="gold"
          icon={<Gauge size={18} aria-hidden />}
        />
        <StatCard
          label="Divergências"
          value={data.openFindings}
          hint="Pendentes ou em análise"
          tone={data.openFindings > 0 ? 'warning' : 'success'}
          icon={<ShieldAlert size={18} aria-hidden />}
        />
        <StatCard
          label="Divergências críticas"
          value={data.criticalFindings}
          hint="Gravidade crítica em aberto"
          tone={data.criticalFindings > 0 ? 'danger' : 'success'}
          icon={<Siren size={18} aria-hidden />}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Conformidade por competência"
            description="Média do score de conformidade das auditorias concluídas em cada competência."
          />
          <CardBody>
            <LineChart
              points={data.conformityByCompetencia}
              emptyMessage="Nenhuma auditoria concluída até o momento."
            />
          </CardBody>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader title="Divergências por módulo" />
            <CardBody>
              <BarChart data={data.findingsByModule} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Divergências por gravidade" />
            <CardBody>
              <BarChart data={data.findingsBySeverity} />
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Auditorias recentes"
          action={
            <LinkButton href="/auditorias" variant="secondary" size="sm">
              Ver todas
            </LinkButton>
          }
        />
        <TableWrapper>
          <thead>
            <tr>
              <Th>Empresa</Th>
              <Th>Competência</Th>
              <Th align="right">Documentos</Th>
              <Th>Resultado</Th>
              <Th align="right">Score</Th>
              <Th>Data</Th>
            </tr>
          </thead>
          <tbody>
            {data.recentAudits.length === 0 ? (
              <EmptyRow colSpan={6}>
                Nenhuma auditoria registrada. Comece cadastrando uma empresa e criando a primeira auditoria.
              </EmptyRow>
            ) : (
              data.recentAudits.map((audit) => (
                <Tr key={audit.id}>
                  <Td>
                    <Link
                      href={`/auditorias/${audit.id}`}
                      className="font-medium text-navy-700 hover:text-navy-900 hover:underline"
                    >
                      {audit.companyName}
                    </Link>
                  </Td>
                  <Td>{audit.competenciaLabel}</Td>
                  <Td align="right">{audit.documentCount.toLocaleString('pt-BR')}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={audit.status === 'CONCLUIDA' ? 'success' : audit.status === 'ERRO' ? 'danger' : 'neutral'}>
                        {AUDIT_STATUS_LABELS[audit.status]}
                      </Badge>
                      {audit.findings > 0 ? (
                        <Badge tone="warning">{audit.findings} ocorrencia(s)</Badge>
                      ) : null}
                    </div>
                  </Td>
                  <Td align="right">
                    {audit.score === null ? (
                      <span className="text-ink-subtle">—</span>
                    ) : (
                      <span className="font-semibold">
                        {audit.score}
                        {audit.band ? (
                          <span className="ml-1.5 text-[0.6875rem] font-normal text-ink-muted">
                            {BAND_LABELS[audit.band]}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </Td>
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
