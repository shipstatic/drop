/**
 * `FileSystemEntry` traversal — the drag-and-drop folder API.
 *
 * This module is alone in its file for a testing reason that is also an
 * architectural one: `FileSystemEntry` objects cannot be constructed. They come
 * from a real user gesture over real OS paths, so no browser — Chromium
 * included — lets a test produce one. Every OTHER module in this package is
 * exercised against real platform objects; this is the single boundary where a
 * fake is unavoidable, and keeping it to one file keeps that statement true.
 */
import { setRelativePath } from './files';

/** What a person is told when part of a dropped folder cannot be read. */
export function unreadable(path: string): string {
  return `We couldn't read ${path}. Make sure it's on this computer, then try again.`;
}

/** A read that either succeeds or fails naming what could not be read. */
async function readOrRefuse<T>(path: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    throw new Error(unreadable(path));
  }
}

/**
 * Recursively collect Files from a dropped entry, setting `webkitRelativePath`
 * so folder structure survives.
 *
 * `node_modules` directories are skipped wholesale — never part of a valid
 * deployment, and traversing one costs real time on a source-project drop
 * (50K+ files).
 *
 * A file or folder that cannot be read fails the whole collection, naming it.
 * Skipping it would deploy a site without it, or send a project without its
 * `.gitignore` and so with every file that `.gitignore` keeps private. The
 * folder picker fails the same way, at upload.
 */
export async function traverseFileTree(
  entry: FileSystemEntry,
  files: File[],
  currentPath = '',
): Promise<void> {
  if (entry.isFile) {
    const path = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    const file = await readOrRefuse(
      path,
      () =>
        new Promise<File>((resolve, reject) => {
          (entry as FileSystemFileEntry).file(resolve, reject);
        }),
    );
    setRelativePath(file, path);
    files.push(file);
    return;
  }

  if (!entry.isDirectory) return;

  const children = await readOrRefuse(currentPath || entry.name, () =>
    readDirectory(entry as FileSystemDirectoryEntry),
  );
  for (const child of children) {
    if (child.isDirectory && child.name === 'node_modules') continue;

    // Entering a directory extends the path; a file's own name is appended by
    // the branch above, so it inherits the current path unchanged.
    const childPath = child.isDirectory
      ? currentPath
        ? `${currentPath}/${child.name}`
        : child.name
      : currentPath;
    await traverseFileTree(child, files, childPath);
  }
}

/**
 * Read a directory to exhaustion.
 *
 * `readEntries` yields at most 100 entries per call and signals the end with an
 * empty batch, so a single call silently truncates any larger folder. Looping
 * until empty is the contract, not an optimization.
 */
async function readDirectory(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const entries: FileSystemEntry[] = [];

  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
}
