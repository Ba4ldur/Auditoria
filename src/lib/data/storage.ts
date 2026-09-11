/**
 * File storage port.
 *
 * Fiscal files are confidential (requirement 27), so:
 *  - the Supabase bucket is private and access is granted only through
 *    short-lived signed URLs;
 *  - the local adapter keeps files under `.data/storage`, outside the public
 *    directory, and serves them through an authenticated route handler.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface FileStorage {
  readonly kind: 'local' | 'supabase';
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  /** Time-limited URL, or `null` when the adapter streams through the app. */
  signedUrl(path: string, expiresInSeconds: number): Promise<string | null>;
}

export class LocalFileStorage implements FileStorage {
  readonly kind = 'local' as const;

  constructor(private readonly root: string) {}

  private resolve(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.includes('..')) throw new Error('Caminho de arquivo inválido.');
    return join(this.root, normalized);
  }

  async put(path: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolve(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async get(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(path)));
  }

  async remove(path: string): Promise<void> {
    await rm(this.resolve(path), { force: true });
  }

  async signedUrl(): Promise<string | null> {
    return null;
  }
}

export class SupabaseFileStorage implements FileStorage {
  readonly kind = 'supabase' as const;

  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`Falha ao enviar arquivo para o storage: ${error.message}`);
  }

  async get(path: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) throw new Error(`Falha ao ler arquivo do storage: ${error?.message ?? path}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([path]);
    if (error) throw new Error(`Falha ao remover arquivo do storage: ${error.message}`);
  }

  async signedUrl(path: string, expiresInSeconds: number): Promise<string | null> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw new Error(`Falha ao gerar URL temporária: ${error?.message ?? path}`);
    return data.signedUrl;
  }
}

export function createSupabaseServiceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function storagePathFor(auditId: string, fileId: string, originalName: string): string {
  const safeName = originalName.replace(/[^\w.\-]+/g, '_').slice(-80);
  return `audits/${auditId}/${fileId}-${safeName}`;
}
