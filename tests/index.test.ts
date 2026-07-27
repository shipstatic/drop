import { describe, expect, it } from 'vitest';
import * as drop from '../src/index';

/**
 * The package's public surface — and the decision that it IS a decision.
 *
 * `src/index.ts` names its exports one by one rather than sweeping the modules
 * behind it, so this file pins a curated API rather than whatever happened to be
 * exported. The negative assertions matter as much as the positive ones:
 * `filePath`, `applyStatus`, `toValidatable`, `traverseFileTree` and friends are
 * implementation detail, and publishing them would put semver around it.
 */
const PUBLIC_VALUES = ['processFiles', 'useDrop'].sort();

/** Exported by the modules behind the barrel, deliberately not re-exported. */
const INTERNAL = [
  'applyStatus',
  'createProcessedFile',
  'detectSourceName',
  'extractZipToFiles',
  'filePath',
  'formatFileSize',
  'isZipFile',
  'normalizePath',
  'setRelativePath',
  'stripCommonPrefix',
  'toValidatable',
  'traverseFileTree',
];

describe('public surface', () => {
  it('exports exactly two runtime values', () => {
    expect(Object.keys(drop).sort()).toEqual(PUBLIC_VALUES);
  });

  it('keeps implementation helpers out of the public API', () => {
    for (const name of INTERNAL) {
      expect(Object.keys(drop), `${name} must stay internal`).not.toContain(name);
    }
  });

  it('exports the hook and the headless pipeline as functions', () => {
    expect(typeof drop.useDrop).toBe('function');
    expect(typeof drop.processFiles).toBe('function');
  });

  it('does not re-badge Ship’s status vocabulary', () => {
    // `FileValidationStatus` is Ship's, and `@shipstatic/ship` already exports it
    // to every consumer of this package. Re-exporting it here — under this name
    // or a drop-local alias like `FILE_STATUSES` — would put a second name on one
    // object, and leave a consumer of both packages wondering if they differ.
    expect(Object.keys(drop)).not.toContain('FileValidationStatus');
    expect(Object.keys(drop)).not.toContain('FILE_STATUSES');
  });

  it('keeps the /testing subpath out of the main entry', () => {
    // Consumer mock utilities ship on `@shipstatic/drop/testing` so they never
    // reach a production bundle through the main entry.
    expect(Object.keys(drop)).not.toContain('createMockDrop');
  });
});
