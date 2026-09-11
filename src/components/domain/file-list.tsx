import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CircleDashed, Info, Loader2, ScanSearch, XCircle } from 'lucide-react';
import { formatCnpj } from '@/lib/core/cnpj';
import { formatCompetencia, isCompetencia } from '@/lib/core/competencia';
import {
  FILE_STATUS_LABELS,
  RELIABILITY_LABELS,
  type AuditFile,
  type FileProcessingStatus,
  type FileReliability,
} from '@/lib/domain/entities';
import { sourceShortLabel } from '@/lib/domain/sources';
import { Badge } from '@/components/ui/badge';
import { EmptyRow, TableWrapper, Td, Th, Tr } from '@/components/ui/table';
import { DeleteFileButton } from './delete-file-button';

const STATUS_TONES: Record<FileProcessingStatus, 'muted' | 'info' | 'success' | 'warning' | 'danger'> = {
  PENDENTE: 'muted',
  PROCESSANDO: 'info',
  PROCESSADO: 'success',
  PROCESSADO_COM_ALERTAS: 'warning',
  ERRO: 'danger',
};

const RELIABILITY_TONES: Record<FileReliability, 'success' | 'warning' | 'danger' | 'muted'> = {
  VALIDADO: 'success',
  VALIDADO_COM_ALERTAS: 'warning',
  REQUER_CONFERENCIA: 'warning',
  INCOMPATIVEL: 'danger',
  ERRO: 'danger',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileList({ auditId, files }: { auditId: string; files: readonly AuditFile[] }) {
  return (
    <TableWrapper>
      <thead>
        <tr>
          <Th>Arquivo</Th>
          <Th>Tipo identificado</Th>
          <Th>CNPJ / Competência</Th>
          <Th>Confiabilidade</Th>
          <Th>Situação</Th>
          <Th align="right">Registros</Th>
          <Th align="center">Ações</Th>
        </tr>
      </thead>
      <tbody>
        {files.length === 0 ? (
          <EmptyRow colSpan={7}>Nenhum arquivo importado nesta auditoria.</EmptyRow>
        ) : (
          files.map((file) => (
            <Tr key={file.id} className="align-top">
              <Td>
                <Link
                  href={`/arquivos/${file.id}`}
                  className="font-medium break-all text-navy-700 hover:underline"
                >
                  {file.originalName}
                </Link>
                <span className="mt-0.5 block text-[0.6875rem] text-ink-subtle">
                  {formatBytes(file.sizeBytes)} · SHA-256 {file.sha256.slice(0, 12)}…
                </span>
              </Td>
              <Td>
                {file.detectedSource ? (
                  <Badge tone="neutral">{sourceShortLabel(file.detectedSource)}</Badge>
                ) : (
                  <span className="text-xs text-ink-subtle">Não identificado</span>
                )}
              </Td>
              <Td className="text-xs">
                <span className="block font-mono">
                  {file.detectedTaxId ? formatCnpj(file.detectedTaxId) : '—'}
                </span>
                <span className="block text-ink-muted">
                  {file.detectedCompetencia && isCompetencia(file.detectedCompetencia)
                    ? formatCompetencia(file.detectedCompetencia)
                    : '—'}
                </span>
                {file.identityCheck === 'INCOMPATIVEL' ? (
                  <Badge tone="danger" className="mt-1">
                    Arquivo incompatível
                  </Badge>
                ) : null}
              </Td>
              <Td>
                <Badge tone={RELIABILITY_TONES[file.reliability]}>
                  {RELIABILITY_LABELS[file.reliability]}
                </Badge>
                {file.parserVersion ? (
                  <span className="mt-1 block font-mono text-[0.625rem] text-ink-subtle">
                    parser {file.parserVersion}
                  </span>
                ) : null}
              </Td>
              <Td>
                <Badge tone={STATUS_TONES[file.status]}>{FILE_STATUS_LABELS[file.status]}</Badge>
                {file.messages.length > 0 ? (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {file.messages.slice(0, 5).map((message, index) => (
                      <li key={`${message.code}-${index}`} className="flex items-start gap-1.5 text-[0.6875rem]">
                        <MessageIcon level={message.level} />
                        <span className={message.level === 'ERRO' ? 'text-danger' : 'text-ink-muted'}>
                          {message.message}
                          {message.detail ? (
                            <span className="block text-ink-subtle">{message.detail}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Td>
              <Td align="right" className="text-xs">
                {file.stats ? (
                  <span className="tabular flex flex-col text-ink-muted">
                    <span>{file.stats.found.toLocaleString('pt-BR')} encontrados</span>
                    <span>{file.stats.processed.toLocaleString('pt-BR')} processados</span>
                    {file.stats.duplicated > 0 ? <span>{file.stats.duplicated} duplicados</span> : null}
                    {file.stats.invalid > 0 ? (
                      <span className="text-danger">{file.stats.invalid} inválidos</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-ink-subtle">—</span>
                )}
              </Td>
              <Td align="center">
                <div className="flex items-center justify-center gap-1">
                  <Link
                    href={`/arquivos/${file.id}`}
                    title="Validar arquivo"
                    aria-label="Validar arquivo"
                    className="rounded-md p-1.5 text-navy-600 transition-colors hover:bg-navy-50"
                  >
                    <ScanSearch size={15} aria-hidden />
                  </Link>
                  <DeleteFileButton auditId={auditId} fileId={file.id} />
                </div>
              </Td>
            </Tr>
          ))
        )}
      </tbody>
    </TableWrapper>
  );
}

function MessageIcon({ level }: { level: 'INFO' | 'ALERTA' | 'ERRO' }) {
  if (level === 'ERRO') return <XCircle size={12} className="mt-0.5 shrink-0 text-danger" aria-hidden />;
  if (level === 'ALERTA') {
    return <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden />;
  }
  return <Info size={12} className="mt-0.5 shrink-0 text-navy-400" aria-hidden />;
}

export function StatusIcon({ status }: { status: FileProcessingStatus }) {
  if (status === 'PROCESSADO') return <CheckCircle2 size={14} className="text-success" aria-hidden />;
  if (status === 'PROCESSANDO') {
    return <Loader2 size={14} className="animate-spin text-navy-500" aria-hidden />;
  }
  if (status === 'ERRO') return <XCircle size={14} className="text-danger" aria-hidden />;
  if (status === 'PROCESSADO_COM_ALERTAS') {
    return <AlertTriangle size={14} className="text-warning" aria-hidden />;
  }
  return <CircleDashed size={14} className="text-ink-subtle" aria-hidden />;
}
