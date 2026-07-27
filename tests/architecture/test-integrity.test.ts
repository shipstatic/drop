import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FENCE — the tautology class.
 *
 * Every test file must reach this package's production code. A test that only
 * exercises its own fixtures, or only a published dependency, neither raises nor
 * lowers coverage — so no ratchet can see it. Ship's audit found seven such
 * files; the backend found twenty-one totalling 6,431 lines.
 *
 * Reach is resolved TRANSITIVELY through local test-support modules (a file may
 * import `./fixtures/builders` and count, if the builders themselves reach src).
 * `@shipstatic/*` deliberately does NOT count — those are published packages
 * from other repos, not this one's code.
 */
const ROOT = resolve(__dirname, '../..');
const TEST_DIRS = ['tests', 'tests-browser'];

/**
 * Files exempt from the reach rule, each with a reason.
 *
 * Only the fences themselves. A fence's subject IS the layout, so it reads the
 * source tree as DATA rather than importing it — the one legitimate way to be a
 * useful test that imports no module. Nothing else belongs here: drop has no
 * artifact tier running against built output.
 */
const EXCEPTIONS: Record<string, string> = {
  'tests/architecture/test-integrity.test.ts':
    'Fence: its subject is the test tree itself, which it reads as data rather than importing.',
  'tests/architecture/test-naming.test.ts':
    'Fence: its subject is the layout and filenames, which it reads as data rather than importing.',
};

function walk(dir: string): string[] {
  if (!existsSafe(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function existsSafe(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

const testFiles = TEST_DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) =>
  /\.test\.tsx?$/.test(f),
);

/** Local relative imports of a file, resolved to absolute module paths. */
function localImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const matches = source.matchAll(/from\s+['"](\.[^'"]+)['"]|import\(['"](\.[^'"]+)['"]\)/g);
  return [...matches].map((m) => resolve(file, '..', m[1] ?? m[2]));
}

/** Does this module — or anything it imports locally — reach src/? */
function reachesSrc(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);

  const srcDir = join(ROOT, 'src');
  return localImports(file).some((imported) => {
    if (imported.startsWith(srcDir)) return true;
    // Follow local test-support modules (fixtures, harnesses)
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const candidate = `${imported}${ext}`;
      if (existsSafe(candidate)) return reachesSrc(candidate, seen);
    }
    return false;
  });
}

describe('test integrity', () => {
  it('finds test files to check', () => {
    expect(testFiles.length).toBeGreaterThan(0);
  });

  it.each(testFiles.map((f) => relative(ROOT, f)))('%s reaches production code', (rel) => {
    if (EXCEPTIONS[rel]) return;
    expect(reachesSrc(join(ROOT, rel)), `${rel} imports no src/ module — tautology`).toBe(true);
  });

  it('records a reason for every exception', () => {
    for (const [file, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.length, `${file} needs a reason`).toBeGreaterThan(20);
    }
  });
});
