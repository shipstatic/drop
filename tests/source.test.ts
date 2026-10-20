import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filePath } from '../src/files';
import { projectSource, rebase } from '../src/source';
import { fileAt } from './fixtures/builders';

/** A project as paths and contents. */
type Tree = Record<string, string>;

/**
 * What git leaves out of a repository holding this tree: every file it does
 * not ignore, as `git ls-files --others --exclude-standard` lists them.
 *
 * Nothing on the machine may take part. Global and system config are off,
 * HOME and XDG_CONFIG_HOME are empty folders (git reads a personal
 * `~/.config/git/ignore` by default, whatever the config says), and
 * `core.excludesFile` points nowhere. `core.ignorecase` is pinned on, because
 * `git init` turns it on for macOS's file system and leaves it off on Linux,
 * and drop matches without case as git does where these projects are made.
 */
function gitKeeps(tree: Tree): string[] {
  const repo = mkdtempSync(join(tmpdir(), 'drop-source-repo-'));
  const home = mkdtempSync(join(tmpdir(), 'drop-source-home-'));
  try {
    for (const [path, content] of Object.entries(tree)) {
      mkdirSync(join(repo, dirname(path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    const env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: home,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    };
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env }).toString();
    git('init', '-q');
    const listed = git(
      '-c',
      'core.ignorecase=true',
      '-c',
      'core.excludesFile=/dev/null',
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    );
    return listed.split('\0').filter(Boolean).sort();
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

/** What drop sends of the same tree. */
async function dropKeeps(tree: Tree): Promise<string[]> {
  const files = Object.entries(tree).map(([path, content]) => fileAt(path, content));
  return (await projectSource(files)).map(filePath).sort();
}

describe('projectSource keeps what git keeps', () => {
  // The rule is git's, so the test asks git: every case is written to disk as
  // a repository, and drop must keep exactly the files git does not ignore.
  // Folder names matter as much as patterns: git reads each .gitignore from
  // its own folder and never sees the folder's name, while drop writes that
  // name into every pattern it rewrites.
  const cases: Record<string, Tree> = {
    'a Vite app, its old build ignored': {
      'app/.gitignore': 'node_modules\ndist\n*.local\n',
      'app/package.json': '{}',
      'app/index.html': '<html>',
      'app/src/main.ts': 'x',
      'app/dist/index.html': '<html>',
      'app/dist/assets/a.js': 'x',
      'app/.env.local': 'KEY=1',
    },
    'a folder named build that is source, beside an ignored dist': {
      'p/.gitignore': '/dist/\n',
      'p/package.json': '{}',
      'p/build/webpack.base.conf.js': 'x',
      'p/dist/app.js': 'x',
    },
    'a nested file re-including a folder the root excluded': {
      'r/.gitignore': 'generated/\n',
      'r/src/.gitignore': '!generated/\n',
      'r/src/generated/a.js': 'x',
      'r/generated/b.js': 'x',
    },
    'a .gitignore inside an ignored folder, which git never reads': {
      'r/.gitignore': 'out/\n',
      'r/out/.gitignore': '!keep.txt\n',
      'r/out/keep.txt': 'x',
      'r/a.txt': 'x',
    },
    "a folder's contents ignored, one file re-included": {
      'r/.gitignore': 'build/*\n!build/keep.txt\n',
      'r/build/keep.txt': 'x',
      'r/build/x.js': 'x',
    },
    'patterns anchored in a nested file': {
      'r/sub/.gitignore': 'logs/*.log\n',
      'r/sub/logs/a.log': 'x',
      'r/sub/x/logs/b.log': 'x',
      'r/logs/c.log': 'x',
    },
    'a leading slash anchors to its own folder': {
      'r/sub/.gitignore': '/tmp\n',
      'r/sub/tmp/a': 'x',
      'r/sub/deep/tmp/b': 'x',
      'r/tmp/c': 'x',
    },
    'a trailing slash is not a slash, and matches only a folder': {
      'r/sub/.gitignore': 'cache/\n',
      'r/sub/cache/a': 'x',
      'r/sub/deep/cache/b': 'x',
      'r/sub/cache.txt': 'x',
    },
    'globs, an escaped hash, comments and blank lines': {
      'r/.gitignore': '# generated\n\n**/tmp/**\n\\#hash\n*.mp4\n!keep.mp4\n',
      'r/a/tmp/x': 'x',
      'r/#hash': 'x',
      'r/v.mp4': 'x',
      'r/keep.mp4': 'x',
      'r/b/v.mp4': 'x',
      'r/b/page.html': 'x',
    },
    'trailing spaces after a pattern': {
      'r/.gitignore': 'dist   \n',
      'r/dist/a': 'x',
      'r/src/b': 'x',
    },
    'Windows line endings and a byte order mark': {
      'r/.gitignore': '\uFEFFdist\r\nout/\r\n',
      'r/dist/a': 'x',
      'r/out/b': 'x',
      'r/src/c': 'x',
    },
    'a dropped folder whose name starts with a hash': {
      '#1-my-app/.gitignore': 'dist\n',
      '#1-my-app/package.json': '{}',
      '#1-my-app/dist/index.html': '<html>',
      '#1-my-app/src/main.ts': 'x',
    },
    'a dropped folder whose name starts with an exclamation mark': {
      '!important/.gitignore': 'dist\n',
      '!important/package.json': '{}',
      '!important/dist/index.html': '<html>',
      '!important/src/main.ts': 'x',
    },
    'a dropped folder whose name holds brackets': {
      'site [v2]/.gitignore': 'dist\n',
      'site [v2]/package.json': '{}',
      'site [v2]/dist/index.html': '<html>',
      'site [v2]/src/main.ts': 'x',
    },
    'a dropped folder whose name holds a question mark': {
      'what?/.gitignore': 'dist\n',
      'what?/package.json': '{}',
      'what?/dist/index.html': '<html>',
      'what?/src/main.ts': 'x',
    },
    'a dropped folder whose name holds an asterisk': {
      'src*/.gitignore': 'dist\n',
      'src*/package.json': '{}',
      'src*/dist/index.html': '<html>',
      'src*/src/main.ts': 'x',
    },
    'a dropped folder whose name holds a backslash': {
      'a\\b/.gitignore': 'dist\n',
      'a\\b/package.json': '{}',
      'a\\b/dist/index.html': '<html>',
      'a\\b/src/main.ts': 'x',
    },
    'a .gitignore inside a [slug] route folder': {
      'app/src/routes/[slug]/.gitignore': 'draft.md\n',
      'app/src/routes/[slug]/draft.md': 'x',
      'app/src/routes/[slug]/+page.svelte': 'x',
    },
    'lines that name nothing: a bare ! and a bare /': {
      'app/.gitignore': 'dist/\n!\n/\n!/\n',
      'app/dist/index.html': '<html>',
      'app/src/main.ts': 'x',
    },
    'a folder named with an asterisk beside one its pattern would match': {
      'app*/.gitignore': 'dist\n',
      'app*/dist/a': 'x',
      'apple/dist/b': 'x',
      'apple/c': 'x',
    },
    'a drop whose root is the repository': {
      '.gitignore': 'dist\n',
      'dist/a': 'x',
      'src/b': 'x',
    },
    'names in a different case': {
      'r/.gitignore': 'DIST\n',
      'r/dist/a': 'x',
      'r/Src/b': 'x',
    },
  };

  it.each(Object.entries(cases))('%s', async (_, tree) => {
    expect(await dropKeeps(tree)).toEqual(gitKeeps(tree));
  });

  // Renaming the folder that holds a project changes nothing about what it
  // sends. The wrapper starts with `!` and holds every other character a glob
  // reads, so a folder name that leaks into a pattern turns some case red.
  it.each(Object.entries(cases))('%s, inside a folder named like a pattern', async (_, tree) => {
    const wrapped = Object.fromEntries(
      Object.entries(tree).map(([path, content]) => [`![#] *?/${path}`, content]),
    );
    expect(await dropKeeps(wrapped)).toEqual(gitKeeps(wrapped));
  });
});

describe('projectSource', () => {
  it('leaves node_modules behind with no .gitignore to say so', async () => {
    const kept = await dropKeeps({
      'app/package.json': '{}',
      'app/node_modules/react/index.js': 'x',
      'app/src/main.js': 'x',
    });
    expect(kept).toEqual(['app/package.json', 'app/src/main.js']);
  });

  it('keeps every file of a project with no .gitignore', async () => {
    const kept = await dropKeeps({
      'app/package.json': '{}',
      'app/dist/index.html': '<html>',
      'app/src/main.js': 'x',
    });
    expect(kept).toEqual(['app/dist/index.html', 'app/package.json', 'app/src/main.js']);
  });

  it('refuses a .gitignore in a folder whose name holds a line break', async () => {
    // gitignore cannot escape a line break, so the folder cannot be written
    // into its rules; matching them wrongly would send its private files.
    const files = [
      fileAt('app\ncopy/.gitignore', 'secret.json\n'),
      fileAt('app\ncopy/package.json', '{}'),
      fileAt('app\ncopy/secret.json', '{}'),
    ];
    await expect(projectSource(files)).rejects.toThrow(
      "A folder in this project has a line break in its name, so its .gitignore can't be read. Rename the folder, then try again.",
    );
  });

  it('reads paths given with Windows separators', async () => {
    const files = [
      fileAt('app\\.gitignore', 'dist\n'),
      fileAt('app\\dist\\index.html', '<html>'),
      fileAt('app\\src\\main.js', 'x'),
    ];
    const kept = (await projectSource(files)).map(filePath);
    expect(kept).toEqual(['app\\.gitignore', 'app\\src\\main.js']);
  });
});

describe('rebase', () => {
  it.each([
    ['dist', 'app', 'app/**/dist'],
    ['dist/', 'app', 'app/**/dist/'],
    ['/dist', 'app', 'app/dist'],
    ['/dist/', 'app', 'app/dist/'],
    ['src/gen', 'app', 'app/src/gen'],
    ['**/tmp', 'app', 'app/**/tmp'],
    ['!keep.txt', 'app', '!app/**/keep.txt'],
    ['dist  ', 'app', 'app/**/dist'],
    ['dist\\ ', 'app', 'app/**/dist\\ '],
    ['dist\\  ', 'app', 'app/**/dist\\ '],
    ['dist', '', 'dist'],
    ['dist', '[slug]', '\\[slug\\]/**/dist'],
    ['dist', '#app', '\\#app/**/dist'],
  ])('rewrites %j in %j as %j', (line, base, expected) => {
    expect(rebase(line, base)).toBe(expected);
  });

  it.each([[''], ['# a comment'], ['   '], ['!'], ['/'], ['!/']])(
    'reads %j as no pattern',
    (line) => {
      expect(rebase(line, 'app')).toBeNull();
    },
  );
});
