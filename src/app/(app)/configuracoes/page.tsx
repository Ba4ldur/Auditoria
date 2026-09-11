import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { appEnv, usingInsecureDefaults } from '@/lib/config/env';
import { formatIsoDateTime } from '@/lib/core/dates';
import { ACCEPTED_EXTENSIONS } from '@/lib/pipeline/upload';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { Notice, PageHeader } from '@/components/ui/page';
import { ScoreWeightsForm } from './settings-forms';
import { SeedDemoButton } from '@/components/domain/seed-demo-button';

export const metadata: Metadata = { title: 'Configurações' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const store = getStore();
  const [organization, settings] = await Promise.all([store.getOrganization(), store.getSettings()]);
  const env = appEnv();

  return (
    <>
      <PageHeader
        eyebrow="Administracao"
        title="Configurações"
        description="Parâmetros que alteram o comportamento do motor de auditoria e o ambiente de execução."
      />

      {usingInsecureDefaults() ? (
        <div className="mb-4">
          <Notice tone="warning" title="Segredo de sessão padrão em uso">
            Defina <code className="font-mono">ATTIVARE_AUTH_SECRET</code> antes de utilizar o sistema com
            documentos fiscais reais. Sem essa variável, o cookie de sessão e assinado com um segredo
            conhecido.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Pesos do score de conformidade"
            description="O score parte de 100 e desconta o peso de cada ocorrência que exige ação, conforme a gravidade. Nunca fica abaixo de zero."
          />
          <CardBody>
            <ScoreWeightsForm weights={settings.scoreWeights} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Política de Receita"
            description="Define, por CFOP, quais operações compõem a receita apurada pelos documentos fiscais."
          />
          <CardBody className="flex flex-col gap-4">
            <Notice tone="info">
              O sistema não decide sozinho quais operações integram a receita bruta. CFOP sem classificação
              fica em <strong>revisão</strong>: o documento aparece com o valor, separado do faturamento
              considerado, até que a decisão seja registrada.
            </Notice>
            <div>
              <LinkButton href="/configuracoes/politica-receita" variant="secondary">
                Abrir Política de Receita
              </LinkButton>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Ambiente" description="Configuração efetiva desta instalacao." />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Row label="Organização" value={organization.name} />
              <Row label="Identificador" value={organization.id} mono />
              <Row
                label="Persistencia"
                value={env.mode === 'supabase' ? 'Supabase / PostgreSQL' : 'Arquivo local (.data)'}
              />
              <Row
                label="Armazenamento de arquivos"
                value={env.mode === 'supabase' ? `Bucket privado "${env.storageBucket}"` : 'Diretorio .data/storage'}
              />
              <Row
                label="Limite por arquivo"
                value={`${Math.floor(env.maxUploadBytes / (1024 * 1024))} MB`}
              />
              <Row label="Extensões aceitas" value={ACCEPTED_EXTENSIONS.join(', ')} />
              <Row label="Atualizado em" value={formatIsoDateTime(settings.updatedAt)} />
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone={env.mode === 'supabase' ? 'success' : 'warning'}>
                {env.mode === 'supabase' ? 'Modo producao' : 'Modo local'}
              </Badge>
              <Badge tone="muted">Arquivos nunca expostos publicamente</Badge>
              <Badge tone="muted">Isolamento por organização</Badge>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Dados de demonstração"
            description="Cria a empresa fictícia COMERCIAL DEMONSTRAÇÃO LTDA e uma auditoria com inconsistências propositais."
          />
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm text-ink-muted">
              Os arquivos são gerados pelo próprio sistema e processados pelo mesmo pipeline de uma importação
              real: upload, identificação, parsing, normalização e motor de regras. Nenhum CNPJ ou dado de
              cliente real e utilizado.
            </p>
            <SeedDemoButton />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Segurança dos arquivos fiscais"
            description="Como os documentos importados são tratados."
          />
          <CardBody>
            <ul className="flex flex-col gap-2 text-sm text-ink-muted">
              <li>Autenticacao obrigatória em todas as telas e endpoints.</li>
              <li>Cada registro é vinculado à organização; no Supabase o isolamento é imposto por RLS.</li>
              <li>
                Bucket privado; o download passa por endpoint autenticado que gera URL temporária de 60
                segundos.
              </li>
              <li>Validação de extensão e de tamanho antes de qualquer leitura do conteudo.</li>
              <li>Hash SHA-256 de cada arquivo, usado para detectar reenvio do mesmo documento.</li>
              <li>Arquivos de CNPJ diferente do cadastrado são bloqueados e não entram nos cruzamentos.</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[0.625rem] tracking-[0.08em] text-ink-subtle uppercase">{label}</dt>
      <dd className={'mt-0.5 text-sm text-ink ' + (mono ? 'font-mono text-xs break-all' : '')}>{value}</dd>
    </div>
  );
}
