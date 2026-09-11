import Link from 'next/link';
import { formatBRL, formatSignedBRL } from '@/lib/core/money';
import {
  FINDING_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  SEVERITY_LABELS,
  type AuditFinding,
} from '@/lib/domain/entities';
import { Badge, FINDING_STATUS_TONES, REVIEW_STATUS_TONES, SEVERITY_TONES } from '@/components/ui/badge';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';

/**
 * Findings table (requirement 20).
 *
 * Selecting a row navigates to the same page with `?divergencia=<id>`, so the
 * detail panel is rendered on the server with the full evidence and is
 * shareable as a link.
 */
export function FindingsTable({
  findings,
  basePath,
  query,
  selectedId,
}: {
  findings: readonly AuditFinding[];
  basePath: string;
  query?: Readonly<Record<string, string>>;
  selectedId?: string | null;
}) {
  const linkFor = (findingId: string): string => {
    const params = new URLSearchParams(query ?? {});
    params.set('divergencia', findingId);
    return `${basePath}?${params.toString()}`;
  };

  return (
    <TableWrapper>
      <thead>
        <tr>
          <Th>Código</Th>
          <Th>Regra / Ocorrência</Th>
          <Th>Documento</Th>
          <Th align="right">Valor origem</Th>
          <Th align="right">Valor destino</Th>
          <Th align="right">Diferença</Th>
          <Th>Gravidade</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {findings.length === 0 ? (
          <EmptyRow colSpan={8}>Nenhuma ocorrência com os filtros aplicados.</EmptyRow>
        ) : (
          findings.map((finding) => (
            <Tr
              key={finding.id}
              className={selectedId === finding.id ? 'bg-navy-50' : undefined}
            >
              <Td className="font-mono text-xs whitespace-nowrap">
                <Link href={linkFor(finding.id)} className="text-navy-700 hover:underline" scroll={false}>
                  {finding.ruleCode}
                </Link>
              </Td>
              <Td className="min-w-[18rem]">
                <Link href={linkFor(finding.id)} className="block" scroll={false}>
                  <span className="font-medium text-ink">{finding.title}</span>
                  {finding.ruleName !== finding.title ? (
                    <span className="mt-0.5 block text-xs text-ink-muted">{finding.ruleName}</span>
                  ) : null}
                </Link>
              </Td>
              <Td className="max-w-[14rem] font-mono text-[0.6875rem] break-all text-ink-muted">
                {finding.documentRef ?? '—'}
              </Td>
              <Td align="right">
                {finding.originValue === null ? (
                  <span className="text-ink-subtle">—</span>
                ) : (
                  formatBRL(finding.originValue)
                )}
              </Td>
              <Td align="right">
                {finding.targetValue === null ? (
                  <span className="text-ink-subtle">—</span>
                ) : (
                  formatBRL(finding.targetValue)
                )}
              </Td>
              <Td align="right" className="font-semibold">
                {finding.difference === null ? (
                  <span className="font-normal text-ink-subtle">—</span>
                ) : (
                  formatSignedBRL(finding.difference)
                )}
              </Td>
              <Td>
                <Badge tone={SEVERITY_TONES[finding.severity]}>{SEVERITY_LABELS[finding.severity]}</Badge>
              </Td>
              <Td>
                <div className="flex flex-col items-start gap-1">
                  <Badge tone={FINDING_STATUS_TONES[finding.status]}>
                    {FINDING_STATUS_LABELS[finding.status]}
                  </Badge>
                  <Badge tone={REVIEW_STATUS_TONES[finding.reviewStatus]}>
                    {REVIEW_STATUS_LABELS[finding.reviewStatus]}
                  </Badge>
                </div>
              </Td>
            </Tr>
          ))
        )}
      </tbody>
    </TableWrapper>
  );
}
