'use server';

import { redirect } from 'next/navigation';
import { signIn, signOut } from '@/lib/auth/session';
import { submittedValues, type FormState } from '@/lib/ui/form-state';

export async function loginAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const values = submittedValues(formData, ['email']);
  if (email.trim() === '' || password === '') {
    return { error: 'Informe e-mail e senha.', values };
  }

  const result = await signIn(email, password);
  if (!result.ok) {
    return { error: result.message ?? 'Não foi possível autenticar.', values };
  }

  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}
