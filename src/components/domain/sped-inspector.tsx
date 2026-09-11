'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';
import { cn } from '@/lib/ui/cn';
import type { InspectedRecord, SpedPage, SpedSummary } from '@/lib/parsers/sped/inspect';

/**
 * Inspeção técnica de um arquivo SPED (fase 2, requisitos 2 e 9).
 *
 * Mostra a contagem por registro, permite abrir qualquer registro em tabela
 * paginada e, para cada linha, exibe o conteúdo original ao lado da leitura do
 * sistema, campo a campo, com o nome oficial do Guia Prático.
 */
export function SpedInspector({ fileId }: { fileId: string }) {
  const [summary, setSummary] = useState<SpedSummary | null>(null);
  const [page, setPage] = useState<SpedPage | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/arquivos/${fileId}/inspecao`);
        const payload = (await response.json()) as { summary?: SpedSummary; error?: string };
        if (cancelled) return;
        if (!response.ok) setError(payload.error ?? 'Falha ao inspecionar o arquivo.');
        else setSummary(payload.summary ?? null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Falha ao inspecionar.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const openRegister = useCallback(
    async (code: string, pageNumber = 1) => {
      setSelected(code);
      setExpanded(null);
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/arquivos/${fileId}/inspecao?registro=${encodeURIComponent(code)}&pagina=${pageNumber}`,
        );
        const payload = (await response.json()) as { page?: SpedPage; error?: string };
        if (!response.ok) setError(payload.error ?? 'Falha ao abrir o registro.');
        else setPage(payload.page ?? null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Falha ao abrir o registro.');
      } finally {
        setLoading(false);
      }
    },
    [fileId],
  );

  if (error && !summary) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-danger">{error}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Card className="xl:sticky xl:top-20 xl:self-start">
        <CardHeader
          title="Registros encontrados"
          description={
            summary
              ? `${summary.totalRecords.toLocaleString('pt-BR')} registros em ${summary.totalLines.toLocaleString('pt-BR')} linhas.`
              : 'Lendo o arquivo...'
          }
        />
        <div className="app-scroll max-h-[32rem] overflow-y-auto">
          <TableWrapper className="overflow-x-visible">
            <thead>
              <tr>
                <Th>Registro</Th>
                <Th align="right">Quantidade</Th>
              </tr>
            </thead>
            <tbody>
              {!summary ? (
                <EmptyRow colSpan={2}>Lendo o arquivo...</EmptyRow>
              ) : (
                summary.registers.map((register) => (
                  <Tr
                    key={register.code}
                    className={cn(selected === register.code && 'bg-navy-50')}
                    onClick={() => void openRegister(register.code)}
                    label={`Abrir os registros ${register.code}`}
                  >
                    <Td>
                      <span className="flex items-center gap-1.5">
                        <ChevronRight size={13} className="text-ink-subtle" aria-hidden />
                        <span className="font-mono text-xs font-medium text-navy-700">
                          {register.code}
                        </span>
                        {!register.supported ? <Badge tone="warning">não mapeado</Badge> : null}
                      </span>
                      {register.description ? (
                        <span className="mt-0.5 block pl-5 text-[0.6875rem] leading-tight text-ink-muted">
                          {register.description}
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right" className="font-medium">
                      {register.count.toLocaleString('pt-BR')}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </TableWrapper>
        </div>
      </Card>

      <Card className="min-w-0">
        <CardHeader
          title={
            selected
              ? `Registro ${selected}${page?.description ? ` — ${page.description}` : ''}`
              : 'Selecione um registro'
          }
          description={
            page
              ? `${page.total.toLocaleString('pt-BR')} ocorrência(s). Clique em uma linha para comparar o conteúdo original com a leitura do sistema.`
              : 'A lista à esquerda mostra todos os registros presentes no arquivo.'
          }
          action={
            loading ? <Loader2 size={16} className="animate-spin text-navy-500" aria-hidden /> : null
          }
        />

        {error ? (
          <CardBody>
            <p className="text-sm text-danger">{error}</p>
          </CardBody>
        ) : null}

        {!page ? (
          <CardBody>
            <p className="text-sm text-ink-muted">
              Escolha um registro à esquerda para conferir o conteúdo linha a linha.
            </p>
          </CardBody>
        ) : (
          <>
            {!page.supported ? (
              <CardBody className="pb-0">
                <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
                  Este registro não é mapeado pelo parser atual. O conteúdo é exibido posição a posição,
                  sem nome oficial de campo, e não alimenta nenhum cruzamento.
                </p>
              </CardBody>
            ) : null}

            <TableWrapper>
              <thead>
                <tr>
                  <Th align="right">Linha</Th>
                  <Th>Conteúdo original</Th>
                </tr>
              </thead>
              <tbody>
                {page.records.length === 0 ? (
                  <EmptyRow colSpan={2}>Nenhuma ocorrência nesta página.</EmptyRow>
                ) : (
                  page.records.map((record) => (
                    <RecordRow
                      key={record.line}
                      record={record}
                      expanded={expanded === record.line}
                      onToggle={() => setExpanded(expanded === record.line ? null : record.line)}
                    />
                  ))
                )}
              </tbody>
            </TableWrapper>

            {page.total > page.pageSize ? (
              <nav className="flex items-center justify-between border-t border-line px-5 py-3 text-xs">
                <span className="text-ink-muted">
                  Página {page.page} de {Math.ceil(page.total / page.pageSize)}
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page.page <= 1 || loading}
                    onClick={() => void openRegister(page.code, page.page - 1)}
                  >
                    Anterior
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page.page >= Math.ceil(page.total / page.pageSize) || loading}
                    onClick={() => void openRegister(page.code, page.page + 1)}
                  >
                    Próxima
                  </Button>
                </span>
              </nav>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}

function RecordRow({
  record,
  expanded,
  onToggle,
}: {
  record: InspectedRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <Tr
        onClick={onToggle}
        className={cn(expanded && 'bg-navy-50')}
        label={`${expanded ? 'Fechar' : 'Abrir'} a interpretação da linha ${record.line}`}
      >
        <Td align="right" className="align-top font-mono text-xs whitespace-nowrap">
          {record.line.toLocaleString('pt-BR')}
        </Td>
        <Td className="max-w-0">
          <code className="block truncate font-mono text-[0.6875rem] text-ink-muted">
            {record.rawLine}
          </code>
        </Td>
      </Tr>
      {expanded ? (
        <tr>
          <td colSpan={2} className="border-b border-line bg-navy-50/40 px-4 py-4">
            <section className="mb-4">
              <h4 className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-muted uppercase">
                Registro original — linha {record.line.toLocaleString('pt-BR')}
              </h4>
              <code className="block rounded-md border border-line bg-white px-3 py-2 font-mono text-[0.6875rem] break-all text-ink">
                {record.rawLine}
              </code>
            </section>

            <section>
              <h4 className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-muted uppercase">
                Interpretação do sistema
              </h4>
              <div className="app-scroll max-h-96 overflow-y-auto rounded-md border border-line bg-white">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-navy-50/80">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium text-ink-muted">Pos.</th>
                      <th className="px-3 py-1.5 text-left font-medium text-ink-muted">Campo</th>
                      <th className="px-3 py-1.5 text-left font-medium text-ink-muted">Conteúdo</th>
                      <th className="px-3 py-1.5 text-left font-medium text-ink-muted">Leitura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.fields.map((field) => (
                      <tr key={field.position} className="border-t border-line/70">
                        <td className="px-3 py-1.5 font-mono text-ink-subtle">{field.position}</td>
                        <td className="px-3 py-1.5">
                          <span className="font-mono font-medium text-navy-700">{field.name}</span>
                          <span className="block text-[0.625rem] leading-tight text-ink-subtle">
                            {field.label}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono break-all text-ink">
                          {field.raw ?? <span className="text-ink-subtle">(vazio)</span>}
                        </td>
                        <td className="px-3 py-1.5 font-mono break-all text-ink-muted">
                          {field.interpreted ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {record.extraPositions > 0 ? (
                <p className="mt-2 text-[0.6875rem] text-warning">
                  A linha traz {record.extraPositions} posição(ões) além das mapeadas por este parser.
                </p>
              ) : null}
            </section>
          </td>
        </tr>
      ) : null}
    </>
  );
}
