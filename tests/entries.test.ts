import { describe, expect, it } from 'vitest';
import { traverseFileTree, unreadable } from '../src/entries';
import {
  dirEntry,
  entryTree,
  fileEntry,
  READ_ENTRIES_BATCH_SIZE,
  unreadableDirEntry,
  unreadableFileEntry,
} from './fixtures/builders';

/**
 * `FileSystemEntry` traversal — the one module in this package whose collaborator
 * cannot be constructed, in any browser. The fake it runs against models the
 * spec (100-entry `readEntries` batching, a fresh cursor per `createReader`);
 * see `tests/fixtures/builders.ts`.
 */
describe('traverseFileTree', () => {
  it('collects a nested tree with folder-relative paths', async () => {
    const [tree] = entryTree({
      dist: { 'index.html': '<html>', assets: { 'app.js': 'x', 'app.css': 'y' } },
    });

    const files: File[] = [];
    await traverseFileTree(tree, files, tree.name);

    expect(files.map((f) => f.webkitRelativePath).sort()).toEqual([
      'dist/assets/app.css',
      'dist/assets/app.js',
      'dist/index.html',
    ]);
  });

  it('names a root-level file entry without a directory prefix', async () => {
    const files: File[] = [];
    await traverseFileTree(fileEntry('index.html'), files);
    expect(files[0].webkitRelativePath).toBe('index.html');
  });

  it('reads a directory larger than one readEntries batch', async () => {
    // The regression this exists for: real Chromium caps a batch at 100 and
    // signals the end with an empty one, so an implementation that calls
    // readEntries once silently truncates every large folder.
    const count = READ_ENTRIES_BATCH_SIZE * 2 + 7;
    const children = Array.from({ length: count }, (_, i) => fileEntry(`file-${i}.txt`));

    const files: File[] = [];
    await traverseFileTree(dirEntry('big', children), files, 'big');

    expect(files).toHaveLength(count);
  });

  it('skips node_modules wholesale', async () => {
    const [tree] = entryTree({
      project: {
        'index.html': '<html>',
        node_modules: { react: { 'index.js': 'x' } },
      },
    });

    const files: File[] = [];
    await traverseFileTree(tree, files, tree.name);

    expect(files.map((f) => f.webkitRelativePath)).toEqual(['project/index.html']);
  });

  it('still descends into a FILE named node_modules', async () => {
    // The skip is directory-scoped; a file with that name is ordinary content.
    const [tree] = entryTree({ project: { node_modules: 'not a directory' } });

    const files: File[] = [];
    await traverseFileTree(tree, files, tree.name);

    expect(files.map((f) => f.webkitRelativePath)).toEqual(['project/node_modules']);
  });

  // A folder that is read only in part would deploy a site without the
  // missing file, or send a project without its .gitignore and so with the
  // files that .gitignore keeps private.
  it('refuses an unreadable directory, naming it', async () => {
    await expect(traverseFileTree(unreadableDirEntry('locked'), [], 'locked')).rejects.toThrow(
      unreadable('locked'),
    );
  });

  it('refuses an unreadable file, naming its path', async () => {
    const tree = dirEntry('dist', [
      fileEntry('index.html', '<html>'),
      unreadableFileEntry('locked.txt'),
    ]);

    await expect(traverseFileTree(tree, [], 'dist')).rejects.toThrow(
      "We couldn't read dist/locked.txt. Make sure it's on this computer, then try again.",
    );
  });

  it('ignores an entry that is neither file nor directory', async () => {
    const files: File[] = [];
    await traverseFileTree(
      { isFile: false, isDirectory: false, name: 'odd' } as FileSystemEntry,
      files,
    );
    expect(files).toEqual([]);
  });

  it('names a nested directory relative to the root when called with no path', async () => {
    // The hook always seeds the root entry's own name, but a manual caller need
    // not — the first level then has no prefix to extend.
    const tree = dirEntry('outer', [dirEntry('assets', [fileEntry('app.css', 'body{}')])]);

    const files: File[] = [];
    await traverseFileTree(tree, files);

    expect(files.map((f) => f.webkitRelativePath)).toEqual(['assets/app.css']);
  });

  it('supports re-reading the same directory (fresh reader per createReader)', async () => {
    const tree = dirEntry('dist', [fileEntry('index.html', '<html>')]);

    const first: File[] = [];
    const second: File[] = [];
    await traverseFileTree(tree, first, 'dist');
    await traverseFileTree(tree, second, 'dist');

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });
});
