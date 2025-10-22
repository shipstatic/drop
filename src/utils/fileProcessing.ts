/**
 * Unified file processing utilities
 * Converts Files directly to ProcessedFiles
 */
import {
  formatFileSize as shipFormatFileSize,
  getValidFiles as shipGetValidFiles,
} from '@shipstatic/ship';
import { getMimeType } from './mimeType';
import { FILE_STATUSES, type ProcessedFile, type FileStatus } from '../types';

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
export async function createProcessedFile(
  file: File,
  options?: {
    /** Custom path (defaults to webkitRelativePath or file.name) */
    path?: string;
  }
): Promise<ProcessedFile> {
  // Priority: custom path > webkitRelativePath > file.name
  const webkitPath = (file as any).webkitRelativePath || '';
  const path = options?.path || (webkitPath && webkitPath.trim() ? webkitPath : file.name);

  // Determine MIME type
  const type = file.type || getMimeType(path);

  return {
    // StaticFile properties (SDK compatibility)
    // Note: md5 is intentionally undefined - Ship SDK will calculate it during deployment
    content: file,
    path,
    size: file.size,
    // ProcessedFile-specific properties (UI functionality)
    id: crypto.randomUUID(),
    file,  // Keep as alias for better DX
    name: path.split('/').pop() || file.name,
    type,
    lastModified: file.lastModified,
    status: FILE_STATUSES.PENDING,
  };
}

/**
 * Get only the valid files (status: READY) from a list
 * Re-exported from Ship SDK for convenience
 */
export const getValidFiles = shipGetValidFiles<ProcessedFile>;

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

  return files.map(f => ({
    ...f,
    path: f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path,
  }));
}

