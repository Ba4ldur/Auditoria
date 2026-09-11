'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import {
  FINDING_STATUS_LABELS,
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
} from '@/lib/domain/entities';
import { AUDIT_MODULE_LABELS } from '@/lib/domain/sources';
import { AUDIT_RULES } from '@/lib/audit-engine';

export interface FilterValues {
  readonly severity: string;
  readonly module: string;
  readonly ruleCode: string;
  readonly reviewStatus: string;
  readonly status: string;
  readonly search: string;
  readonly auditId: string;
}

const FINDING_STATUSES = Object.keys(FINDING_STATUS_LABELS) as (keyof typeof FINDING_STATUS_LABELS)[];
const MODULES = Object.keys(AUDIT_MODULE_LABELS) as (keyof typeof AUDIT_MODULE_LABELS)[];

/**
 * Filters submit as a plain GET form, so the resulting list is a shareable URL
 * and every control keeps working without client-side state.
 */
export function FindingFilters({ values }: { values: FilterValues }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} method="get" className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {values.auditId ? <input type="hidden" name="auditoria" value={values.auditId} /> : null}

      <Field label="Gravidade" htmlFor="filtro-gravidade">
        <Select id="filtro-gravidade" name="gravidade" defaultValue={values.severity}>
          <option value="">Todas</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {SEVERITY_LABELS[severity]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Módulo" htmlFor="filtro-modulo">
        <Select id="filtro-modulo" name="modulo" defaultValue={values.module}>
          <option value="">Todos</option>
          {MODULES.map((module) => (
            <option key={module} value={module}>
              {AUDIT_MODULE_LABELS[module]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Regra" htmlFor="filtro-regra">
        <Select id="filtro-regra" name="regra" defaultValue={values.ruleCode}>
          <option value="">Todas</option>
          {AUDIT_RULES.map((rule) => (
            <option key={rule.codigo} value={rule.codigo}>
              {rule.codigo}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Resultado" htmlFor="filtro-resultado">
        <Select id="filtro-resultado" name="resultado" defaultValue={values.status}>
          <option value="">Todos</option>
          {FINDING_STATUSES.map((status) => (
            <option key={status} value={status}>
              {FINDING_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Situação da análise" htmlFor="filtro-analise">
        <Select id="filtro-analise" name="analise" defaultValue={values.reviewStatus}>
          <option value="">Todas</option>
          {REVIEW_STATUSES.map((status) => (
            <option key={status} value={status}>
              {REVIEW_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Documento / texto" htmlFor="filtro-busca">
        <Input
          id="filtro-busca"
          name="busca"
          defaultValue={values.search}
          placeholder="Chave, titulo..."
        />
      </Field>

      <div className="flex items-end gap-2 md:col-span-3 xl:col-span-6">
        <Button type="submit" size="sm">
          Aplicar filtros
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            formRef.current?.reset();
            window.location.href = values.auditId
              ? `/divergencias?auditoria=${values.auditId}`
              : '/divergencias';
          }}
        >
          Limpar
        </Button>
      </div>
    </form>
  );
}
