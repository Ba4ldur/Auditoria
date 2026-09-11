/**
 * Authentication (requirement 27).
 *
 * Two backends, selected by the persistence mode:
 *  - `supabase`: credentials are verified by Supabase Auth and the session is
 *    the Supabase session cookie;
 *  - `local`: a single operator account defined by environment variables, with
 *    an HMAC-signed, HttpOnly session cookie. Intended for development and for
 *    the demonstration environment, never for production data.
 *
 * The check runs in the server layout and in every route handler, on the Node
 * runtime, so `node:crypto` is available and no secret ever reaches the client.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { appEnv } from '@/lib/config/env';

export const SESSION_COOKIE = 'attivare_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly organizationId: string;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createLocalSessionToken(email: string): string {
  const env = appEnv();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${Buffer.from(email).toString('base64url')}.${expiresAt}`;
  return `${payload}.${sign(payload, env.authSecret)}`;
}

function verifyLocalSessionToken(token: string): string | null {
  const env = appEnv();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedEmail, expiresAt, signature] = parts;
  if (!encodedEmail || !expiresAt || !signature) return null;

  const payload = `${encodedEmail}.${expiresAt}`;
  if (!safeEqual(signature, sign(payload, env.authSecret))) return null;
  if (Number(expiresAt) * 1000 < Date.now()) return null;

  return Buffer.from(encodedEmail, 'base64url').toString('utf8');
}

async function supabaseServerClient() {
  const env = appEnv();
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl!, env.supabaseAnonKey ?? env.supabaseServiceKey!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        for (const item of items) {
          cookieStore.set(item.name, item.value, item.options);
        }
      },
    },
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const env = appEnv();

  if (env.mode === 'supabase') {
    const client = await supabaseServerClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    const metadata = data.user.user_metadata as { full_name?: string; organization_id?: string };
    return {
      id: data.user.id,
      email: data.user.email ?? '',
      name: metadata.full_name ?? data.user.email ?? 'Usuário',
      organizationId: metadata.organization_id ?? env.organizationId,
    };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const email = verifyLocalSessionToken(token);
  if (!email) return null;

  return {
    id: 'local-operator',
    email,
    name: email.split('@')[0] ?? 'Auditor',
    organizationId: env.organizationId,
  };
}

export interface SignInResult {
  readonly ok: boolean;
  readonly message?: string;
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const env = appEnv();
  const normalizedEmail = email.trim().toLowerCase();

  if (env.mode === 'supabase') {
    const client = await supabaseServerClient();
    const { error } = await client.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error) return { ok: false, message: 'Credenciais inválidas.' };
    return { ok: true };
  }

  const expectedEmail = env.localAuthEmail.toLowerCase();
  const emailMatches = safeEqual(normalizedEmail.padEnd(64, '\0').slice(0, 64), expectedEmail.padEnd(64, '\0').slice(0, 64));
  const passwordMatches = safeEqual(password.padEnd(64, '\0').slice(0, 64), env.localAuthPassword.padEnd(64, '\0').slice(0, 64));
  if (!emailMatches || !passwordMatches) {
    return { ok: false, message: 'Credenciais inválidas.' };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createLocalSessionToken(normalizedEmail), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const env = appEnv();
  if (env.mode === 'supabase') {
    const client = await supabaseServerClient();
    await client.auth.signOut();
    return;
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
