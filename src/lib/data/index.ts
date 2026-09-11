/**
 * Store and storage factories.
 *
 * Both are process-level singletons: the local adapter caches the database in
 * memory and the Supabase client keeps a connection pool, so creating them per
 * request would be wasteful and, for the local adapter, incorrect.
 */

import { join } from 'node:path';
import { appEnv } from '@/lib/config/env';
import { LocalStore, localStorePath } from './local-store';
import { SupabaseStore } from './supabase-store';
import {
  LocalFileStorage,
  SupabaseFileStorage,
  createSupabaseServiceClient,
  type FileStorage,
} from './storage';
import type { DataStore } from './types';

/**
 * The singletons are hung off `globalThis` because Next.js keeps separate
 * module graphs for route handlers, server components and server actions:
 * a module-level variable would produce one store per graph.
 */
const registry = globalThis as typeof globalThis & {
  __attivareStore?: DataStore;
  __attivareStorage?: FileStorage;
};

export function getStore(): DataStore {
  if (registry.__attivareStore) return registry.__attivareStore;
  const env = appEnv();
  let storeInstance: DataStore;

  if (env.mode === 'supabase') {
    const client = createSupabaseServiceClient(env.supabaseUrl!, env.supabaseServiceKey!);
    storeInstance = new SupabaseStore(client, env.organizationId);
  } else {
    storeInstance = new LocalStore(localStorePath());
  }

  registry.__attivareStore = storeInstance;
  return storeInstance;
}

export function getStorage(): FileStorage {
  if (registry.__attivareStorage) return registry.__attivareStorage;
  const env = appEnv();
  let storageInstance: FileStorage;

  if (env.mode === 'supabase') {
    const client = createSupabaseServiceClient(env.supabaseUrl!, env.supabaseServiceKey!);
    storageInstance = new SupabaseFileStorage(client, env.storageBucket);
  } else {
    storageInstance = new LocalFileStorage(join(process.cwd(), '.data', 'storage'));
  }

  registry.__attivareStorage = storageInstance;
  return storageInstance;
}

export type { DataStore } from './types';
export * from './types';
export { storagePathFor } from './storage';
