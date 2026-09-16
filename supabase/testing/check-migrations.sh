#!/usr/bin/env bash
#
# Confere as migrações contra um PostgreSQL descartável.
#
# Prova cinco coisas, nesta ordem:
#   1. a sequência completa aplica sem erro;
#   2. reaplicar as duas últimas migrações não tem efeito (idempotência);
#   3. as colunas e tabelas exigidas pela aplicação existem ao final;
#   4. a reversão das duas últimas migrações desfaz exatamente o que criaram;
#   5. a política de RLS de `document_validations` isola por organização —
#      select, insert, update e delete — com um usuário real, não o
#      superusuário usado para aplicar as migrações.
#
# Uso:  supabase/testing/check-migrations.sh
# Requer: psql e um servidor acessível via PGHOST/PGPORT/PGUSER.
#
set -euo pipefail

TESTING_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$(cd "$TESTING_DIR/.." && pwd)/migrations"
STUBS="$TESTING_DIR/00_supabase_stubs.sql"
RLS_CHECK="$TESTING_DIR/check-document-validations-rls.sql"
DB="${ATTIVARE_TEST_DB:-attivare_migrations_check}"

run() { psql -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

echo "==> Recriando o banco $DB"
psql -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB;"
psql -d postgres -v ON_ERROR_STOP=1 -q -c "create database $DB;"

echo "==> Substitutos dos esquemas do Supabase"
run -f "$STUBS"

echo "==> Aplicando as migrações em ordem"
for file in "$MIGRATIONS_DIR"/[0-9]*.sql; do
  case "$file" in *.down.sql) continue ;; esac
  echo "    $(basename "$file")"
  run -f "$file"
done

echo "==> Reaplicando as duas últimas migrações (idempotência)"
run -f "$MIGRATIONS_DIR/0005_fase3_xml_efd.sql"
run -f "$MIGRATIONS_DIR/0006_fase4_validacao_tecnica.sql"

echo "==> Conferindo as colunas exigidas pela aplicação"
missing=$(psql -d "$DB" -tAc "
  with required(t, c) as (values
    ('audit_finding_evidence','record_code'),
    ('audit_finding_evidence','line_number'),
    ('audit_finding_evidence','field_name'),
    ('audit_finding_evidence','parser_version'),
    ('audit_findings','rule_version'),
    ('invoices','purpose'),
    ('invoices','extemporaneous'),
    ('invoices','purpose_code'),
    ('invoices','purpose_field'),
    ('invoices','reform_taxes'),
    ('organization_settings','indicio_factor'),
    ('document_validations','access_key'),
    ('document_validations','status'),
    ('document_validations','validated_by')
  )
  select t || '.' || c from required
  where not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name=t and column_name=c
  );")

if [ -n "$missing" ]; then
  echo "FALHOU: colunas ausentes após as migrações:"
  echo "$missing"
  exit 1
fi
echo "    todas presentes"

echo "==> Revertendo a 0006 e a 0005, conferindo que somem"
run -f "$MIGRATIONS_DIR/0006_fase4_validacao_tecnica.down.sql"
run -f "$MIGRATIONS_DIR/0005_fase3_xml_efd.down.sql"
remaining=$(psql -d "$DB" -tAc "
  select count(*) from information_schema.columns
  where table_schema='public'
    and (   (table_name='audit_finding_evidence' and column_name in ('record_code','line_number','field_name','parser_version'))
         or (table_name='audit_findings' and column_name='rule_version')
         or (table_name='invoices' and column_name in ('purpose','extemporaneous','purpose_code','purpose_field','reform_taxes'))
         or (table_name='organization_settings' and column_name='indicio_factor')
         or (table_name='document_validations'));")

if [ "$remaining" != "0" ]; then
  echo "FALHOU: a reversão deixou $remaining coluna(s) para trás."
  exit 1
fi
echo "    reversão completa"

echo "==> Reaplicando depois da reversão"
run -f "$MIGRATIONS_DIR/0005_fase3_xml_efd.sql"
run -f "$MIGRATIONS_DIR/0006_fase4_validacao_tecnica.sql"

echo "==> Conferindo RLS de document_validations com um usuário real"
run -f "$RLS_CHECK"

echo
echo "OK: migrações aplicam, são idempotentes, entregam o esquema exigido, revertem e a RLS de document_validations isola por organização."
