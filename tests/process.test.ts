import { FileValidationStatus } from '@shipstatic/types';
import { describe, expect, it, vi } from 'vitest';
import { type DropOutcome, detectSourceName, processFiles } from '../src/process';
import type { DropStatus } from '../src/types';
import {
  builtSite,
  file,
  fileAt,
  GENEROUS_LIMITS,
  PLATFORM_LIMITS,
  zipOf,
} from './fixtures/builders';

/**
 * The pipeline runs against the REAL Ship functions throughout — `validateFiles`,
 * `filterJunk` and `optimizeDeployPaths` are pure, so there is nothing to fake.
 * Only `PlatformLimits` is injected, which is the whole point of the pipeline
 * taking limits rather than a client.
 */
const run = (files: File[], limits = GENEROUS_LIMITS) => processFiles(files, { limits });

/** Ready files are a derivation of the outcome, not a second field on it. */
const ready = (outcome: DropOutcome) =>
  outcome.files.filter((f) => f.status === FileValidationStatus.READY);

describe('detectSourceName', () => {
  it('uses the ZIP name without its extension for a lone archive', () => {
    expect(detectSourceName([file('My Site.ZIP', '', 'application/zip')])).toBe('My Site');
  });

  it('uses the root folder for a folder drop', () => {
    expect(detectSourceName([fileAt('dist/index.html'), fileAt('dist/app.js')])).toBe('dist');
  });

  it('uses the filename for loose files', () => {
    expect(detectSourceName([file('index.html')])).toBe('index.html');
  });

  it('does not treat a ZIP among several files as an archive', () => {
    expect(detectSourceName([file('a.zip', '', 'application/zip'), file('b.html')])).toBe('a.zip');
  });

  it('is empty for no files', () => {
    expect(detectSourceName([])).toBe('');
  });
});

describe('processFiles — happy path', () => {
  it('accepts a built site and reports every file ready', async () => {
    const outcome = await run(builtSite());

    expect(outcome.phase).toBe('ready');
    expect(outcome.needsBuild).toBe(false);
    expect(ready(outcome)).toHaveLength(2);
    expect(outcome.files.every((f) => f.status === FileValidationStatus.READY)).toBe(true);
    expect(outcome.status.title).toBe('Ready');
    expect(outcome.status.details).toBe('2 files ready');
    expect(outcome.status.warnings).toBeUndefined();
  });

  it('pluralizes a single file', async () => {
    const outcome = await run([fileAt('index.html', '<html>', 'text/html')]);
    expect(outcome.status.details).toBe('1 file ready');
  });

  it('strips the common prefix by default', async () => {
    const outcome = await run(builtSite('my-site'));
    expect(outcome.files.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);
  });

  it('reports the source name on the outcome', async () => {
    expect((await run(builtSite('dist'))).sourceName).toBe('dist');
  });
});

describe('processFiles — ZIP input', () => {
  it('extracts a lone ZIP and validates its contents', async () => {
    const outcome = await run([zipOf({ 'index.html': '<html>hi</html>', 'app.js': 'x' })]);

    expect(outcome.phase).toBe('ready');
    expect(outcome.sourceName).toBe('my-site');
    expect(outcome.files.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);
  });

  it('strips the archive root folder', async () => {
    const outcome = await run([zipOf({ 'dist/index.html': '<html>', 'dist/app.js': 'x' })]);
    expect(outcome.files.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);
  });

  it('treats ZIPs as ordinary files when several files are dropped', async () => {
    const outcome = await run([
      fileAt('index.html', '<html>', 'text/html'),
      zipOf({ 'inner.html': 'x' }, 'bundle.zip'),
    ]);

    expect(outcome.phase).toBe('ready');
    expect(outcome.files.map((f) => f.path).sort()).toEqual(['bundle.zip', 'index.html']);
  });

  it('reports extraction problems as an error outcome', async () => {
    const outcome = await run([file('broken.zip', 'not an archive', 'application/zip')]);

    expect(outcome.phase).toBe('error');
    // No files survived extraction, so validation reports an empty set
    expect(ready(outcome)).toEqual([]);
  });

  it('warns about per-entry extraction errors without failing the drop', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outcome = await run([zipOf({ '../..': 'x', 'index.html': '<html>' })]);

    expect(outcome.phase).toBe('ready');
    expect(warn).toHaveBeenCalledWith('ZIP extraction errors:', ['Skipped invalid path: ../..']);
  });
});

