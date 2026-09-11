'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isValidCnpj, onlyDigits } from '@/lib/core/cnpj';
import { parseCompetencia } from '@/lib/core/competencia';
import { describeError } from '@/lib/core/result';
import { TAX_REGIMES } from '@/lib/domain/model';
import { UF_LIST } from '@/lib/core/nfe-key';
import { requireUser } from '@/lib/auth/guard';
import { getStore } from '@/lib/data';
import { submittedValues, type FormState } from '@/lib/ui/form-state';

const companySchema = z.object({
  legalName: z.string().trim().min(3, 'Informe a razão social.'),
  tradeName: z.string().trim().optional(),
  cnpj: z
    .string()
    .transform(onlyDigits)
    .refine((value) => isValidCnpj(value), 'CNPJ inválido (dígitos verificadores).'),
  stateRegistration: z.string().trim().optional(),
  municipalRegistration: z.string().trim().optional(),
  uf: z.string().trim().refine((value) => UF_LIST.includes(value), 'UF inválida.'),
  municipality: z.string().trim().optional(),
  taxRegime: z.enum(TAX_REGIMES as [string, ...string[]]),
});

function readCompany(formData: FormData) {
  return companySchema.safeParse({
    legalName: formData.get('legalName'),
    tradeName: formData.get('tradeName'),
    cnpj: formData.get('cnpj'),
    stateRegistration: formData.get('stateRegistration'),
    municipalRegistration: formData.get('municipalRegistration'),
    uf: formData.get('uf'),
    municipality: formData.get('municipality'),
    taxRegime: formData.get('taxRegime'),
  });
}

const COMPANY_FIELDS = [
  'legalName',
  'tradeName',
  'cnpj',
  'stateRegistration',
  'municipalRegistration',
  'uf',
  'municipality',
  'taxRegime',
] as const;

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const output: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !output[key]) output[key] = issue.message;
  }
  return output;
}

export async function createCompanyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const values = submittedValues(formData, COMPANY_FIELDS);
  const parsed = readCompany(formData);
  if (!parsed.success) {
    return {
      error: 'Corrija os campos destacados.',
      fieldErrors: fieldErrorsOf(parsed.error),
      values,
    };
  }

  const store = getStore();
  const existing = await store.findCompanyByCnpj(parsed.data.cnpj);
  if (existing) {
    return {
      error: `Já existe uma empresa cadastrada com este CNPJ: ${existing.legalName}.`,
      fieldErrors: { cnpj: 'CNPJ já cadastrado.' },
      values,
    };
  }

  let companyId: string;
  try {
    const company = await store.createCompany({
      legalName: parsed.data.legalName,
      tradeName: parsed.data.tradeName || null,
      cnpj: parsed.data.cnpj,
      stateRegistration: parsed.data.stateRegistration || null,
      municipalRegistration: parsed.data.municipalRegistration || null,
      uf: parsed.data.uf,
      municipality: parsed.data.municipality || null,
      taxRegime: parsed.data.taxRegime as (typeof TAX_REGIMES)[number],
    });
    companyId = company.id;
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath('/empresas');
  revalidatePath('/dashboard');
  redirect(`/empresas/${companyId}`);
}

export async function updateCompanyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const id = String(formData.get('id') ?? '');
  if (id === '') return { error: 'Empresa não identificada.' };

  const values = submittedValues(formData, COMPANY_FIELDS);
  const parsed = readCompany(formData);
  if (!parsed.success) {
    return {
      error: 'Corrija os campos destacados.',
      fieldErrors: fieldErrorsOf(parsed.error),
      values,
    };
  }

  try {
    await getStore().updateCompany(id, {
      legalName: parsed.data.legalName,
      tradeName: parsed.data.tradeName || null,
      cnpj: parsed.data.cnpj,
      stateRegistration: parsed.data.stateRegistration || null,
      municipalRegistration: parsed.data.municipalRegistration || null,
      uf: parsed.data.uf,
      municipality: parsed.data.municipality || null,
      taxRegime: parsed.data.taxRegime as (typeof TAX_REGIMES)[number],
    });
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath(`/empresas/${id}`);
  revalidatePath('/empresas');
  return { error: null, success: 'Cadastro atualizado.' };
}

export async function addRegimeHistoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const values = submittedValues(formData, ['taxRegime', 'validFrom', 'validTo', 'note']);
  const companyId = String(formData.get('companyId') ?? '');
  const taxRegime = String(formData.get('taxRegime') ?? '');
  const validFrom = parseCompetencia(String(formData.get('validFrom') ?? ''));
  const validToRaw = String(formData.get('validTo') ?? '').trim();
  const validTo = validToRaw === '' ? null : parseCompetencia(validToRaw);

  if (companyId === '') return { error: 'Empresa não identificada.' };
  if (!TAX_REGIMES.includes(taxRegime as (typeof TAX_REGIMES)[number])) {
    return { error: 'Regime tributário inválido.', values };
  }
  if (!validFrom) return { error: 'Informe a competência inicial no formato MM/AAAA.', values };
  if (validToRaw !== '' && !validTo) {
    return { error: 'Competência final inválida. Use o formato MM/AAAA.', values };
  }

  try {
    await getStore().addRegimeHistory({
      companyId,
      taxRegime: taxRegime as (typeof TAX_REGIMES)[number],
      validFrom,
      validTo,
      note: String(formData.get('note') ?? '').trim() || null,
    });
  } catch (error) {
    return { error: describeError(error), values };
  }

  revalidatePath(`/empresas/${companyId}`);
  return { error: null, success: 'Histórico de regime registrado.' };
}
