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

/**
 * Recursively collect Files from a dropped entry, setting `webkitRelativePath`
 * so folder structure survives.
 *
 * `node_modules` directories are skipped wholesale — never part of a valid
 * deployment, and traversing one costs real time on a source-project drop
 * (50K+ files).
 *
 * Unreadable entries are logged and skipped rather than failing the drop: a
 * partially readable folder still deploys.
 */
export async function traverseFileTree(
  entry: FileSystemEntry,
  files: File[],
  currentPath = '',
): Promise<void> {
  try {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      setRelativePath(file, currentPath ? `${currentPath}/${file.name}` : file.name);
      files.push(file);
      return;
    }

    if (!entry.isDirectory) return;

    for (const child of await readDirectory(entry as FileSystemDirectoryEntry)) {
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
  } catch (error) {
    console.warn(`Error traversing file tree for entry ${entry.name}:`, error);
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
