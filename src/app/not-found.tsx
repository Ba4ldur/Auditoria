import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="max-w-md text-center">
        <p className="text-[0.6875rem] font-semibold tracking-[0.2em] text-gold-600 uppercase">
          Attivare Auditor
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Página não encontrada</h1>
        <p className="mt-2 text-sm text-ink-muted">
          O endereco acessado não existe ou o registro foi removido.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-9.5 items-center rounded-md bg-navy-800 px-4 text-sm font-medium text-white hover:bg-navy-700"
        >
          Voltar ao dashboard
        </Link>
      </div>
    </main>
  );
}
