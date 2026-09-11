/** Builds a normalised dataset from fixture files, exercising the real parsers. */

import { parseFile } from '@/lib/parsers';
import { buildDataset, type AuditDataset } from '@/lib/normalization/dataset';
import type { ParsedPayload } from '@/lib/parsers/types';
import type { Company } from '@/lib/domain/entities';
import type { TaxRegime } from '@/lib/domain/model';
import { DEMO_COMPANY } from '@/lib/demo/fixtures';

export function demoCompany(taxRegime: TaxRegime = 'SIMPLES_NACIONAL'): Company {
  return {
    id: 'company-1',
    organizationId: 'org-1',
    legalName: DEMO_COMPANY.legalName,
    tradeName: DEMO_COMPANY.tradeName,
    cnpj: DEMO_COMPANY.cnpj,
    stateRegistration: DEMO_COMPANY.stateRegistration,
    municipalRegistration: DEMO_COMPANY.municipalRegistration,
    uf: DEMO_COMPANY.uf,
    municipality: DEMO_COMPANY.municipality,
    taxRegime,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

export interface FixtureFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export function textFile(
  name: string,
  content: string,
  encoding: BufferEncoding = 'utf8',
): FixtureFile {
  return { name, bytes: new Uint8Array(Buffer.from(content, encoding)) };
}

export async function datasetFrom(
  files: readonly FixtureFile[],
  options: { competencia?: string; taxRegime?: TaxRegime } = {},
): Promise<AuditDataset> {
  const payloads: { payload: ParsedPayload; fileId: string; fileName: string }[] = [];

  for (const [index, file] of files.entries()) {
    const fileId = `file-${index + 1}`;
    const result = await parseFile(file.bytes, file.name, fileId);
    if (!result.ok) {
      throw new Error(`Falha ao processar fixture ${file.name}: ${result.error.message}`);
    }
    payloads.push({ payload: result.value, fileId, fileName: file.name });
  }

  return buildDataset({
    company: demoCompany(options.taxRegime),
    competencia: options.competencia ?? '2026-08',
    payloads,
  });
}
