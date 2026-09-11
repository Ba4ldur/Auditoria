import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { appEnv, usingInsecureDefaults } from '@/lib/config/env';
import { getCurrentUser } from '@/lib/auth/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  const env = appEnv();
  const local = env.mode === 'local';

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-navy-900 p-12 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(60rem 40rem at 12% 8%, rgba(198,160,82,0.16), transparent 60%),' +
              'radial-gradient(50rem 36rem at 90% 90%, rgba(44,91,135,0.5), transparent 65%)',
          }}
        />
        <div className="relative">
          <Wordmark />
        </div>
        <div className="relative max-w-lg">
          <h2 className="text-3xl leading-tight font-semibold">
            Auditoria fiscal com <span className="text-gold-400">evidência rastreável</span>.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-navy-200">
            Cruzamento automatizado entre XML de NF-e/NFC-e, EFD ICMS/IPI, EFD-Contribuições e PGDAS-D.
            Cada divergência apontada mostra de onde veio cada valor comparado.
          </p>
        </div>
        <p className="relative text-xs text-navy-300">
          Os arquivos fiscais permanecem em armazenamento privado e vinculados à organização.
        </p>
      </section>

      <section className="flex items-center justify-center bg-canvas px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark tone="dark" />
          </div>
          <h1 className="text-xl font-semibold text-ink">Acessar o sistema</h1>
          <p className="mt-1 mb-6 text-sm text-ink-muted">
            {local
              ? 'Ambiente local de desenvolvimento e demonstração.'
              : 'Autenticacao via Supabase Auth.'}
          </p>

          <LoginForm defaultEmail={local ? env.localAuthEmail : ''} />

          {local ? (
            <div className="mt-6 rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
              <p className="font-semibold">Modo local</p>
              <p className="mt-1">
                Credenciais definidas em <code className="font-mono">ATTIVARE_AUTH_EMAIL</code> e{' '}
                <code className="font-mono">ATTIVARE_AUTH_PASSWORD</code>.
                {usingInsecureDefaults()
                  ? ' Defina ATTIVARE_AUTH_SECRET antes de usar com dados reais.'
                  : ''}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Wordmark({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={
          'flex h-10 w-10 items-center justify-center rounded-md text-lg font-bold ' +
          (tone === 'light' ? 'bg-gold-500 text-navy-950' : 'bg-navy-800 text-gold-400')
        }
      >
        A
      </span>
      <span className="leading-tight">
        <span
          className={
            'block text-sm font-semibold tracking-[0.2em] uppercase ' +
            (tone === 'light' ? 'text-white' : 'text-ink')
          }
        >
          Attivare
        </span>
        <span
          className={
            'block text-[0.6875rem] tracking-[0.28em] uppercase ' +
            (tone === 'light' ? 'text-gold-400' : 'text-gold-600')
          }
        >
          Auditor
        </span>
      </span>
    </div>
  );
}
