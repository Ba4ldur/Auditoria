/**
 * Environment configuration.
 *
 * The system runs in one of two persistence modes:
 *  - `supabase` when a Supabase project is configured;
 *  - `local` otherwise, which keeps everything under `.data/` and is intended
 *    for development and for the demonstration dataset.
 *
 * The mode is derived from the variables actually present, so a missing
 * credential degrades to local development instead of failing at runtime with
 * an opaque error.
 */

export type PersistenceMode = 'local' | 'supabase';

export interface AppEnv {
  readonly mode: PersistenceMode;
  readonly supabaseUrl: string | null;
  readonly supabaseAnonKey: string | null;
  readonly supabaseServiceKey: string | null;
  readonly storageBucket: string;
  readonly organizationId: string;
  readonly authSecret: string;
  readonly localAuthEmail: string;
  readonly localAuthPassword: string;
  readonly maxUploadBytes: number;
}

const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** Valores que só existem para desenvolvimento e nunca podem ir a produção. */
const DEVELOPMENT_AUTH_SECRET = 'attivare-desenvolvimento-local';
const DEVELOPMENT_AUTH_PASSWORD = 'attivare';
/** Comprimento mínimo exigido do segredo de sessão em produção. */
const MIN_AUTH_SECRET_LENGTH = 32;
/**
 * Fase em que o Next compila e pré-renderiza. `NODE_ENV` já é `production` aí,
 * mas a máquina de build não tem — nem deve ter — o segredo da instalação. A
 * trava vale para a inicialização do servidor, não para a compilação.
 */
const BUILD_PHASE = 'phase-production-build';

function readEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : null;
}

let cached: AppEnv | null = null;

export function appEnv(): AppEnv {
  if (cached) return cached;

  const supabaseUrl = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const supabaseAnonKey = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const supabaseServiceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  const forcedMode = readEnv('ATTIVARE_PERSISTENCE_MODE');

  const supabaseReady = Boolean(supabaseUrl && supabaseServiceKey);
  const mode: PersistenceMode =
    forcedMode === 'local' ? 'local' : forcedMode === 'supabase' || supabaseReady ? 'supabase' : 'local';

  if (mode === 'supabase' && !supabaseReady) {
    throw new Error(
      'Modo Supabase solicitado, mas NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY não estão definidos.',
    );
  }

  const maxUpload = Number(readEnv('ATTIVARE_MAX_UPLOAD_BYTES') ?? DEFAULT_MAX_UPLOAD_BYTES);
  const authSecret = readEnv('ATTIVARE_AUTH_SECRET');
  const localPassword = readEnv('ATTIVARE_AUTH_PASSWORD');

  assertProductionSecurity({ mode, authSecret, localPassword, phase: process.env.NEXT_PHASE ?? null });

  cached = {
    mode,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceKey,
    storageBucket: readEnv('SUPABASE_STORAGE_BUCKET') ?? 'fiscal-files',
    organizationId: readEnv('ATTIVARE_ORGANIZATION_ID') ?? DEFAULT_ORGANIZATION_ID,
    authSecret: authSecret ?? DEVELOPMENT_AUTH_SECRET,
    localAuthEmail: readEnv('ATTIVARE_AUTH_EMAIL') ?? 'auditor@attivare.local',
    localAuthPassword: localPassword ?? DEVELOPMENT_AUTH_PASSWORD,
    maxUploadBytes: Number.isFinite(maxUpload) && maxUpload > 0 ? maxUpload : DEFAULT_MAX_UPLOAD_BYTES,
  };

  return cached;
}

/**
 * Recusa a inicialização em produção com credenciais de desenvolvimento
 * (fase 2, requisito 21).
 *
 * Falhar no startup é deliberado: um sistema que guarda documentos fiscais não
 * pode subir com um segredo de sessão conhecido publicamente nem aceitar a
 * senha de demonstração. A mensagem diz exatamente o que corrigir.
 */
export function assertProductionSecurity(input: {
  mode: PersistenceMode;
  authSecret: string | null;
  localPassword: string | null;
  /** `process.env.NEXT_PHASE`. Durante o build não há startup a proteger. */
  phase?: string | null;
}): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (input.mode !== 'local') return;
  if ((input.phase ?? null) === BUILD_PHASE) return;

  const problems: string[] = [];

  if (input.authSecret === null || input.authSecret === DEVELOPMENT_AUTH_SECRET) {
    problems.push(
      'ATTIVARE_AUTH_SECRET não foi definido (ou usa o valor de desenvolvimento). ' +
        'Defina um valor aleatório e exclusivo desta instalação.',
    );
  } else if (input.authSecret.length < MIN_AUTH_SECRET_LENGTH) {
    problems.push(
      `ATTIVARE_AUTH_SECRET tem ${input.authSecret.length} caracteres; ` +
        `são exigidos ao menos ${MIN_AUTH_SECRET_LENGTH}.`,
    );
  }

  if (input.localPassword === null || input.localPassword === DEVELOPMENT_AUTH_PASSWORD) {
    problems.push(
      'ATTIVARE_AUTH_PASSWORD não foi definido (ou usa a senha de demonstração). ' +
        'A senha de demonstração nunca é aceita em produção.',
    );
  }

  if (problems.length === 0) return;

  throw new Error(
    'O Attivare Auditor não pode iniciar em produção com a autenticação local nesta configuração:\n' +
      problems.map((problem) => `  - ${problem}`).join('\n') +
      '\nCorrija as variáveis de ambiente ou configure o Supabase Auth ' +
      '(NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY).',
  );
}

/** True when the deployment still uses the development authentication secret. */
export function usingInsecureDefaults(): boolean {
  const env = appEnv();
  return env.mode === 'local' && readEnv('ATTIVARE_AUTH_SECRET') === null;
}