describe('processFiles — entry point', () => {
  it('rejects a built site with no index.html', async () => {
    const outcome = await run([fileAt('app.js', 'x', 'text/javascript')]);

    expect(outcome.phase).toBe('error');
    expect(outcome.status.title).toBe('Validation Failed');
    expect(outcome.status.details).toBe(
      'No index.html at root — the entry point must be in the top-level directory',
    );
    expect(outcome.files.every((f) => f.status === FileValidationStatus.VALIDATION_FAILED)).toBe(
      true,
    );
    expect(outcome.status.title).toBe('Validation Failed');
  });

  it('rejects index.html that is not at the root of a built site', async () => {
    // No common prefix to strip here, so `docs/` survives and the entry point is
    // genuinely nested.
    const outcome = await run([
      fileAt('docs/index.html', '<html>', 'text/html'),
      fileAt('readme.md', '#', 'text/markdown'),
    ]);
    expect(outcome.phase).toBe('error');
  });

  it('does not run the entry-point check when everything was filtered away', async () => {
    // Junk-only input leaves nothing to check; validation reports the empty set.
    const outcome = await run([fileAt('.DS_Store', 'junk')]);

    expect(outcome.phase).toBe('error');
    expect(outcome.files).toEqual([]);
  });
});

describe('processFiles — junk filtering', () => {
  it('drops junk files and keeps real ones', async () => {
    const outcome = await run([
      fileAt('index.html', '<html>', 'text/html'),
      fileAt('.DS_Store', 'junk'),
      fileAt('__MACOSX/._index.html', 'junk'),
    ]);

    expect(outcome.phase).toBe('ready');
    expect(outcome.files.map((f) => f.path)).toEqual(['index.html']);
  });

  it('keeps .well-known, which is a legitimate root path', async () => {
    const outcome = await run([
      fileAt('index.html', '<html>', 'text/html'),
      fileAt('.well-known/security.txt', 'Contact: x'),
    ]);

    expect(outcome.files.map((f) => f.path).sort()).toEqual([
      '.well-known/security.txt',
      'index.html',
    ]);
  });

  it('turns an unbuilt-project rejection into a validation error, not a crash', async () => {
    // filterJunk THROWS a ShipError for unbuilt markers. Reaching here means the
    // needsBuild detection did not fire — e.g. a package.json with no index.html.
    const outcome = await run([fileAt('package.json', '{}'), fileAt('src/app.js', 'x')]);

    expect(outcome.phase).toBe('error');
    expect(outcome.status.title).toBe('Validation Failed');
    expect(outcome.status.errors).toBeUndefined();
  });
});

describe('processFiles — unbuilt projects', () => {
  const sourceProject = () => [
    fileAt('my-app/package.json', '{"name":"x"}'),
    fileAt('my-app/index.html', '<html>', 'text/html'),
    fileAt('my-app/src/main.js', 'x', 'text/javascript'),
  ];

  it('detects a project needing a build and skips deploy validation', async () => {
    const outcome = await run(sourceProject());

    expect(outcome.phase).toBe('ready');
    expect(outcome.needsBuild).toBe(true);
    expect(outcome.status.details).toBe('3 files ready — project will be built');
    expect(outcome.files.every((f) => f.status === FileValidationStatus.READY)).toBe(true);
  });

  it('strips node_modules handed over by the folder picker', async () => {
    const outcome = await run([
      ...sourceProject(),
      fileAt('my-app/node_modules/react/index.js', 'x'),
      fileAt('my-app/node_modules/.pnpm/lodash@4/node_modules/lodash/index.js', 'x'),
    ]);

    expect(outcome.needsBuild).toBe(true);
    expect(outcome.files.some((f) => f.path.includes('node_modules'))).toBe(false);
    expect(outcome.files).toHaveLength(3);
  });

  it('strips node_modules given with Windows separators', async () => {
    const outcome = await run([
      ...sourceProject(),
      fileAt('my-app\\node_modules\\react\\index.js', 'x'),
    ]);
    expect(outcome.files.some((f) => f.path.includes('node_modules'))).toBe(false);
  });

  it('accepts index.html anywhere in an unbuilt project', async () => {
    const outcome = await run([
      fileAt('my-app/package.json', '{}'),
      fileAt('my-app/public/index.html', '<html>', 'text/html'),
    ]);

    expect(outcome.phase).toBe('ready');
    expect(outcome.needsBuild).toBe(true);
  });

  it('still requires an index.html somewhere', async () => {
    const outcome = await run([
      fileAt('my-app/package.json', '{}'),
      fileAt('my-app/src/main.js', 'x'),
    ]);

    expect(outcome.phase).toBe('error');
    expect(outcome.status.details).toBe(
      'No index.html found — every web project needs an index.html entry point',
    );
    expect(outcome.needsBuild).toBe(true);
  });

  it('does not skip deploy validation for a built site', async () => {
    const outcome = await run(builtSite());
    expect(outcome.needsBuild).toBe(false);
  });
});

