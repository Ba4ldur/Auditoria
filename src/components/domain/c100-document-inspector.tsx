'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { TableWrapper, Td, Th, Tr } from '@/components/ui/table';
import type { InspectedDocument, InspectedRecord } from '@/lib/parsers/sped/inspect';

/**
 * Inspeção do C100 real com os registros que pertencem a ele.
 *
 * O que esta tela tem de específico é a coluna do meio: o **conteúdo bruto da
 * posição**, exatamente como está no arquivo, ao lado do nome oficial do campo
 * e da leitura do parser. É essa justaposição que permite a um contador afirmar
 * que a leitura está certa — ou apontar exatamente onde está errada, sem abrir
 * o arquivo em um editor de texto.
 */
export function C100DocumentInspector({ fileId, chave }: { fileId: string; chave: string }) {
  const [document, setDocument] = useState<InspectedDocument | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/arquivos/${fileId}/documento?chave=${encodeURIComponent(chave)}`,
        );
        const payload = (await response.json()) as {
          document?: InspectedDocument;
          fileName?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok) setError(payload.error ?? 'Falha ao abrir o registro C100.');
        else {
          setDocument(payload.document ?? null);
          setFileName(payload.fileName ?? null);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Falha ao abrir o registro.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fileId, chave]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-1 py-3 text-xs text-ink-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Lendo o registro no arquivo armazenado...
      </p>
    );
  }

  if (error) return <p className="px-1 py-3 text-xs text-danger">{error}</p>;
  if (!document) return null;

  const contagens = Object.entries(document.childCounts).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-4">
      <RecordCard
        record={document.document}
        fileName={fileName}
        title="Registro C100"
        description="Linha original do arquivo e leitura do sistema, campo a campo."
        badges={
          contagens.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {contagens.map(([code, count]) => (
                <Badge key={code} tone="muted">
                  {code} · {count}
                </Badge>
              ))}
            </span>
          ) : (
            <Badge tone="muted">sem registros filhos</Badge>
          )
        }
      />

      {document.children.map((child) => (
        <RecordCard
          key={`${child.code}-${child.line}`}
          record={child}
          fileName={fileName}
          title={`Registro ${child.code}`}
          description="Registro vinculado a este documento pela posição no arquivo."
        />
      ))}
    </div>
  );
}

function RecordCard({
  record,
  fileName,
  title,
  description,
  badges,
}: {
  record: InspectedRecord;
  fileName: string | null;
  title: string;
  description: string;
  badges?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>{title}</span>
            <span className="font-mono text-[0.625rem] text-ink-subtle">
              {fileName ? `${fileName} · ` : ''}linha {record.line.toLocaleString('pt-BR')}
            </span>
          </span>
        }
        description={description}
        action={badges}
      />
      <CardBody>
        <div className="app-scroll overflow-x-auto rounded-md border border-line bg-navy-50/40 px-3 py-2">
          <code className="font-mono text-[0.6875rem] whitespace-pre text-ink">{record.rawLine}</code>
        </div>

        {record.extraPositions > 0 ? (
          <p className="mt-2 text-[0.6875rem] text-ink-muted">
            A linha tem {record.extraPositions} posição(ões) além das mapeadas por este parser. O
            conteúdo está acima, na linha original.
          </p>
        ) : null}

        <div className="mt-3">
          <TableWrapper>
            <thead>
              <Tr>
                <Th>Pos.</Th>
                <Th>Campo</Th>
                <Th>Conteúdo no arquivo</Th>
                <Th>Leitura do sistema</Th>
              </Tr>
            </thead>
            <tbody>
              {record.fields.map((field) => (
                <Tr key={field.position}>
                  <Td className="tabular text-ink-subtle">{field.position}</Td>
                  <Td>
                    <span className="font-mono text-xs text-navy-700">{field.name}</span>
                    <span className="block text-[0.625rem] text-ink-muted">{field.label}</span>
                  </Td>
                  <Td className="font-mono text-xs">
                    {field.raw === null ? <span className="text-ink-subtle">vazio</span> : field.raw}
                  </Td>
                  <Td className="font-mono text-xs">
                    {field.interpreted === null ? (
                      <span className="text-ink-subtle">—</span>
                    ) : (
                      field.interpreted
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrapper>
        </div>
      </CardBody>
    </Card>
  );
}
