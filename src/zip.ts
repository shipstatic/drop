/**
 * ZIP extraction — archive bytes in, regular File objects out.
 */
import { type Unzipped, unzip } from 'fflate';
import { setRelativePath } from './files';

export interface ZipExtractionResult {
  /** Extracted files as regular File objects */
  files: File[];
  /** The entries left out, each with its reason */
  errors: string[];
}

/**
 * Extracts all files from a ZIP archive. An archive that cannot be opened
 * rejects with a sentence that names it; an entry that cannot be published is
 * left out and listed in `errors`.
 *
 * Uses fflate's ASYNCHRONOUS `unzip`, which inflates off the main thread. The
 * synchronous variant would block the tab for the duration — unacceptable on
 * this package's headline interaction, where a large folder is the normal case.
 */
export async function extractZipToFiles(zipFile: File): Promise<ZipExtractionResult> {
  const bytes = new Uint8Array(await zipFile.arrayBuffer());
  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (err, data) =>
      err
        ? reject(
            new Error(`We couldn't open ${zipFile.name}. It may be damaged, or not a ZIP file.`),
          )
        : resolve(data),
    );
  });

  const files: File[] = [];
  const errors: string[] = [];

  for (const [path, data] of Object.entries(entries)) {
    // Skip directory entries
    if (path.endsWith('/') && data.length === 0) continue;

    const sanitizedPath = normalizePath(path);

    // Empty after normalization (e.g. all "../..") has no servable address
    if (!sanitizedPath) {
      errors.push(`Skipped invalid path: ${path}`);
      continue;
    }

    const filename = sanitizedPath.split('/').pop() || sanitizedPath;

    // Copy to own ArrayBuffer (fflate shares backing buffers across entries).
    // No `type` is set: the platform derives Content-Type from the path
    // server-side, and nothing between here and the wire reads it.
    const file = new File([new Uint8Array(data)], filename);

    // Set webkitRelativePath to the full path — same contract as drag-and-drop
    // files. This unifies the path mechanism: every file source carries its
    // deploy path on webkitRelativePath and its bare name on file.name.
    setRelativePath(file, sanitizedPath);

    files.push(file);
  }

  return { files, errors };
}

/**
 * Sanitize and normalize an archive entry path to prevent directory traversal.
 * Removes: .., ., leading/trailing slashes, absolute paths, and empty segments.
 *
 * @example
 * normalizePath('../../etc/passwd') → 'etc/passwd'
 * normalizePath('foo/./bar/../baz.txt') → 'foo/baz.txt'
 * normalizePath('/absolute/path.txt') → 'absolute/path.txt'
 */
export function normalizePath(path: string): string {
  const normalized: string[] = [];

  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;

    if (segment === '..') {
      // Pop only when there is somewhere to go back to — this is what prevents
      // traversal above the archive root.
      normalized.pop();
      continue;
    }

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
