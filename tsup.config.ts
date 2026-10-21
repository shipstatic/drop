import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  platform: 'browser',
  // The browsers ShipStatic's sites support: Safari and iOS 15.4, and the
  // Chrome, Edge and Firefox of early 2022, the first with CSS cascade layers,
  // which the sites' Tailwind CSS needs (scripts/check-browsers.sh holds
  // every site's copy equal). Syntax a target lacks is lowered; a regex
  // feature cannot be, so esbuild's report of one fails the build instead of
  // turning it into a `new RegExp` that throws in that browser.
  target: ['chrome99', 'edge99', 'firefox97', 'safari15.4', 'ios15.4'],
  esbuildOptions(options) {
    options.logOverride = { 'unsupported-regexp': 'error' };
    // Unicode property escapes (`/\p{Lu}/u`) run on the whole floor (Chrome 64,
    // Safari 11.1, Firefox 78). esbuild counts a browser as supporting them only
    // once it knows the newest Unicode version's properties (16.0 and 17.0 in
    // esbuild 0.25's table), which no shipping browser does yet, so it refuses
    // them for every browser. Declared here; every other regex feature stays
    // refused. What this lets through is a property name newer than a browser's
    // Unicode data, a SyntaxError there; the dependencies use only old ones.
    options.supported = { 'regexp-unicode-property-escapes': true };
  },
  external: ['react', 'react-dom'],
  noExternal: ['fflate'],
  treeshake: true,
  minify: false,
});
