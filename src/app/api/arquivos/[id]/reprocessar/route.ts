/**
 * Reprocessamento de um arquivo já importado (fase 2, requisito 13).
 *
 * Corrigimos um parser ou uma regra: o arquivo precisa poder ser reinterpretado
 * sem novo upload. O objeto armazenado é o mesmo — só a leitura é refeita, com
 * a versão de parser vigente.
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/guard';
import { describeError } from '@/lib/core/result';
import { getStore } from '@/lib/data';
import { reprocessFile } from '@/lib/pipeline/process';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const { id } = await context.params;
  const file = await getStore().getFile(id);
  if (!file) return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });

  try {
    const outcome = await reprocessFile(id);
    return NextResponse.json({
      ok: outcome.ok,
      reliability: outcome.file.reliability,
      parserVersion: outcome.file.parserVersion,
      status: outcome.file.status,
      message: outcome.message,
    });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
