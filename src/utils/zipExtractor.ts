/**
 * Simple ZIP extraction utility
 * Extracts ZIP files and returns regular File objects
 */
import { unzipSync } from 'fflate';
import { getMimeType } from './mimeType';
import { setRelativePath } from './fileProcessing';

export interface ZipExtractionResult {
  /** Extracted files as regular File objects */
  files: File[];
  /** Any errors encountered during extraction */
  errors: string[];
}

/**
 * Extracts all files from a ZIP archive
 * Returns regular File objects that can be processed like any other file
 */
export async function extractZipToFiles(zipFile: File): Promise<ZipExtractionResult> {
  try {
    const arrayBuffer = await zipFile.arrayBuffer();
    const entries = unzipSync(new Uint8Array(arrayBuffer));

    const files: File[] = [];
    const errors: string[] = [];

    for (const [path, data] of Object.entries(entries)) {
      // Skip directories
      if (path.endsWith('/') && data.length === 0) continue;

      // Sanitize path to prevent directory traversal attacks
      const sanitizedPath = normalizePath(path);

      // Skip if path is empty after normalization (e.g., all "../..")
      if (!sanitizedPath) {
        errors.push(`Skipped invalid path: ${path}`);
        continue;
      }

      const mimeType = getMimeType(sanitizedPath);
      const filename = sanitizedPath.split('/').pop() || sanitizedPath;

      // Copy to own ArrayBuffer (fflate shares backing buffers across entries)
      const file = new File([new Uint8Array(data)], filename, {
        type: mimeType,
      });

      // Set webkitRelativePath to the full path — same contract as drag-and-drop files.
      // This unifies the path mechanism: all file sources use webkitRelativePath for paths
      // and file.name for the bare filename.
      setRelativePath(file, sanitizedPath);

      files.push(file);
    }

    return { files, errors };
  } catch (error) {
    return {
      files: [],
      errors: [`Failed to load ZIP file: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/**
 * Sanitize and normalize a file path to prevent directory traversal attacks
 * Removes: .., ., leading/trailing slashes, absolute paths, and empty segments
 *
 * @example
 * normalizePath('../../etc/passwd') → 'etc/passwd'
 * normalizePath('foo/./bar/../baz.txt') → 'foo/baz.txt'
 * normalizePath('/absolute/path.txt') → 'absolute/path.txt'
 */
export function normalizePath(path: string): string {
  // Split path into segments
  const segments = path.split('/');
  const normalized: string[] = [];

  for (const segment of segments) {
    // Skip empty segments and current directory references
    if (segment === '' || segment === '.') {
      continue;
    }

    // Handle parent directory references
    if (segment === '..') {
      // Only pop if we have segments to go back to
      // This prevents traversal above the root
      if (normalized.length > 0) {
        normalized.pop();
      }
      // If normalized is empty, we're trying to traverse above root - skip it
      continue;
    }

    // Add valid segment
    normalized.push(segment);
  }

  return normalized.join('/');
}

/**
 * Check if a file is a ZIP file based on MIME type or extension
 */
export function isZipFile(file: File): boolean {
  return (
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    file.name.toLowerCase().endsWith('.zip')
  );
}
