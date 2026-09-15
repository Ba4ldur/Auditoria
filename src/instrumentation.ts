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
    return;
  }

  await reportSchemaState();
}

/**
 * Confere o esquema do banco na subida, em modo `supabase`.
 *
 * Não derruba o processo: banco desatualizado é problema de implantação, não de
 * segurança, e um servidor que sobe e avisa é mais útil do que um que se recusa
 * a subir. O que não se admite é o silêncio — sem este aviso, a instalação só
 * descobre o problema quando a primeira auditoria falha ao gravar evidências.
 */
async function reportSchemaState(): Promise<void> {
  const { appEnv } = await import('@/lib/config/env');
  const env = appEnv();
  if (env.mode !== 'supabase') return;

  try {
    const { checkSchema, createSchemaCheckClient, describeSchemaCheck } = await import(
      '@/lib/data/schema-check'
    );

    const client = createSchemaCheckClient(env.supabaseUrl!, env.supabaseServiceKey!);
    const check = await checkSchema(client);
    if (check.upToDate) return;
    console.error(describeSchemaCheck(check));
  } catch (error) {
    console.warn(
      'Não foi possível conferir o esquema do banco na inicialização: ' +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
