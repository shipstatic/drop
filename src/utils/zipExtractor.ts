/**
 * Simple ZIP extraction utility
 * Extracts ZIP files and returns regular File objects
 */
import JSZip from 'jszip';
import { getMimeType } from './mimeType';

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
  const files: File[] = [];
  const errors: string[] = [];

  try {
    const arrayBuffer = await zipFile.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    for (const [path, entry] of Object.entries(zip.files)) {
      // Skip directories
      if (entry.dir) continue;

      // Sanitize path to prevent directory traversal attacks
      const sanitizedPath = normalizePath(path);

      // Skip if path is empty after normalization (e.g., all "../..")
      if (!sanitizedPath) {
        errors.push(`Skipped invalid path: ${path}`);
        continue;
      }

      try {
        const content = await entry.async('blob');
        const mimeType = getMimeType(sanitizedPath);

        // Create a regular File object with the sanitized path as the name
        const file = new File([content], sanitizedPath, {
          type: mimeType,
          lastModified: entry.date?.getTime() || Date.now(),
        });

        files.push(file);
      } catch (error) {
        errors.push(`Failed to extract ${sanitizedPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
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
