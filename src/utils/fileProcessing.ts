import {
  formatFileSize as shipFormatFileSize,
} from '@shipstatic/ship';
import { getMimeType } from './mimeType';
import { FILE_STATUSES, type ProcessedFile, type FileWithPath } from '../types';

/**
 * Unified file processing utilities
 * Converts Files directly to ProcessedFiles
 */

/**
 * Format file size to human-readable string
 * Re-exported from Ship SDK for convenience
 */
export const formatFileSize = shipFormatFileSize;

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
  const webkitPath = (file as FileWithPath).webkitRelativePath || '';
  const path = options?.path || (webkitPath && webkitPath.trim() ? webkitPath : file.name);

  // Determine MIME type
  // Prioritize mime-db lookup over browser detection for accuracy
  // Browsers often return incorrect MIME types (e.g., text/plain for .map, .scss files)
  const mimeFromDb = getMimeType(path);
  const mimeFromBrowser = file.type;
  const type = mimeFromDb || mimeFromBrowser;

  return {
    // ProcessedFile properties
    // Note: md5 is intentionally undefined - Ship SDK will calculate it during deployment
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
 * Strip common directory prefix from file paths
 * Only strips if ALL files share the same prefix
 */
export function stripCommonPrefix(files: ProcessedFile[]): ProcessedFile[] {
  if (files.length === 0) return files;

  const paths = files.map(f => f.path);
  const segments = paths[0].split('/');

  // Find common prefix by checking each segment
  let commonDepth = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (paths.every(p => p.split('/')[i] === segment)) {
      commonDepth = i + 1;
    } else {
      break;
    }
  }

  // No common prefix
  if (commonDepth === 0) return files;

  const prefix = segments.slice(0, commonDepth).join('/') + '/';

  return files.map(f => {
    const newPath = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;

    // Patch the underlying File object so that downstream consumers (like Ship SDK)
    // see the correct, stripped path when reading webkitRelativePath.
    // This allows passing the raw File objects while preserving the "Drop" logic.
    if (f.file) {
      Object.defineProperty(f.file, 'webkitRelativePath', {
        value: newPath,
        writable: false,
        configurable: true,
      });
    }

    return {
      ...f,
      path: newPath,
    };
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
      Object.defineProperty(file, 'webkitRelativePath', {
        value: relativePath,
        writable: false,
        configurable: true,
      });
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
