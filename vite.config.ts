import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages のプロジェクトページはサブパス配信になる。
  // リポジトリ名を変更した場合はここも合わせること。
  base: '/wwa_puzzle/',

  // ソルバーは Web Worker 上で動く。ES モジュール形式で出力し、
  // `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`
  // が base を考慮したパスに解決されるようにする。
  worker: {
    format: 'es',
  },

  build: {
    target: 'es2022',
    sourcemap: true,
  },

  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
