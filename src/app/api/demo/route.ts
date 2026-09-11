/**
 * Loads the demonstration dataset.
 *
 * Exposed as an endpoint rather than a CLI script so it runs inside the
 * application runtime and exercises exactly the same pipeline a real upload
 * goes through.
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/guard';
import { describeError } from '@/lib/core/result';
import { seedDemoData } from '@/lib/demo/seed';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const result = await seedDemoData();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
