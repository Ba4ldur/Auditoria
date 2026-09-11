/**
 * Verificação executada uma única vez, quando o servidor sobe (fase 2,
 * requisito 21).
 *
 * `appEnv()` aplica a trava de produção. Chamá-la aqui faz a instalação mal
 * configurada falhar na inicialização, em vez de subir e só quebrar na primeira
 * requisição — ou, pior, subir assinando sessões com um segredo conhecido.
 *
 * Em produção o processo é encerrado com código 1: um servidor que não pode
 * atender com segurança precisa sair, para que o orquestrador não o considere
 * saudável. Fora de produção o erro apenas se propaga.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { appEnv } = await import('@/lib/config/env');

  try {
    appEnv();
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') throw error;
    console.error(error instanceof Error ? error.message : String(error));
    // Acesso indireto: este módulo também é compilado para o Edge Runtime, que
    // não expõe `process.exit`. O guarda de runtime acima já impede a chamada.
    const halt = (process as { exit?: (code: number) => never })['exit'];
    if (halt) halt(1);
  }
}
