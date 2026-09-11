import Link from 'next/link';
import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { formatCnpj } from '@/lib/core/cnpj';
import { formatCompetencia } from '@/lib/core/competencia';
import { formatIsoDateTime } from '@/lib/core/dates';
import {
  FILE_STATUS_LABELS,
  RELIABILITY_LABELS,
  type FileProcessingStatus,
  type FileReliability,
} from '@/lib/domain/entities';
import { DATA_SOURCE_DEFINITIONS, DATA_SOURCES, sourceShortLabel } from '@/lib/domain/sources';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Importações' };
export const dynamic = 'force-dynamic';

const RELIABILITY_TONES: Record<FileReliability, 'success' | 'warning' | 'danger' | 'muted'> = {
  VALIDADO: 'success',
  VALIDADO_COM_ALERTAS: 'warning',
  REQUER_CONFERENCIA: 'warning',
  INCOMPATIVEL: 'danger',
  ERRO: 'danger',
};

const STATUS_TONES: Record<FileProcessingStatus, 'muted' | 'info' | 'success' | 'warning' | 'danger'> = {
  PENDENTE: 'muted',
  PROCESSANDO: 'info',
  PROCESSADO: 'success',
  PROCESSADO_COM_ALERTAS: 'warning',
  ERRO: 'danger',
};

export default async function ImportsPage() {
  const store = getStore();
  const [audits, companies] = await Promise.all([store.listAudits(), store.listCompanies()]);
  const companyById = new Map(companies.map((company) => [company.id, company]));

  const rows = (
    await Promise.all(
      audits.map(async (audit) => {
        const files = await store.listFiles(audit.id);
        return files.map((file) => ({ file, audit }));
      }),
    )
  )
    .flat()
    .sort((a, b) => b.file.uploadedAt.localeCompare(a.file.uploadedAt))
    .slice(0, 300);

  return (
    <>
      <PageHeader
        eyebrow="Arquivos"
        title="Importações"
        description="Todos os arquivos recebidos pelo sistema. Abra qualquer arquivo para conferir a leitura registro a registro antes de usá-lo na auditoria."
      />

      <Card className="mb-4">
        <CardHeader
          title="Obrigações suportadas"
          description="Formatos lidos neste release e obrigações já previstas na arquitetura para as próximas entregas."
        />
        <CardBody>
          <ul className="flex flex-wrap gap-2">
            {DATA_SOURCES.map((source) => {
              const definition = DATA_SOURCE_DEFINITIONS[source];
              return (
                <li key={source}>
                  <Badge tone={definition.implemented ? 'success' : 'muted'}>
                    {definition.shortLabel}
                    <span className="ml-1.5 text-[0.625rem] opacity-70">
                      {definition.implemented ? definition.extensions.join(' ') : 'previsto'}
                    </span>
                  </Badge>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Arquivos importados (${rows.length})`} />
        <TableWrapper>
          <thead>
            <tr>
              <Th>Arquivo</Th>
              <Th>Empresa / Competência</Th>
              <Th>Tipo</Th>
              <Th>CNPJ no arquivo</Th>
              <Th>Confiabilidade</Th>
              <Th>Status</Th>
              <Th>Enviado em</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7}>
                Nenhum arquivo importado ainda. Crie uma auditoria e envie os arquivos da competência.
              </EmptyRow>
            ) : (
              rows.map(({ file, audit }) => (
                <Tr key={file.id}>
                  <Td className="max-w-xs">
                    <Link href={`/arquivos/${file.id}`} className="break-all text-navy-700 hover:underline">
                      {file.originalName}
                    </Link>
                  </Td>
                  <Td className="text-xs">
                    <Link href={`/auditorias/${audit.id}`} className="font-medium text-ink hover:underline">
                      {companyById.get(audit.companyId)?.legalName ?? 'Empresa removida'}
                    </Link>
                    <span className="block text-ink-muted">{formatCompetencia(audit.competencia)}</span>
                  </Td>
                  <Td>
                    {file.detectedSource ? (
                      <Badge tone="neutral">{sourceShortLabel(file.detectedSource)}</Badge>
                    ) : (
                      <span className="text-xs text-ink-subtle">—</span>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">
                    {file.detectedTaxId ? formatCnpj(file.detectedTaxId) : '—'}
                    {file.identityCheck === 'INCOMPATIVEL' ? (
                      <Badge tone="danger" className="ml-2">
                        Incompatível
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={RELIABILITY_TONES[file.reliability]}>
                      {RELIABILITY_LABELS[file.reliability]}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONES[file.status]}>{FILE_STATUS_LABELS[file.status]}</Badge>
                  </Td>
                  <Td className="text-xs text-ink-muted">{formatIsoDateTime(file.uploadedAt)}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </TableWrapper>
      </Card>

      <div className="mt-4 flex justify-end">
        <LinkButton href="/auditorias/nova" variant="gold">
          Nova auditoria
        </LinkButton>
      </div>
    </>
  );
}
