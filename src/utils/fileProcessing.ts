import { optimizeDeployPaths } from '@shipstatic/ship';
import { getMimeType } from './mimeType';
import { FILE_STATUSES, type ProcessedFile } from '../types';

/**
 * File processing utilities for the drop hook.
 */

/**
 * Format file size to human-readable string.
 * Re-exported from Ship SDK for consumer convenience.
 */
export { formatFileSize } from '@shipstatic/ship';

/**
 * Patch a File's `webkitRelativePath` so downstream consumers (the Ship SDK)
 * read our resolved deploy path. Browser-set `webkitRelativePath` is read-only,
 * so we redefine the property — `configurable: true` allows re-patching later.
 */
export function setRelativePath(file: File, path: string): void {
  Object.defineProperty(file, 'webkitRelativePath', {
    value: path,
    writable: false,
    configurable: true,
  });
}

/**
 * Create a ProcessedFile from a File object
 * This is the single conversion point from File to ProcessedFile
 *
 * Note: MD5 calculation is handled by Ship SDK during deployment.
 * Drop focuses on file processing, path normalization, and UI state management.
 *
 * Path resolution priority:
 * 1. options.path (if provided)
 * 2. file.webkitRelativePath (if non-empty, preserves folder structure)
 * 3. file.name (fallback)
 */
export function createProcessedFile(
  file: File,
  options?: {
    /** Custom path (defaults to webkitRelativePath or file.name) */
    path?: string;
  }
): ProcessedFile {
  // Priority: custom path > webkitRelativePath > file.name
  const path = options?.path || file.webkitRelativePath?.trim() || file.name;

  // Prefer mime-db lookup over the browser-reported type — browsers often
  // return incorrect MIME types (e.g. text/plain for .map, .scss).
  const type = getMimeType(path) || file.type;

  return {
    // md5 is intentionally undefined — Ship SDK calculates it during deployment.
    id: crypto.randomUUID(),
    file,
    path,
    size: file.size,
    name: path.split('/').pop() || file.name,
    type,
    lastModified: file.lastModified,
    status: FILE_STATUSES.PENDING,
  };
}

/**
 * Strip common directory prefix from file paths.
 *
 * Delegates the path algorithm to Ship SDK's `optimizeDeployPaths` (the single
 * source of truth for deploy-path normalization) and mutates each underlying
 * File's `webkitRelativePath` so downstream consumers (Ship SDK) read the
 * stripped path when given the raw File objects.
 */
export function stripCommonPrefix(files: ProcessedFile[]): ProcessedFile[] {
  if (files.length === 0) return files;

  const deployFiles = optimizeDeployPaths(files.map(f => f.path));

  return files.map((f, i) => {
    const newPath = deployFiles[i].path;
    setRelativePath(f.file, newPath);
    return { ...f, path: newPath };
  });
}

/**
 * Recursively traverse FileSystemEntry from drag & drop to collect all files
 * Properly sets webkitRelativePath to preserve folder structure
 */
export async function traverseFileTree(
  entry: FileSystemEntry,
  files: File[],
  currentPath = ''
): Promise<void> {
  try {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      const relativePath = currentPath
        ? `${currentPath}/${file.name}`
        : file.name;
      setRelativePath(file, relativePath);
      files.push(file);
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      let allEntries: FileSystemEntry[] = [];

      // Read all entries (may require multiple calls due to browser limits)
      const readEntriesBatch = async (): Promise<void> => {
        const batch = await new Promise<FileSystemEntry[]>(
          (resolve, reject) => {
            dirReader.readEntries(resolve, reject);
          }
        );
        if (batch.length > 0) {
          allEntries = allEntries.concat(batch);
          await readEntriesBatch();
        }
      };
      await readEntriesBatch();

      for (const childEntry of allEntries) {
        // Skip node_modules entirely — never part of a valid deployment,
        // and traversing it wastes time/memory for large projects (50K+ files)
        if (childEntry.isDirectory && childEntry.name === 'node_modules') {
          continue;
        }

        // For directories: include directory name in path (we're entering it)
        // For files: don't include filename (it will be appended when processing the file)
        const entryPath = childEntry.isDirectory
          ? (currentPath ? `${currentPath}/${childEntry.name}` : childEntry.name)
          : currentPath;
        await traverseFileTree(childEntry, files, entryPath);
      }
    }
  } catch (error) {
    console.warn(`Error traversing file tree for entry ${entry.name}:`, error);
  }
}
