import { createHash, randomUUID } from 'node:crypto';

/** SHA-256 of the original file bytes, used to detect duplicated uploads. */
export function sha256(data: Uint8Array | Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function newId(): string {
  return randomUUID();
}

/**
 * Deterministic UUID-shaped identifier derived from a seed.
 * Used by the demo dataset so repeated seeding is idempotent.
 */
export function deterministicId(seed: string): string {
  const digest = createHash('sha256').update(seed).digest('hex');
  const variant = ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
}
