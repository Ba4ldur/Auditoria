/**
 * Upload endpoint.
 *
 * Multipart upload is handled by a route handler rather than a server action so
 * the browser can send several large files in parallel and render per-file
 * progress and per-file errors (requirements 11 and 29).
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/guard';
import { describeError } from '@/lib/core/result';
import { getStore, getStorage } from '@/lib/data';
import { ingestUpload } from '@/lib/pipeline/upload';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const { id: auditId } = await context.params;
  const store = getStore();

  const audit = await store.getAudit(auditId);
  if (!audit) return NextResponse.json({ error: 'Auditoria não encontrada.' }, { status: 404 });
  if (audit.status === 'PROCESSANDO') {
    return NextResponse.json({ error: 'Auditoria em processamento.' }, { status: 409 });
  }

  const company = await store.getCompany(audit.companyId);
  if (!company) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    return NextResponse.json(
      { error: `Não foi possível ler o envio: ${describeError(error)}` },
      { status: 400 },
    );
  }

  const uploads = form.getAll('files').filter((entry): entry is File => entry instanceof File);
  if (uploads.length === 0) {
    return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
  }

  const results: { name: string; accepted: boolean; message: string }[] = [];

  for (const upload of uploads) {
    try {
      const bytes = new Uint8Array(await upload.arrayBuffer());
      const outcome = await ingestUpload({
        auditId,
        company,
        competencia: audit.competencia,
        fileName: upload.name,
        mimeType: upload.type || null,
        bytes,
      });
      results.push({ name: upload.name, accepted: outcome.accepted, message: outcome.message });
    } catch (error) {
      results.push({
        name: upload.name,
        accepted: false,
        message: `${upload.name}: ${describeError(error)}`,
      });
    }
  }

  return NextResponse.json({ results });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const { id: auditId } = await context.params;
  const fileId = new URL(request.url).searchParams.get('arquivo');
  if (!fileId) return NextResponse.json({ error: 'Arquivo não informado.' }, { status: 400 });

  const store = getStore();
  const file = await store.getFile(fileId);
  if (!file || file.auditId !== auditId) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
  }

  if (file.storagePath) {
    try {
      await getStorage().remove(file.storagePath);
    } catch {
      // The database row is the source of truth for the audit; a storage object
      // left behind is reported by the storage lifecycle, not by this request.
    }
  }
  await store.deleteFile(fileId);

  return NextResponse.json({ ok: true });
}
