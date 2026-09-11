import Link from 'next/link';
import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { formatCompetencia } from '@/lib/core/competencia';
import type { FindingFilter } from '@/lib/data/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { FindingsTable } from '@/components/domain/findings-table';
import { FindingPanel } from '@/components/domain/finding-panel';
import { FindingFilters, type FilterValues } from './filters';

export const metadata: Metadata = { title: 'Divergências' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

interface SearchParams {
  gravidade?: string;
  modulo?: string;
  regra?: string;
  resultado?: string;
  analise?: string;
  busca?: string;
  auditoria?: string;
  divergencia?: string;
  pagina?: string;
}

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const store = getStore();

  const page = Math.max(1, Number(query.pagina ?? '1') || 1);
  const filter: FindingFilter = {
    ...(query.auditoria ? { auditId: query.auditoria } : {}),
    ...(query.gravidade ? { severity: query.gravidade as FindingFilter['severity'] } : {}),
    ...(query.modulo ? { module: query.modulo } : {}),
    ...(query.regra ? { ruleCode: query.regra } : {}),
    ...(query.resultado ? { status: query.resultado } : {}),
    ...(query.analise ? { reviewStatus: query.analise as FindingFilter['reviewStatus'] } : {}),
    ...(query.busca ? { search: query.busca } : {}),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const [result, audit] = await Promise.all([
    store.listFindings(filter),
    query.auditoria ? store.getAudit(query.auditoria) : Promise.resolve(null),
  ]);

  const selected = query.divergencia ? await store.getFinding(query.divergencia) : null;
  const comments = selected ? await store.listComments(selected.id) : [];

  const values: FilterValues = {
    severity: query.gravidade ?? '',
    module: query.modulo ?? '',
    ruleCode: query.regra ?? '',
    reviewStatus: query.analise ?? '',
    status: query.resultado ?? '',
    search: query.busca ?? '',
    auditId: query.auditoria ?? '',
  };

  const baseQuery: Record<string, string> = Object.fromEntries(
    Object.entries({
      gravidade: values.severity,
      modulo: values.module,
      regra: values.ruleCode,
      resultado: values.status,
      analise: values.reviewStatus,
      busca: values.search,
      auditoria: values.auditId,
      pagina: page > 1 ? String(page) : '',
    }).filter(([, value]) => value !== ''),
  );

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        eyebrow="Análise"
        title="Divergências"
        description={
          audit
            ? `Ocorrências da auditoria de ${formatCompetencia(audit.competencia)}.`
            : 'Ocorrências apuradas em todas as auditorias da organização.'
        }
      />

      <Card className="mb-4">
        <CardHeader title="Filtros" />
        <CardBody>
          <FindingFilters values={values} />
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <Card>
          <CardHeader
            title={`${result.total.toLocaleString('pt-BR')} ocorrência(s)`}
            description="Clique em uma linha para abrir as evidências e classificar a divergência."
          />
          <FindingsTable
            findings={result.items}
            basePath="/divergencias"
            query={baseQuery}
            selectedId={selected?.id ?? null}
          />
          {totalPages > 1 ? (
            <nav className="flex items-center justify-between border-t border-line px-5 py-3 text-xs">
              <span className="text-ink-muted">
                Página {page} de {totalPages}
              </span>
              <span className="flex gap-2">
                {page > 1 ? (
                  <Link
                    href={`/divergencias?${new URLSearchParams({ ...baseQuery, pagina: String(page - 1) })}`}
                    className="rounded-md border border-line-strong px-3 py-1.5 text-navy-700 hover:bg-navy-50"
                  >
                    Anterior
                  </Link>
                ) : null}
                {page < totalPages ? (
                  <Link
                    href={`/divergencias?${new URLSearchParams({ ...baseQuery, pagina: String(page + 1) })}`}
                    className="rounded-md border border-line-strong px-3 py-1.5 text-navy-700 hover:bg-navy-50"
                  >
                    Próxima
                  </Link>
                ) : null}
              </span>
            </nav>
          ) : null}
        </Card>

        {selected ? (
          <Card className="min-w-0 overflow-hidden xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)]">
            <FindingPanel
              finding={selected}
              comments={comments}
              closeHref={`/divergencias?${new URLSearchParams(baseQuery)}`}
            />
          </Card>
        ) : (
          <Card>
            <CardHeader title="Detalhe da divergência" />
            <CardBody>
              <p className="text-sm text-ink-muted">
                Selecione uma ocorrência para ver de onde veio cada valor comparado, registrar a análise e
                classificar a divergência.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
