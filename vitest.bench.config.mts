import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Configuração separada para o benchmark sintético (fase 4, item 10).
 *
 * Fica fora de `vitest.config.mts` de propósito: o benchmark processa dezenas
 * de milhares de documentos e leva minutos, o que seria inaceitável dentro do
 * ciclo normal de `npm test` / `npm run verify`. Roda só sob pedido explícito,
 * via `npm run bench`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/benchmark/**/*.bench.ts'],
    passWithNoTests: false,
    // 50.000 documentos, ponta a ponta, síncrono: precisa de folga real.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // Um processo por vez: o benchmark mede tempo de parede, e workers
    // concorrentes do próprio Vitest disputando CPU distorceriam a medição.
    fileParallelism: false,
  },
});
