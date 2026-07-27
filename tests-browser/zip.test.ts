import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { processFiles } from '../src/process';
import { extractZipToFiles } from '../src/zip';

/**
 * CAPABILITY TIER — real Chromium (`pnpm test:browser`).
 *
 * ZIP extraction end-to-end on real bytes in a real browser: fflate's
 * worker-backed `unzip`, real `File` construction, real `arrayBuffer()`. This is
 * the tier that proves the async inflation path actually resolves off the main
 * thread rather than merely compiling.
 */
function zipOf(entries: Record<string, Uint8Array | string>, name = 'site.zip'): File {
  const packed = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, body]) => [
        path,
        typeof body === 'string' ? strToU8(body) : body,
      ]),
    ),
  );
  return new File([new Uint8Array(packed)], name, { type: 'application/zip' });
}

const GENEROUS = {
  maxFileSize: 100 * 1024 * 1024,
  maxFilesCount: 10_000,
  maxTotalSize: 500 * 1024 * 1024,
};

describe('extractZipToFiles in a real browser', () => {
  it('inflates a real archive asynchronously', async () => {
    const { files, errors } = await extractZipToFiles(
      zipOf({ 'index.html': '<html>hi</html>', 'css/app.css': 'body{}' }),
    );

    expect(errors).toEqual([]);
    expect(files.map((f) => f.webkitRelativePath).sort()).toEqual(['css/app.css', 'index.html']);
    await expect(files.find((f) => f.name === 'index.html')?.text()).resolves.toBe(
      '<html>hi</html>',
    );
  });

  it('round-trips binary entries byte-for-byte', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x7f]);
    const { files } = await extractZipToFiles(zipOf({ 'logo.png': png }));

    const extracted = new Uint8Array(await files[0].arrayBuffer());
    expect([...extracted]).toEqual([...png]);
  });

  it('gives each entry its own backing buffer', async () => {
    // fflate shares backing buffers across entries; without the explicit copy in
    // extractZipToFiles the Files would alias each other's bytes.
    const { files } = await extractZipToFiles(
      zipOf({ 'a.txt': 'a'.repeat(64), 'b.txt': 'b'.repeat(64) }),
    );

    const byName = Object.fromEntries(files.map((f) => [f.name, f]));
    await expect(byName['a.txt'].text()).resolves.toBe('a'.repeat(64));
    await expect(byName['b.txt'].text()).resolves.toBe('b'.repeat(64));
  });

  it('preserves multi-byte filenames and content', async () => {
    const { files } = await extractZipToFiles(zipOf({ '日本語/ファイル.txt': 'こんにちは' }));

    expect(files[0].webkitRelativePath).toBe('日本語/ファイル.txt');
    await expect(files[0].text()).resolves.toBe('こんにちは');
  });

  it('inflates a many-entry archive without blocking to failure', async () => {
    const entries: Record<string, string> = { 'index.html': '<html>' };
    for (let i = 0; i < 300; i++) entries[`assets/file-${i}.txt`] = `content ${i}`;

    const { files, errors } = await extractZipToFiles(zipOf(entries));

    expect(errors).toEqual([]);
    expect(files).toHaveLength(301);
  });

  it('reports a corrupt archive as an error result', async () => {
    const { files, errors } = await extractZipToFiles(
      new File(['definitely not a zip'], 'broken.zip', { type: 'application/zip' }),
    );

    expect(files).toEqual([]);
    expect(errors[0]).toContain('Failed to load ZIP file');
  });
});

describe('the pipeline on real browser primitives', () => {
  it('takes a real ZIP through to a ready verdict', async () => {
    const outcome = await processFiles(
      [
        zipOf(
          { 'dist/index.html': '<html>hi</html>', 'dist/app.js': 'console.log(1)' },
          'my-site.zip',
        ),
      ],
      { limits: GENEROUS },
    );

    expect(outcome.phase).toBe('ready');
    expect(outcome.sourceName).toBe('my-site');
    expect(outcome.files.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);
    expect(outcome.files.filter((f) => f.status === 'ready')).toHaveLength(2);
  });

  it('rejects an archive with no root entry point', async () => {
    const outcome = await processFiles([zipOf({ 'docs/readme.md': '# hi' })], {
      limits: GENEROUS,
    });

    expect(outcome.phase).toBe('error');
    expect(outcome.status.title).toBe('Validation Failed');
  });

  it('carries stripped deploy paths onto the raw Files for the SDK', async () => {
    const outcome = await processFiles([zipOf({ 'dist/index.html': '<html>' })], {
      limits: GENEROUS,
    });

    expect(outcome.files[0].file.webkitRelativePath).toBe('index.html');
  });
});
