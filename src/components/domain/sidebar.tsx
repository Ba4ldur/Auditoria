'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  ClipboardCheck,
  FileBarChart,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/ui/cn';

const NAVIGATION = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/empresas', label: 'Empresas', icon: Building2 },
  { href: '/auditorias', label: 'Auditorias', icon: ClipboardCheck },
  { href: '/importacoes', label: 'Importações', icon: Upload },
  { href: '/divergencias', label: 'Divergências', icon: ShieldAlert },
  { href: '/regras', label: 'Regras de Auditoria', icon: ScrollText },
  { href: '/relatorios', label: 'Relatórios', icon: FileBarChart },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
] as const;

export function Sidebar({ organizationName }: { organizationName: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegacao principal"
      className="no-print flex h-full w-full flex-col bg-navy-900 text-navy-100"
    >
      <div className="flex items-center gap-3 border-b border-white/8 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gold-500 text-base font-bold text-navy-950">
          A
        </span>
        <span className="leading-tight">
          <span className="block text-xs font-semibold tracking-[0.2em] text-white uppercase">
            Attivare
          </span>
          <span className="block text-[0.625rem] tracking-[0.28em] text-gold-400 uppercase">
            Auditor
          </span>
        </span>
      </div>

      <ul className="app-scroll flex-1 overflow-y-auto px-3 py-4">
        {NAVIGATION.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'mb-0.5 flex items-center gap-3 rounded-md px-3 py-2.5 text-[0.8125rem] transition-colors',
                  active
                    ? 'bg-white/10 font-semibold text-white shadow-[inset_2px_0_0_var(--color-gold-500)]'
                    : 'text-navy-200 hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon size={17} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-white/8 px-5 py-4">
        <p className="text-[0.625rem] tracking-[0.14em] text-navy-400 uppercase">Organização</p>
        <p className="mt-1 truncate text-xs font-medium text-navy-100">{organizationName}</p>
      </div>
    </nav>
  );
}
