import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractZipToFiles, isZipFile, normalizePath } from '../src/zip';
import { file, zipOf } from './fixtures/builders';

describe('isZipFile', () => {
  it('accepts the two zip MIME types and the extension', () => {
    expect(isZipFile(file('a.zip', '', 'application/zip'))).toBe(true);
    expect(isZipFile(file('a.bin', '', 'application/x-zip-compressed'))).toBe(true);
    expect(isZipFile(file('SITE.ZIP', '', ''))).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isZipFile(file('a.html', '', 'text/html'))).toBe(false);
    expect(isZipFile(file('zip', '', ''))).toBe(false);
    expect(isZipFile(file('a.zip.txt', '', ''))).toBe(false);
  });
});

describe('normalizePath', () => {
  it('strips traversal, absolute roots and no-op segments', () => {
    expect(normalizePath('../../etc/passwd')).toBe('etc/passwd');
    expect(normalizePath('foo/./bar/../baz.txt')).toBe('foo/baz.txt');
    expect(normalizePath('/absolute/path.txt')).toBe('absolute/path.txt');
    expect(normalizePath('a//b///c.txt')).toBe('a/b/c.txt');
  });

  it('never escapes the archive root, however many levels are climbed', () => {
    expect(normalizePath('../../../../../../etc/passwd')).toBe('etc/passwd');
    expect(normalizePath('a/../../../b.txt')).toBe('b.txt');
  });

  it('collapses to empty when nothing survives', () => {
    expect(normalizePath('../..')).toBe('');
    expect(normalizePath('/')).toBe('');
    expect(normalizePath('.')).toBe('');
  });

  it('leaves an already-clean path untouched', () => {
    expect(normalizePath('assets/img/logo.png')).toBe('assets/img/logo.png');
  });
});

describe('extractZipToFiles', () => {
  it('inflates real archive bytes into real Files', async () => {
    const { files, errors } = await extractZipToFiles(
      zipOf({ 'index.html': '<html>hi</html>', 'css/app.css': 'body{}' }),
    );

    expect(errors).toEqual([]);
    expect(files.map((f) => f.webkitRelativePath).sort()).toEqual(['css/app.css', 'index.html']);

    // Real bytes, read through the real platform File API
    const index = files.find((f) => f.webkitRelativePath === 'index.html');
    await expect(index?.text()).resolves.toBe('<html>hi</html>');
  });

  it('sets the deploy path on webkitRelativePath and the bare name on file.name', async () => {
    const { files } = await extractZipToFiles(zipOf({ 'assets/img/logo.png': 'PNG' }));

    expect(files[0].webkitRelativePath).toBe('assets/img/logo.png');
    expect(files[0].name).toBe('logo.png');
  });

  it('preserves byte content exactly, including multi-byte characters', async () => {
    const content = '日本語 — émoji 🚀';
    const { files } = await extractZipToFiles(zipOf({ 'unicode.txt': content }));
    await expect(files[0].text()).resolves.toBe(content);
  });

  it('gives each entry its own backing buffer', async () => {
    // fflate shares backing buffers across entries; without an explicit copy the
    // extracted Files would alias each other's bytes.
    const { files } = await extractZipToFiles(zipOf({ 'a.txt': 'aaaaaaaa', 'b.txt': 'bbbbbbbb' }));

    const [a, b] = ['a.txt', 'b.txt'].map((n) => files.find((f) => f.name === n));
    await expect(a?.text()).resolves.toBe('aaaaaaaa');
    await expect(b?.text()).resolves.toBe('bbbbbbbb');
  });

  it('sanitizes traversal paths in archive entries', async () => {
    const { files } = await extractZipToFiles(zipOf({ '../../etc/passwd': 'root' }));
    expect(files[0].webkitRelativePath).toBe('etc/passwd');
  });

  it('reports an entry whose path sanitizes to nothing', async () => {
    const { files, errors } = await extractZipToFiles(
      zipOf({ '../..': 'x', 'index.html': '<html>' }),
    );

    expect(files.map((f) => f.webkitRelativePath)).toEqual(['index.html']);
    expect(errors).toEqual(['Skipped invalid path: ../..']);
  });

  it('skips directory entries', async () => {
    const packed = zipSync({ 'dist/': new Uint8Array(0), 'dist/index.html': strToU8('<html>') });
    const { files } = await extractZipToFiles(
      new File([new Uint8Array(packed)], 'site.zip', { type: 'application/zip' }),
    );

    expect(files.map((f) => f.webkitRelativePath)).toEqual(['dist/index.html']);
  });

  it('returns an error result for bytes that are not an archive', async () => {
    const { files, errors } = await extractZipToFiles(file('broken.zip', 'definitely not a zip'));

    expect(files).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Failed to load ZIP file');
  });

  it('handles an empty archive', async () => {
    const { files, errors } = await extractZipToFiles(zipOf({}));
    expect(files).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('extracts the checked-in fixture archive', async () => {
    const bytes = readFileSync(join(__dirname, 'fixtures/test-site.zip'));
    const { files, errors } = await extractZipToFiles(
      new File([new Uint8Array(bytes)], 'test-site.zip', { type: 'application/zip' }),
    );

    expect(errors).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.webkitRelativePath.endsWith('index.html'))).toBe(true);
  });
});
