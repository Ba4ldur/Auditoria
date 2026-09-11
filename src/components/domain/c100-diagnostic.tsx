'use client';

import { useEffect, useState } from 'react';
import { formatBRL } from '@/lib/core/money';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { TableWrapper, Td, Th, Tr } from '@/components/ui/table';
import type { C100Diagnostic, C100Group, C100Totals } from '@/lib/parsers/sped/inspect';

/**
 * Diagnóstico dos registros C100 (fase 2, requisito 4).
 *
 * Os somatórios são apresentados separados por IND_OPER e por COD_SIT. Nenhum
 * total é rotulado como faturamento: a composição da receita é decidida pela
 * Política de Receita, não por este diagnóstico.
 */
export function C100DiagnosticPanel({ fileId }: { fileId: string }) {
  const [data, setData] = useState<C100Diagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/arquivos/${fileId}/inspecao?registro=C100_DIAGNOSTICO`);
        const payload = (await response.json()) as { diagnostic?: C100Diagnostic; error?: string };
        if (cancelled) return;
        if (!response.ok) setError(payload.error ?? 'Falha ao calcular o diagnóstico.');
        else setData(payload.diagnostic ?? null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Falha ao calcular.');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (error) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-danger">{error}</p>
        </CardBody>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-ink-muted">Calculando o diagnóstico dos registros C100...</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Diagnóstico dos registros C100"
          description="Contagens apuradas diretamente no arquivo, sem nenhuma inferência."
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            <Counter label="Total de C100" value={data.total} />
            <Counter label="Com chave de NF-e" value={data.withAccessKey} />
            <Counter label="Sem chave" value={data.withoutAccessKey} />
            <Counter label="Cancelados / denegados" value={data.cancelled} />
            <Counter label="Regulares" value={data.regular} />
            <Counter label="Entradas" value={data.entradas} />
            <Counter label="Saídas" value={data.saidas} />
          </dl>
          {data.undefinedDirection > 0 ? (
            <p className="mt-3 text-xs text-warning">
              {data.undefinedDirection} registro(s) sem IND_OPER preenchido.
            </p>
          ) : null}
          <p className="mt-3 text-xs text-ink-muted">
            Documentos cancelados, denegados ou inutilizados aparecem no grupo COD_SIT correspondente e{' '}
            <strong>não</strong> são somados automaticamente como faturamento.
          </p>
        </CardBody>
      </Card>

      <TotalsTable title="Somatórios por IND_OPER" caption="Indicador do tipo de operação" groups={data.byOperation} />
      <TotalsTable title="Somatórios por COD_SIT" caption="Situação do documento fiscal" groups={data.bySituation} />

      <Card>
        <CardHeader title="Somatório geral dos C100" description="Soma de todos os registros, sem exclusões." />
        <TotalsRowTable totals={data.totals} count={data.total} />
      </Card>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <dt className="text-[0.625rem] leading-tight tracking-[0.06em] text-ink-subtle uppercase">{label}</dt>
      <dd className="tabular mt-1 text-lg font-semibold text-ink">{value.toLocaleString('pt-BR')}</dd>
    </div>
  );
}

const TOTAL_COLUMNS: readonly { key: keyof C100Totals; label: string }[] = [
  { key: 'vlDoc', label: 'VL_DOC' },
  { key: 'vlMerc', label: 'VL_MERC' },
  { key: 'vlBcIcms', label: 'VL_BC_ICMS' },
  { key: 'vlIcms', label: 'VL_ICMS' },
  { key: 'vlBcIcmsSt', label: 'VL_BC_ICMS_ST' },
  { key: 'vlIcmsSt', label: 'VL_ICMS_ST' },
  { key: 'vlIpi', label: 'VL_IPI' },
  { key: 'vlPis', label: 'VL_PIS' },
  { key: 'vlCofins', label: 'VL_COFINS' },
];

function TotalsTable({
  title,
  caption,
  groups,
}: {
  title: string;
  caption: string;
  groups: readonly C100Group[];
}) {
  return (
    <Card>
      <CardHeader title={title} description={caption} />
      <TableWrapper>
        <thead>
          <tr>
            <Th>Código</Th>
            <Th align="right">Qtde.</Th>
            {TOTAL_COLUMNS.map((column) => (
              <Th key={column.key} align="right">
                {column.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Tr key={group.key}>
              <Td>
                <span className="font-mono text-xs font-medium text-navy-700">{group.key}</span>
                <span className="block text-[0.6875rem] text-ink-muted">{group.label}</span>
              </Td>
              <Td align="right">{group.count.toLocaleString('pt-BR')}</Td>
              {TOTAL_COLUMNS.map((column) => (
                <Td key={column.key} align="right" className="whitespace-nowrap">
                  {formatBRL(group.totals[column.key])}
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </TableWrapper>
    </Card>
  );
}

function TotalsRowTable({ totals, count }: { totals: C100Totals; count: number }) {
  return (
    <TableWrapper>
      <thead>
        <tr>
          <Th align="right">Qtde.</Th>
          {TOTAL_COLUMNS.map((column) => (
            <Th key={column.key} align="right">
              {column.label}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        <Tr>
          <Td align="right">{count.toLocaleString('pt-BR')}</Td>
          {TOTAL_COLUMNS.map((column) => (
            <Td key={column.key} align="right" className="font-medium whitespace-nowrap">
              {formatBRL(totals[column.key])}
            </Td>
          ))}
        </Tr>
      </tbody>
    </TableWrapper>
  );
}
