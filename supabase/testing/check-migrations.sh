#!/usr/bin/env bash
#
# Confere as migrações contra um PostgreSQL descartável.
#
# Prova quatro coisas, nesta ordem:
#   1. a sequência completa aplica sem erro;
#   2. reaplicar a última migração não tem efeito (idempotência);
#   3. as colunas exigidas pela aplicação existem ao final;
#   4. a reversão da última migração desfaz exatamente o que ela criou.
#
# Uso:  supabase/testing/check-migrations.sh
# Requer: psql e um servidor acessível via PGHOST/PGPORT/PGUSER.
#
set -euo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/migrations"
STUBS="$(cd "$(dirname "$0")" && pwd)/00_supabase_stubs.sql"
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

echo "==> Reaplicando a última migração (idempotência)"
run -f "$MIGRATIONS_DIR/0005_fase3_xml_efd.sql"

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
    ('organization_settings','indicio_factor')
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

echo "==> Revertendo a 0005 e conferindo que as colunas somem"
run -f "$MIGRATIONS_DIR/0005_fase3_xml_efd.down.sql"
remaining=$(psql -d "$DB" -tAc "
  select count(*) from information_schema.columns
  where table_schema='public'
    and (   (table_name='audit_finding_evidence' and column_name in ('record_code','line_number','field_name','parser_version'))
         or (table_name='audit_findings' and column_name='rule_version')
         or (table_name='invoices' and column_name in ('purpose','extemporaneous','purpose_code','purpose_field','reform_taxes'))
         or (table_name='organization_settings' and column_name='indicio_factor'));")

if [ "$remaining" != "0" ]; then
  echo "FALHOU: a reversão deixou $remaining coluna(s) para trás."
  exit 1
fi
echo "    reversão completa"

echo "==> Reaplicando a 0005 depois da reversão"
run -f "$MIGRATIONS_DIR/0005_fase3_xml_efd.sql"

echo
echo "OK: migrações aplicam, são idempotentes, entregam o esquema exigido e revertem."
