import type { ReactNode } from 'react';
import { cn } from '@/lib/ui/cn';

export function TableWrapper({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('app-scroll overflow-x-auto', className)}>
      <table className="w-full min-w-[36rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-line bg-navy-50/60 px-4 py-2.5 text-[0.6875rem] font-semibold tracking-wide text-ink-muted uppercase',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  colSpan,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'border-b border-line px-4 py-2.5 align-middle text-ink',
        align === 'right' && 'text-right tabular',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * Linha de tabela. Quando recebe `onClick`, a linha passa a ser acionável
 * também pelo teclado (Enter ou Espaço) e ganha foco visível — auditoria é
 * trabalho de teclado, e uma linha que só responde ao mouse é inacessível.
 */
export function Tr({
  children,
  className,
  onClick,
  label,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  /** Descrição da ação, lida por leitores de tela. */
  label?: string;
}) {
  if (!onClick) {
    return <tr className={cn('transition-colors hover:bg-navy-50/50', className)}>{children}</tr>;
  }

  return (
    <tr
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onClick();
      }}
      role="button"
      tabIndex={0}
      aria-label={label}
      className={cn(
        'cursor-pointer transition-colors hover:bg-navy-50/50',
        'focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-navy-600',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-ink-muted">
        {children}
      </td>
    </tr>
  );
}
