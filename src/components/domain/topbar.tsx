import { LogOut } from 'lucide-react';
import { logoutAction } from '@/app/login/actions';
import type { SessionUser } from '@/lib/auth/session';
import type { PersistenceMode } from '@/lib/config/env';
import { Badge } from '@/components/ui/badge';
import { MobileNav } from './mobile-nav';

export function Topbar({
  user,
  mode,
  organizationName,
}: {
  user: SessionUser;
  mode: PersistenceMode;
  organizationName: string;
}) {
  return (
    <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-line bg-surface/95 px-6 backdrop-blur">
      <div className="flex items-center gap-3">
        <MobileNav organizationName={organizationName} />
        <Badge tone={mode === 'supabase' ? 'success' : 'warning'}>
          {mode === 'supabase' ? 'Supabase' : 'Armazenamento local'}
        </Badge>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right leading-tight">
          <p className="text-xs font-semibold text-ink">{user.name}</p>
          <p className="text-[0.6875rem] text-ink-subtle">{user.email}</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex h-9 items-center gap-2 rounded-md border border-line-strong px-3 text-xs font-medium text-navy-700 transition-colors hover:bg-navy-50"
          >
            <LogOut size={14} aria-hidden />
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}
