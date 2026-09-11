/**
 * Tipos compartilhados entre o painel de confirmação (componente de cliente) e
 * a página que o alimenta. Mantidos à parte para que o componente de cliente
 * não importe módulos de servidor.
 */

export type { ExtractionConfidence } from '@/lib/domain/model';
export type { FieldConfirmation } from '@/lib/domain/entities';
