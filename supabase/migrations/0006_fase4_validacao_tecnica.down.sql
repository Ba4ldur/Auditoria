-- =============================================================================
-- Attivare Auditor — reversão da migração 0006
--
-- ADVERTÊNCIA — PERDA DE DADOS
--
-- `document_validations` guarda a conferência manual feita por pessoas durante
-- a validação técnica do motor: quem conferiu, quando e o que concluiu. É a
-- única prova de que a validação aconteceu, e não é reconstituível a partir de
-- nenhum outro dado — reprocessar arquivos não a traz de volta.
--
-- Exporte a tabela antes de reverter (`pg_dump -t public.document_validations`).
-- =============================================================================

drop index if exists public.document_validations_audit_idx;
drop table if exists public.document_validations;
drop type if exists document_validation_status;
