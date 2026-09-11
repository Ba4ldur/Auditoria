/**
 * Authenticated download of an original fiscal file.
 *
 * With Supabase Storage the response is a redirect to a short-lived signed URL;
 * with the local adapter the bytes are streamed by the application. In neither
 * case is the object publicly reachable (requirement 27).
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/guard';
import { describeError } from '@/lib/core/result';
import { getStorage, getStore } from '@/lib/data';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 60;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const { id } = await context.params;
  const file = await getStore().getFile(id);
  if (!file || !file.storagePath) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
  }

  const storage = getStorage();

  try {
    const signed = await storage.signedUrl(file.storagePath, SIGNED_URL_TTL_SECONDS);
    if (signed) return NextResponse.redirect(signed);

    const bytes = await storage.get(file.storagePath);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': file.mimeType ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.originalName)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
