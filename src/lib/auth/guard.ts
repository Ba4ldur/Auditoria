import { redirect } from 'next/navigation';
import { getCurrentUser, type SessionUser } from './session';

/** Server-side guard for pages. Redirects to the sign-in screen when absent. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** Guard for route handlers: returns `null` instead of redirecting. */
export async function requireApiUser(): Promise<SessionUser | null> {
  return getCurrentUser();
}
