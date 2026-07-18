// defineConfig из 'vitest/config' — тот же vite-конфиг, но ключ `test`
// типизирован (из 'vite' он не входит в тип и жил только вне tsc-охвата).
import { defineConfig } from 'vitest/config';

// base './' — сборка работает с любого пути статического сервера
// (тот же принцип, что у прототипов ad-concepts) и внутри Capacitor WebView.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1600
  },
  test: {
    globals: true,
    environment: 'node'
  }
});
