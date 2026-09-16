/**
 * Inspeção de um C100 com os registros que pertencem a ele (fase 4).
 *
 * A leitura é sob demanda, a partir do arquivo armazenado. Nada é duplicado no
 * banco: o que se quer conferir aqui é **a linha original do arquivo ao lado da
 * leitura do parser**, e guardar uma cópia derivada derrotaria o propósito —
 * ficaria desatualizada a cada correção do parser, e a conferência passaria a
 * validar a cópia, não o arquivo.
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/guard';
import { describeError } from '@/lib/core/result';
import { getStorage, getStore } from '@/lib/data';
import { decodeSped } from '@/lib/parsers/sped/reader';
import { readC100Document, type SpedObligation } from '@/lib/parsers/sped/inspect';

export const runtime = 'nodejs';
export const maxDuration = 120;

function obligationOf(source: string | null): SpedObligation | null {
  return source === 'EFD_ICMS_IPI' || source === 'EFD_CONTRIBUICOES' ? source : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const { id } = await context.params;
  const file = await getStore().getFile(id);
  if (!file || !file.storagePath) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
  }

  const obligation = obligationOf(file.detectedSource);
  if (!obligation) {
    return NextResponse.json(
      { error: 'A inspeção de documento está disponível apenas para arquivos SPED.' },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const chave = url.searchParams.get('chave');
  const linha = url.searchParams.get('linha');

  if (!chave && !linha) {
    return NextResponse.json(
      { error: 'Informe a chave de acesso ou o número da linha do registro C100.' },
      { status: 400 },
    );
  }

  try {
    const content = decodeSped(await getStorage().get(file.storagePath));
    const document = readC100Document(content, obligation, {
      chave: chave ?? undefined,
      linha: linha === null ? undefined : Number(linha),
    });

    if (!document) {
      return NextResponse.json(
        { error: 'Nenhum registro C100 correspondente foi encontrado neste arquivo.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ document, fileName: file.originalName });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
