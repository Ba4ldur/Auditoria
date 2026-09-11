/**
 * Runs the audit pipeline for one audit.
 *
 * Kept as an explicit endpoint so that moving execution to a background worker
 * later is a change of caller, not a change of architecture (requirement 30).
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/guard';
import { describeError } from '@/lib/core/result';
import { getStore } from '@/lib/data';
import { processAudit } from '@/lib/pipeline/process';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const { id } = await context.params;
  const store = getStore();
  const audit = await store.getAudit(id);
  if (!audit) return NextResponse.json({ error: 'Auditoria não encontrada.' }, { status: 404 });

  const files = await store.listFiles(id);
  if (files.length === 0) {
    return NextResponse.json(
      { error: 'Importe ao menos um arquivo antes de iniciar a auditoria.' },
      { status: 400 },
    );
  }

  try {
    const outcome = await processAudit(id);
    return NextResponse.json({
      ok: true,
      score: outcome.engine.score.score,
      band: outcome.engine.score.band,
      summary: outcome.engine.summary,
      processedFiles: outcome.processedFiles,
      failedFiles: outcome.failedFiles,
      skippedFiles: outcome.skippedFiles,
    });
  } catch (error) {
    await store.updateAudit(id, { status: 'ERRO', finishedAt: new Date().toISOString() });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
