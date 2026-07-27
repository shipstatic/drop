/**
 * Suite setup — hermeticity, and nothing else.
 *
 * Two things belong elsewhere and must stay there:
 *
 * - **`File.prototype` is never patched.** jsdom implements `File`/`Blob`
 *   faithfully, so fixtures build real Files with real bytes
 *   (`tests/fixtures/builders.ts`). Patching the prototype to serve canned
 *   content makes binary payloads inexpressible — fatal in a package whose
 *   subject is ZIP archives.
 * - **The console is not muted here.** `silent: 'passed-only'` in
 *   `vitest.config.ts` does it at the reporter level, so passing tests stay quiet
 *   while a FAILING test still prints everything it logged. A blanket
 *   `vi.spyOn(console, …)` would throw that diagnostic away on exactly the runs
 *   that need it.
 */

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

afterEach(cleanup);

/**
 * No outbound network, ever.
 *
 * Drop reaches the network only through `ship.getLimits()`, which every test
 * supplies via `shipStub`. If a real `Ship` ever leaks into a test, the SDK's
 * default API base is PRODUCTION — so this guard is what stands between a
 * missing stub and a live request from CI.
 */
beforeEach(() => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
    throw new Error(
      `Network access is not allowed in tests. Attempted fetch: ${url}\n` +
        'Supply platform limits with shipStub() from tests/fixtures/builders.ts.',
    );
  });
});
