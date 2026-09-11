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

  cached = {
    mode,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceKey,
    storageBucket: readEnv('SUPABASE_STORAGE_BUCKET') ?? 'fiscal-files',
    organizationId: readEnv('ATTIVARE_ORGANIZATION_ID') ?? DEFAULT_ORGANIZATION_ID,
    authSecret: readEnv('ATTIVARE_AUTH_SECRET') ?? 'attivare-desenvolvimento-local',
    localAuthEmail: readEnv('ATTIVARE_AUTH_EMAIL') ?? 'auditor@attivare.local',
    localAuthPassword: readEnv('ATTIVARE_AUTH_PASSWORD') ?? 'attivare',
    maxUploadBytes: Number.isFinite(maxUpload) && maxUpload > 0 ? maxUpload : DEFAULT_MAX_UPLOAD_BYTES,
  };

  return cached;
}

/** True when the deployment still uses the development authentication secret. */
export function usingInsecureDefaults(): boolean {
  const env = appEnv();
  return env.mode === 'local' && readEnv('ATTIVARE_AUTH_SECRET') === null;
}
