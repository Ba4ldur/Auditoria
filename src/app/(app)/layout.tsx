import { requireUser } from '@/lib/auth/guard';
import { appEnv } from '@/lib/config/env';
import { getStore } from '@/lib/data';
import { Sidebar } from '@/components/domain/sidebar';
import { Topbar } from '@/components/domain/topbar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const organization = await getStore().getOrganization();

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 lg:block">
        <Sidebar organizationName={organization.name} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} mode={appEnv().mode} organizationName={organization.name} />
        <main className="flex-1 px-6 py-6 xl:px-10">
          <div className="mx-auto w-full max-w-[92rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}
