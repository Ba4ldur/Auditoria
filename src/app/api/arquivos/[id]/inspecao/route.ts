/**
 * Inspeção técnica de um arquivo SPED (fase 2, requisitos 2 e 9).
 *
 * A leitura é feita sob demanda a partir do arquivo armazenado. Nada da
 * inspeção é duplicado no banco: um EFD com centenas de milhares de registros
 * seria pesado para guardar e ficaria desatualizado a cada correção do parser.
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/guard';
import { describeError } from '@/lib/core/result';
import { getStorage, getStore } from '@/lib/data';
import { decodeSped } from '@/lib/parsers/sped/reader';
import {
  DEFAULT_PAGE_SIZE,
  diagnoseC100,
  readSpedLine,
  readSpedPage,
  summariseSped,
  type SpedObligation,
} from '@/lib/parsers/sped/inspect';

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
      { error: 'A inspeção por registro está disponível apenas para arquivos SPED.' },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const registro = url.searchParams.get('registro');
  const linha = url.searchParams.get('linha');
  const pagina = Number(url.searchParams.get('pagina') ?? '1');
  const tamanho = Number(url.searchParams.get('tamanho') ?? String(DEFAULT_PAGE_SIZE));

  try {
    const content = decodeSped(await getStorage().get(file.storagePath));

    if (linha !== null) {
      const record = readSpedLine(content, obligation, Number(linha));
      if (!record) return NextResponse.json({ error: 'Linha não encontrada.' }, { status: 404 });
      return NextResponse.json({ record });
    }

    if (registro === 'C100_DIAGNOSTICO') {
      return NextResponse.json({ diagnostic: diagnoseC100(content, obligation) });
    }

    if (registro) {
      return NextResponse.json({
        page: readSpedPage(content, obligation, {
          code: registro,
          page: Number.isFinite(pagina) ? pagina : 1,
          pageSize: Number.isFinite(tamanho) ? tamanho : DEFAULT_PAGE_SIZE,
        }),
      });
    }

    return NextResponse.json({ summary: summariseSped(content, obligation) });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
