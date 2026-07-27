import { filterJunk, getValidFiles, validateFiles } from '@shipstatic/ship';
import { FileValidationStatus, type ValidatableFile } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { createProcessedFile } from '../src/files';
import { toValidatable } from '../src/process';
import type { ProcessedFile } from '../src/types';
import { fileAt, PLATFORM_LIMITS } from './fixtures/builders';

/**
 * The drop → Ship SDK contract.
 *
 * **Aspect of `src/process.ts`** — the handoff, isolated from the pipeline that
 * performs it, because this is the file that must fail when the SDK moves.
 *
 * It pins the PROJECTION that crosses the boundary (`toValidatable`), not an
 * assignability between `ProcessedFile` and `ValidatableFile`. The distinction is
 * the whole point: the two types line up structurally, but `ProcessedFile.name` is
 * the display basename while the validator must receive the full deploy path, so
 * asserting assignability would certify a call production never makes.
 *
 * Every assertion here is covered by `pnpm typecheck` — without that gate, a
 * type-level claim in a test file is decoration.
 */
describe('toValidatable — the shape drop hands to Ship', () => {
  it('satisfies ValidatableFile', () => {
    const projected = toValidatable(createProcessedFile(fileAt('dist/index.html', '<html>')));
    expect(projected satisfies ValidatableFile).toEqual({ name: 'dist/index.html', size: 6 });
  });

  it('carries the FULL deploy path as the name', () => {
    // Server-side validation runs on full paths. Sending the basename would
    // validate a different string than the platform will.
    const projected = toValidatable(createProcessedFile(fileAt('assets/img/logo.png', 'PNG')));

    expect(projected.name).toBe('assets/img/logo.png');
    expect(projected.name).not.toBe('logo.png');
  });

  it('omits everything the validator has no use for', () => {
    // A narrow projection is what keeps drop's UI metadata (id, File handle,
    // display name) out of a contract that does not mention it.
    expect(Object.keys(toValidatable(createProcessedFile(fileAt('a.txt', 'x')))).sort()).toEqual([
      'name',
      'size',
    ]);
  });

  it('is what the real validateFiles accepts', () => {
    const files = [fileAt('index.html', '<html>'), fileAt('css/app.css', 'body{}')].map((f) =>
      createProcessedFile(f),
    );

    const result = validateFiles(files.map(toValidatable), PLATFORM_LIMITS);

    expect(result.canDeploy).toBe(true);
    expect(result.validFiles).toHaveLength(2);
    expect(result.files.every((f) => f.status === FileValidationStatus.READY)).toBe(true);
  });

  it('reports the deploy path in validation errors, so the message names the file', () => {
    const files = [createProcessedFile(fileAt('scripts/payload.exe', 'MZ'))];
    const result = validateFiles(files.map(toValidatable), PLATFORM_LIMITS);

    expect(result.canDeploy).toBe(false);
    expect(result.errors[0].file).toBe('scripts/payload.exe');
  });

  it('round-trips through getValidFiles', () => {
    const files = [fileAt('index.html', '<html>'), fileAt('empty.txt', '')].map((f) =>
      createProcessedFile(f),
    );

    const validated = validateFiles(files.map(toValidatable), PLATFORM_LIMITS);

    // Empty files are excluded by warning, not failed
    expect(getValidFiles(validated.files).map((f) => f.name)).toEqual(['index.html']);
  });
});

describe('ProcessedFile ↔ ValidatableFile', () => {
  it('shares Ship’s status vocabulary exactly', () => {
    // Drop adds no statuses of its own. When it did (`processing`, `uploading`,
    // `complete`, `error` — none of which anything ever set), the widening is
    // what made this type relationship impossible to express.
    expect(FileValidationStatus).toBe(FileValidationStatus);

    const status: ProcessedFile['status'] = FileValidationStatus.READY;
    const asValidatable: ValidatableFile['status'] = status;
    expect(asValidatable).toBe('ready');
  });

  it('is structurally a ValidatableFile — but is deliberately not passed as one', () => {
    const processed = createProcessedFile(fileAt('dist/index.html', '<html>'));

    // The structural relationship now holds…
    const structural: ValidatableFile = processed;
    expect(structural.size).toBe(6);

    // …and is still the wrong call to make: `name` is the display basename,
    // which is why `toValidatable` exists.
    expect(structural.name).toBe('index.html');
    expect(toValidatable(processed).name).toBe('dist/index.html');
  });
});

describe('filterJunk — the contract drop relies on', () => {
  it('strips junk while preserving real paths', () => {
    expect(filterJunk(['index.html', 'src/app.js', '.DS_Store', '__MACOSX/._index.html'])).toEqual([
      'index.html',
      'src/app.js',
    ]);
  });

  it('throws on unbuilt markers before the dot-file filter can hide them', () => {
    // Drop depends on the ORDER here: node_modules/.pnpm/ paths are dot-file
    // matches, so a filter-first implementation would silently strip them and
    // never report the project as unbuilt.
    expect(() =>
      filterJunk([
        'demo/index.html',
        'demo/node_modules/.pnpm/lodash@4/node_modules/lodash/index.js',
      ]),
    ).toThrow('Unbuilt project detected');

    expect(() => filterJunk(['index.html', 'package.json'])).toThrow('Unbuilt project detected');
  });

  it('allows unbuilt markers through when the server will build', () => {
    expect(filterJunk(['index.html', 'package.json'], { allowUnbuilt: true })).toEqual([
      'index.html',
      'package.json',
    ]);
  });
});
