import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page';
import { LinkButton } from '@/components/ui/button';
import { createCompanyAction } from '../actions';
import { BLANK_COMPANY, CompanyForm } from '../company-form';

export const metadata: Metadata = { title: 'Nova empresa' };

export default function NewCompanyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Cadastro"
        title="Nova empresa"
        description="O CNPJ informado aqui é o critério usado para bloquear a importação de arquivos de outro contribuinte."
        actions={
          <LinkButton href="/empresas" variant="secondary">
            Voltar
          </LinkButton>
        }
      />

      <Card className="max-w-4xl">
        <CardHeader title="Dados cadastrais" />
        <CardBody>
          <CompanyForm action={createCompanyAction} values={BLANK_COMPANY} submitLabel="Cadastrar empresa" />
        </CardBody>
      </Card>
    </>
  );
}
