import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  platform: 'browser',
  target: 'es2020',
  external: ['react', 'react-dom'],
  noExternal: ['mime-db', 'jszip'],
  treeshake: true,
  minify: false,
});
