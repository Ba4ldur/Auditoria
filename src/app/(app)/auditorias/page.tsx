import Link from 'next/link';
import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { formatCompetencia } from '@/lib/core/competencia';
import { formatIsoDateTime } from '@/lib/core/dates';
import { AUDIT_STATUS_LABELS } from '@/lib/domain/entities';
import { BAND_LABELS } from '@/lib/audit-engine';
import { LinkButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Auditorias' };
export const dynamic = 'force-dynamic';

const STATUS_TONES = {
  RASCUNHO: 'muted',
  AGUARDANDO_ARQUIVOS: 'neutral',
  PROCESSANDO: 'info',
  CONCLUIDA: 'success',
  CONCLUIDA_COM_ERROS: 'warning',
  ERRO: 'danger',
} as const;

export default async function AuditsPage() {
  const store = getStore();
  const [audits, companies] = await Promise.all([store.listAudits(), store.listCompanies()]);
  const companyById = new Map(companies.map((company) => [company.id, company]));

  return (
    <>
      <PageHeader
        eyebrow="Execução"
        title="Auditorias"
        description="Cada auditoria corresponde a uma empresa e a uma competência. O histórico permite acompanhar a evolução do score."
        actions={
          <LinkButton href="/auditorias/nova" variant="gold">
            Nova auditoria
          </LinkButton>
        }
      />

      <Card>
        <TableWrapper>
          <thead>
            <tr>
              <Th>Empresa</Th>
              <Th>Competência</Th>
              <Th>Status</Th>
              <Th align="right">Documentos</Th>
              <Th align="right">Score</Th>
              <Th>Atualizada em</Th>
            </tr>
          </thead>
          <tbody>
            {audits.length === 0 ? (
              <EmptyRow colSpan={6}>Nenhuma auditoria criada.</EmptyRow>
            ) : (
              audits.map((audit) => (
                <Tr key={audit.id}>
                  <Td>
                    <Link
                      href={`/auditorias/${audit.id}`}
                      className="font-medium text-navy-700 hover:underline"
                    >
                      {companyById.get(audit.companyId)?.legalName ?? 'Empresa removida'}
                    </Link>
                  </Td>
                  <Td>{formatCompetencia(audit.competencia)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONES[audit.status]}>{AUDIT_STATUS_LABELS[audit.status]}</Badge>
                  </Td>
                  <Td align="right">{audit.documentCount.toLocaleString('pt-BR')}</Td>
                  <Td align="right">
                    {audit.score === null ? (
                      <span className="text-ink-subtle">—</span>
                    ) : (
                      <>
                        <span className="font-semibold">{audit.score}</span>
                        {audit.band ? (
                          <span className="ml-1.5 text-[0.6875rem] text-ink-muted">
                            {BAND_LABELS[audit.band]}
                          </span>
                        ) : null}
                      </>
                    )}
                  </Td>
                  <Td className="text-xs text-ink-muted">{formatIsoDateTime(audit.updatedAt)}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </TableWrapper>
      </Card>
    </>
  );
}
