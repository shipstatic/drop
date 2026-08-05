import { describe, expect, it } from 'vitest';
import { createProcessedFile, filePath, setRelativePath, stripCommonPrefix } from '../src/files';

/**
 * CAPABILITY TIER — real Chromium (`pnpm test:browser`).
 *
 * Drop's entire subject is what jsdom approximates: `File` bytes,
 * `webkitRelativePath`, directory entries, archive inflation. This tier
 * certifies everything constructible in a real browser.
 *
 * **The honest boundary.** A synthetic `DataTransfer` cannot produce genuine
 * `webkitGetAsEntry()` directory entries in ANY browser — Chromium included, and
 * not for want of trying: the entries come from a real user gesture over real OS
 * paths. So `traverseFileTree` has no real-runtime tier available and stays
 * covered by the recorded behavioral fake in `tests/fixtures/builders.ts`, whose
 * job is to model the spec (100-entry `readEntries` batching, fresh reader per
 * `createReader`) rather than a convenient answer. Everything below needs no
 * fake at all.
 */
describe('File in a real browser', () => {
  it('reads real bytes back', async () => {
    const file = new File(['<html>hi</html>'], 'index.html', { type: 'text/html' });

    expect(file.size).toBe(15);
    await expect(file.text()).resolves.toBe('<html>hi</html>');
  });

  it('preserves binary content byte-for-byte', async () => {
    // Load-bearing for a ZIP-handling package: a fixture layer that stores content
    // as a string cannot express this case at all.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const file = new File([bytes], 'logo.png', { type: 'image/png' });

    const roundTripped = new Uint8Array(await file.arrayBuffer());
    expect([...roundTripped]).toEqual([...bytes]);
  });

  it('preserves multi-byte text through arrayBuffer', async () => {
    const content = '日本語 — émoji 🚀';
    const file = new File([content], 'unicode.txt', { type: 'text/plain' });

    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe(content);
    // A multi-byte string is longer in bytes than in code units
    expect(file.size).toBeGreaterThan(content.length);
  });

  it('reports the MIME type the constructor was given, and empty when given none', () => {
    // This is why no MIME database is bundled: the browser answers for itself,
    // and the platform derives Content-Type server-side regardless.
    expect(new File(['x'], 'a.css', { type: 'text/css' }).type).toBe('text/css');
    expect(new File(['x'], 'a.map').type).toBe('');
  });
});

describe('webkitRelativePath as Chromium defines it', () => {
  it('is an empty string on a plain File, not undefined', () => {
    // The fallback in `filePath` depends on this being falsy-but-present, and
    // that fallback is what makes the FILES picker need no pipeline of its own:
    // a `webkitdirectory` input and a drop both hand over a path, a plain
    // `<input type="file">` hands over nothing, and all three converge here on
    // the same deploy path. Certified on the real platform object because this
    // is precisely the property jsdom only approximates.
    const file = new File(['x'], 'index.html');

    expect(file.webkitRelativePath).toBe('');
    expect(filePath(file)).toBe('index.html');
  });

  it('is read-only, which is why the package redefines the property', () => {
    const file = new File(['x'], 'index.html');

    // A plain assignment is silently ignored (non-strict) or throws (strict) —
    // either way it does NOT take, which is the whole reason setRelativePath
    // uses Object.defineProperty.
    try {
      (file as { webkitRelativePath: string }).webkitRelativePath = 'dist/index.html';
    } catch {
      // strict-mode TypeError is the expected alternative
    }
    expect(file.webkitRelativePath).toBe('');

    setRelativePath(file, 'dist/index.html');
    expect(file.webkitRelativePath).toBe('dist/index.html');
  });

  it('survives re-patching, so prefix stripping can rewrite it', () => {
    const file = new File(['x'], 'index.html');

    setRelativePath(file, 'my-site/index.html');
    setRelativePath(file, 'index.html');

    expect(file.webkitRelativePath).toBe('index.html');
  });

  it('carries the stripped deploy path after stripCommonPrefix', () => {
    // The drop→SDK handoff, certified on real Files: Ship reads this property
    // off the raw File objects.
    const files = ['dist/index.html', 'dist/css/app.css'].map((path) => {
      const file = new File(['body{}'], path.split('/').pop() as string);
      setRelativePath(file, path);
      return file;
    });

    stripCommonPrefix(files.map((f) => createProcessedFile(f)));

    expect(files.map((f) => f.webkitRelativePath)).toEqual(['index.html', 'css/app.css']);
  });
});

describe('createProcessedFile on real Files', () => {
  it('derives path, display name and size from the platform', () => {
    const file = new File(['body{}'], 'app.css', { type: 'text/css' });
    setRelativePath(file, 'assets/css/app.css');

    const processed = createProcessedFile(file);

    expect(processed.path).toBe('assets/css/app.css');
    expect(processed.name).toBe('app.css');
    expect(processed.size).toBe(6);
    expect(processed.type).toBe('text/css');
  });

  it('uses the real crypto.randomUUID for ids', () => {
    const id = createProcessedFile(new File(['x'], 'a.txt')).id;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