describe('processFiles — limit validation', () => {
  it('fails the whole set atomically when one file is too large', async () => {
    const outcome = await run(
      [fileAt('index.html', '<html>', 'text/html'), fileAt('big.txt', 'x'.repeat(200))],
      { ...PLATFORM_LIMITS, maxFileSize: 100 },
    );

    expect(outcome.phase).toBe('error');
    expect(outcome.status.title).toBe('Validation Failed');
    expect(outcome.status.details).toBe('1 file failed validation');
    expect(outcome.status.errors?.[0]).toContain('big.txt');
    expect(outcome.files.every((f) => f.status === FileValidationStatus.VALIDATION_FAILED)).toBe(
      true,
    );
    expect(ready(outcome)).toEqual([]);
  });

  it('rejects a blocked extension', async () => {
    const outcome = await run([
      fileAt('index.html', '<html>', 'text/html'),
      fileAt('payload.exe', 'MZ'),
    ]);

    expect(outcome.phase).toBe('error');
    expect(outcome.status.errors?.[0]).toContain('payload.exe');
  });

  it('excludes empty files as warnings while staying ready', async () => {
    const outcome = await run([
      fileAt('index.html', '<html>', 'text/html'),
      fileAt('empty.txt', ''),
    ]);

    expect(outcome.phase).toBe('ready');
    expect(ready(outcome).map((f) => f.path)).toEqual(['index.html']);
    expect(outcome.status.details).toBe('1 file ready (1 empty file excluded)');
    expect(outcome.status.warnings?.[0]).toContain('empty.txt');
  });

  it('stays ready — not errored — when every file is excluded', async () => {
    // An empty readyFiles set already disables the deploy action, so this is a
    // reportable state rather than a failure.
    const outcome = await run([fileAt('index.html', '')]);

    expect(outcome.phase).toBe('ready');
    expect(outcome.status.title).toBe('All files excluded');
    expect(ready(outcome)).toEqual([]);
    expect(outcome.status.warnings).toHaveLength(1);
  });

  it('reports an empty input set as a validation failure', async () => {
    const outcome = await run([]);
    expect(outcome.phase).toBe('error');
    expect(outcome.status.title).toBe('Validation Failed');
  });

  it('enforces the file-count cap', async () => {
    const files = [
      fileAt('index.html', '<html>', 'text/html'),
      fileAt('a.js', 'x'),
      fileAt('b.js', 'x'),
    ];
    const outcome = await run(files, { ...PLATFORM_LIMITS, maxFilesCount: 2 });
    expect(outcome.phase).toBe('error');
  });

  it('enforces the total-size cap', async () => {
    const outcome = await run(
      [fileAt('index.html', 'x'.repeat(60)), fileAt('app.js', 'x'.repeat(60))],
      { ...PLATFORM_LIMITS, maxTotalSize: 100 },
    );
    expect(outcome.phase).toBe('error');
  });

  it('reports the FULL deploy path in errors, not the basename', async () => {
    // The pipeline sends `{ name: path }` to the validator. A basename-only
    // projection would still fail this file, but would name it "payload.exe"
    // with no indication of where it lives — and would validate a different
    // string than the platform does server-side.
    const outcome = await run([
      fileAt('site/index.html', '<html>', 'text/html'),
      fileAt('site/vendor/payload.exe', 'MZ'),
    ]);

    expect(outcome.phase).toBe('error');
    expect(outcome.status.errors?.[0]).toContain('vendor/payload.exe');
  });
});

describe('processFiles — status reporting', () => {
  it('reports extraction, naming the archive', async () => {
    const seen: DropStatus[] = [];
    await processFiles([zipOf({ 'index.html': '<html>' }, 'my-site.zip')], {
      limits: GENEROUS_LIMITS,
      onStatus: (status) => seen.push(status),
    });

    expect(seen).toEqual([{ title: 'Extracting...', details: 'Extracting my-site.zip...' }]);
  });

  it('reports nothing for non-archive input', async () => {
    // Extraction is the only step slow enough to narrate. The hook already shows
    // an opening status before this function is called, so a second
    // near-identical "Processing..." here would only flicker.
    const seen: DropStatus[] = [];
    await processFiles(builtSite(), {
      limits: GENEROUS_LIMITS,
      onStatus: (status) => seen.push(status),
    });

    expect(seen).toEqual([]);
  });

  it('runs without a status reporter', async () => {
    await expect(run(builtSite())).resolves.toMatchObject({ phase: 'ready' });
  });
});

describe('processFiles — failure containment', () => {
  it('never rejects; unexpected failures come back as an error outcome', async () => {
    const exploding = {
      get webkitRelativePath(): string {
        throw new Error('boom');
      },
      name: 'x.html',
    } as unknown as File;

    const outcome = await run([exploding]);

    expect(outcome.phase).toBe('error');
    expect(outcome.status.title).toBe('Processing Failed');
    expect(outcome.status.details).toBe('Failed to process files: boom');
  });

  it('preserves the source name on an error outcome', async () => {
    const outcome = await run([fileAt('dist/app.js', 'x')]);
    expect(outcome.sourceName).toBe('dist');
  });
});
