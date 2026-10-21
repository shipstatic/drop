import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  platform: 'browser',
  // The browsers ShipStatic's sites support: Safari and iOS 15, and the
  // Chrome, Edge and Firefox of late 2021 (scripts/check-browsers.sh holds
  // every site's copy equal). Syntax a target lacks is lowered; a regex
  // feature cannot be, so esbuild's report of one fails the build instead of
  // turning it into a `new RegExp` that throws in that browser.
  target: ['chrome96', 'edge96', 'firefox95', 'safari15', 'ios15'],
  esbuildOptions(options) {
    options.logOverride = { 'unsupported-regexp': 'error' };
    // Unicode property escapes (`/\p{Lu}/u`) run in every browser on the floor
    // (Chrome 64, Safari 11.1, Firefox 78), but esbuild 0.25's browser table
    // refuses them for EVERY browser version, Chrome 135 and Safari 26 included,
    // while accepting them for es2018 and later (measured 2026-10-21). So the
    // floor declares them, and every other regex feature stays refused.
    options.supported = { 'regexp-unicode-property-escapes': true };
  },
  external: ['react', 'react-dom'],
  noExternal: ['fflate'],
  treeshake: true,
  minify: false,
});
