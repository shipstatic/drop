import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, one config.
 *
 *   main     The whole suite in jsdom.        (`tests/**`)
 *   browser  Capability tier, real Chromium.  (`tests-browser/**`)
 *
 * `pnpm test` runs `main` only. The browser tier is opt-in via `test:browser`
 * and is where drop's subject is certified for real: a synthetic DataTransfer
 * cannot produce genuine `webkitGetAsEntry()` directory entries even in
 * Chromium, but real `File`/`Blob` bytes, `webkitRelativePath` semantics and
 * real ZIP inflation all can be — and jsdom only approximates them.
 */
export default defineConfig({
  test: {
    globals: true,
    // Mock hygiene as explicit config rather than per-file boilerplate: call
    // history clears before every test (an assertion can never pass on a
    // previous test's calls), and `vi.stubGlobal` — the one sanctioned way to
    // replace a global — is undone after every test.
    clearMocks: true,
    unstubGlobals: true,
    // Console policy lives HERE, not in per-file mute spies: passing tests stay
    // quiet, failing tests print everything they logged. Spies a test ASSERTS
    // on are still created locally.
    silent: 'passed-only',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/node_modules/**', '**/*.d.ts'],
      /**
       * A ratchet, set ~1 point below the 2026-07-27 measurement
       * (99.59 / 94.41 / 100 / 99.52). These only ever go up.
       *
       * The residual gaps are named rather than excluded, and are all defensive
       * `|| fallback` arms on `split('/').pop()` — unreachable while the input is
       * a non-empty path — plus `process.ts`'s final "No Valid Files" return,
       * which needs `canDeploy: true` with no ready files, no errors AND no
       * warnings, a combination `validateFiles` does not produce. Kept as
       * defence rather than deleted for coverage.
       *
       * NOTE: thresholds catch coverage DECAY. They cannot catch a test that
       * asserts nothing — a tautology neither raises nor lowers coverage. That
       * class is fenced by tests/architecture/test-integrity.test.ts.
       */
      thresholds: {
        statements: 99,
        branches: 93,
        functions: 99,
        lines: 99,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          environment: 'jsdom',
          include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
          setupFiles: ['tests/setup.ts'],
          testTimeout: 10000,
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['tests-browser/**/*.test.ts'],
          setupFiles: [],
          testTimeout: 30000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
