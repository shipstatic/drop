import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FENCE — layout drift.
 *
 * Two rules, both mechanical:
 *
 * 1. **A filename names its SUBJECT, never the test.** `useDrop-branches` names
 *    the coverage report that produced it, not a subject — and drop had seven
 *    `useDrop-*` files for one module, which is how 3,000 lines of hook tests
 *    accumulated for logic that was never React's to begin with.
 * 2. **A mirror file has a `src/` counterpart**, and any split beyond one file
 *    per module is an ASPECT that must be recorded here by full basename. Prose
 *    did not hold this in the backend; the fence does.
 */
const ROOT = resolve(__dirname, '../..');

/** Qualifiers that describe the test rather than its subject. */
const BANNED_QUALIFIERS = [
  // The platform list, shared verbatim with cloudflare's fence so the three
  // repos reject the same vocabulary.
  'accuracy',
  'additional',
  'basic',
  'coherence',
  'comprehensive',
  'edge-cases',
  'elegant',
  'essential',
  'extra',
  'focused',
  'harmony',
  'matrix',
  'misc',
  'preservation',
  'regression',
  'resilience',
  'simple',
  'unified',
  // Drop-local additions. `unit`/`integration`/`e2e` are structural in ship
  // (its vitest projects select on those suffixes) but meaningless here, where
  // projects select by directory — so they are bannable.
  'branches',
  'coverage',
  'e2e',
  'edge',
  'fallback',
  'integration',
  'state-machine',
  'unit',
  'validation',
];

/**
 * Recorded aspect splits — one subject module, more than one mirror file.
 * Legal, listed here because the law requires the aspect to be recorded.
 */
const ASPECT_SPLITS: Record<string, string> = {
  'process-contract.test.ts':
    'The drop→SDK handoff, isolated from the pipeline that performs it: this is the file that must fail when the SDK moves.',
  'useDrop-events.test.ts':
    'The hook’s DOM surface (drag/drop events, hidden input, prop getters), separate from its state machine and actions.',
};

/** Feature-axis files with no single subject module. */
const FEATURE_FILES: Record<string, string> = {};

const FENCE_DIR = 'architecture';

function testFilesIn(dir: string): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((entry) => {
    const path = join(full, entry);
    if (statSync(path).isDirectory()) return testFilesIn(join(dir, entry));
    return /\.test\.tsx?$/.test(entry) ? [join(dir, entry)] : [];
  });
}

const mainFiles = testFilesIn('tests').filter((f) => !f.includes(FENCE_DIR));
const browserFiles = testFilesIn('tests-browser');
const allFiles = [...mainFiles, ...browserFiles];

/** `tests/useDrop-events.test.ts` → `useDrop` */
const subjectOf = (file: string) =>
  basename(file)
    .replace(/\.test\.tsx?$/, '')
    .split('-')[0];

describe('test naming', () => {
  it('finds test files to check', () => {
    expect(allFiles.length).toBeGreaterThan(0);
  });

  it.each(allFiles)('%s carries no banned qualifier', (file) => {
    const name = basename(file).replace(/\.test\.tsx?$/, '');
    const parts = name.split('-').slice(1);

    for (const part of parts) {
      expect(
        BANNED_QUALIFIERS,
        `"${part}" in ${file} describes the test, not its subject — name the aspect after what it covers`,
      ).not.toContain(part.toLowerCase());
    }
  });

  it.each(mainFiles)('%s mirrors a src/ module', (file) => {
    const name = basename(file);
    if (FEATURE_FILES[name]) return;

    const subject = subjectOf(file);
    const candidates = [`src/${subject}.ts`, `src/${subject}.tsx`, `src/${subject}/index.ts`];

    expect(
      candidates.some((c) => existsSync(join(ROOT, c))),
      `${file} mirrors no src/ module (looked for ${candidates.join(', ')})`,
    ).toBe(true);
  });

  it.each(allFiles)('%s records its aspect when it is a split', (file) => {
    const name = basename(file);
    if (!name.includes('-') || FEATURE_FILES[name]) return;

    expect(
      ASPECT_SPLITS[name],
      `${name} is an aspect split and must be recorded in this fence`,
    ).toBeDefined();
  });

  it('records a reason for every aspect split and feature file', () => {
    for (const [file, reason] of Object.entries({ ...ASPECT_SPLITS, ...FEATURE_FILES })) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(30);
    }
  });

  it('keeps the recorded lists free of stale entries', () => {
    const names = new Set(allFiles.map((f) => basename(f)));
    for (const recorded of [...Object.keys(ASPECT_SPLITS), ...Object.keys(FEATURE_FILES)]) {
      expect(names.has(recorded), `${recorded} is recorded but no longer exists`).toBe(true);
    }
  });

  it('has a mirror file for every src module', () => {
    // The other direction: a new module must arrive with its test.
    const modules = readdirSync(join(ROOT, 'src'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.replace(/\.ts$/, ''));
    const subjects = new Set(mainFiles.map(subjectOf));

    for (const module of modules) {
      // types.ts is pure type declarations plus one re-exported const, both
      // pinned by tests/index.test.ts and tests/process-contract.test.ts.
      if (module === 'types') continue;
      expect(subjects.has(module), `src/${module}.ts has no mirror test file`).toBe(true);
    }
  });
});
