import type { Metadata } from 'next';
import { getStore } from '@/lib/data';
import { SEVERITY_LABELS } from '@/lib/domain/entities';
import { AUDIT_MODULE_LABELS, sourceShortLabel } from '@/lib/domain/sources';
import { AUDIT_RULES } from '@/lib/audit-engine';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge, SEVERITY_TONES } from '@/components/ui/badge';
import { Notice, PageHeader } from '@/components/ui/page';
import { RuleSettingsForm } from './rule-settings-form';

export const metadata: Metadata = { title: 'Regras de Auditoria' };
export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const settings = await getStore().listRuleSettings();
  const byCode = new Map(settings.map((setting) => [setting.ruleCode, setting]));

  return (
    <>
      <PageHeader
        eyebrow="Motor de auditoria"
        title="Regras de Auditoria"
        description="Cada regra declara os documentos de que precisa, a gravidade padrão, a tolerância aplicada e — explicitamente — o que ela não e capaz de concluir sozinha."
      />

      <div className="mb-4">
        <Notice tone="info" title="Fato apurado x conclusão tributária">
          <p>
            O sistema determina automaticamente fatos aritméticos sobre os arquivos apresentados (por exemplo:
            a chave da NF-e não consta na EFD entregue). A conclusão de que aquele documento deveria
            obrigatoriamente estar escriturado naquele arquivo depende da natureza da operação e permanece
            sendo uma decisão do profissional responsável.
          </p>
        </Notice>
      </div>

      <div className="flex flex-col gap-4">
        {AUDIT_RULES.map((rule) => {
          const setting = byCode.get(rule.codigo);
          const enabled = setting?.enabled ?? true;

          return (
            <Card key={rule.codigo}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-navy-700">{rule.codigo}</span>
                    <span>{rule.nome}</span>
                  </span>
                }
                description={rule.descricao}
                action={
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={SEVERITY_TONES[setting?.severity ?? rule.gravidade]}>
                      {SEVERITY_LABELS[setting?.severity ?? rule.gravidade]}
                    </Badge>
                    <Badge tone="neutral">{AUDIT_MODULE_LABELS[rule.modulo]}</Badge>
                    <Badge tone={enabled ? 'success' : 'muted'}>{enabled ? 'Ativa' : 'Desativada'}</Badge>
                  </div>
                }
              />
              <CardBody className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <span className="font-medium text-ink">Documentos necessários:</span>
                  {rule.documentosNecessarios.map((source) => (
                    <Badge key={source} tone="muted">
                      {sourceShortLabel(source)}
                    </Badge>
                  ))}
                </div>

                <p className="rounded-md border border-gold-300 bg-gold-100/50 px-3 py-2 text-xs leading-relaxed text-ink">
                  <span className="font-semibold text-gold-700">Limitações: </span>
                  {rule.limitacoes}
                </p>

                <div className="border-t border-line pt-4">
                  <RuleSettingsForm
                    ruleCode={rule.codigo}
                    enabled={enabled}
                    severity={setting?.severity ?? null}
                    defaultSeverity={rule.gravidade}
                    absoluteTolerance={formatTolerance(
                      setting?.absoluteToleranceCents ?? rule.toleranciaPadrao.absoluteTolerance,
                    )}
                    percentageTolerance={String(
                      setting?.percentageTolerance ?? rule.toleranciaPadrao.percentageTolerance,
                    ).replace('.', ',')}
                  />
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function formatTolerance(valueInCents: number): string {
  return (valueInCents / 100).toFixed(2).replace('.', ',');
}
