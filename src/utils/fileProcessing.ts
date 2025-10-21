/**
 * Unified file processing utilities
 * Converts Files directly to ProcessedFiles with validation
 */
import SparkMD5 from 'spark-md5';
import { getMimeType } from './mimeType';
import { FILE_STATUSES, type ProcessedFile, type ValidationConfig, type ClientError, type FileStatus } from '../types';

/**
 * Calculate MD5 hash from ArrayBuffer
 */
export async function calculateMD5(buffer: ArrayBuffer): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  spark.append(buffer);
  return spark.end();
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Create a ProcessedFile from a File object
 * This is the single conversion point from File to ProcessedFile
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
    /** Whether to calculate MD5 hash (defaults to true) */
    calculateMD5?: boolean;
  }
): Promise<ProcessedFile> {
  // Priority: custom path > webkitRelativePath > file.name
  const webkitPath = (file as any).webkitRelativePath || '';
  const path = options?.path || (webkitPath && webkitPath.trim() ? webkitPath : file.name);
  const shouldCalculateMD5 = options?.calculateMD5 !== false;

  // Determine MIME type
  const type = file.type || getMimeType(path);

  // Calculate MD5 if requested
  let md5: string | undefined;
  let status: FileStatus = FILE_STATUSES.PENDING;
  let statusMessage: string | undefined;

  if (shouldCalculateMD5) {
    try {
      const buffer = await file.arrayBuffer();
      md5 = await calculateMD5(buffer);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error calculating MD5 for ${path}:`, error);

      // Mark file as failed if MD5 calculation fails
      status = FILE_STATUSES.PROCESSING_ERROR;
      statusMessage = `Failed to calculate checksum: ${errorMsg}`;
    }
  }

  return {
    // StaticFile properties (SDK compatibility)
    content: file,
    path,
    size: file.size,
    md5,
    // ProcessedFile-specific properties (UI functionality)
    id: crypto.randomUUID(),
    file,  // Keep as alias for better DX
    name: path.split('/').pop() || file.name,
    type,
    lastModified: file.lastModified,
    status,
    statusMessage,
  };
}

/**
 * Validate and update status of ProcessedFiles
 * Returns files with updated status and validation error if any
 */
export interface ValidationResult {
  /** All files with updated status */
  files: ProcessedFile[];
  /** Files that passed validation (status: READY) */
  validFiles: ProcessedFile[];
  /** Validation error if any files failed */
  error: ClientError | null;
}

export function validateFiles(
  files: ProcessedFile[],
  config: ValidationConfig
): ValidationResult {
  const result: ProcessedFile[] = [];
  const validFiles: ProcessedFile[] = [];
  let error: ClientError | null = null;

  // Check file count
  if (files.length > config.maxFilesCount) {
    error = {
      error: 'File Count Exceeded',
      details: `Number of files (${files.length}) exceeds the limit of ${config.maxFilesCount}.`,
      isClientError: true,
    };

    // Mark all files as failed
    return {
      files: files.map(f => ({
        ...f,
        status: FILE_STATUSES.VALIDATION_FAILED,
        statusMessage: error!.details,
      })),
      validFiles: [],
      error,
    };
  }

  // Validate each file
  let totalSize = 0;
  for (const file of files) {
    // Skip files that already failed during processing (e.g., MD5 calculation failure)
    if (file.status === FILE_STATUSES.PROCESSING_ERROR) {
      result.push(file);
      if (!error) {
        error = {
          error: 'Processing Error',
          details: file.statusMessage || 'A file failed during processing.',
          isClientError: true,
        };
      }
      continue;
    }

    // Check for empty files
    if (file.size === 0) {
      result.push({
        ...file,
        status: FILE_STATUSES.EMPTY_FILE,
        statusMessage: 'File is empty (0 bytes)',
      });
      if (!error) {
        error = {
          error: 'Empty File',
          details: `File ${file.name} is empty (0 bytes).`,
          isClientError: true,
        };
      }
      continue;
    }

    // Check individual file size
    if (file.size > config.maxFileSize) {
      result.push({
        ...file,
        status: FILE_STATUSES.VALIDATION_FAILED,
        statusMessage: `File size (${formatFileSize(file.size)}) exceeds limit of ${formatFileSize(config.maxFileSize)}`,
      });
      if (!error) {
        error = {
          error: 'File Too Large',
          details: `File ${file.name} (${formatFileSize(file.size)}) exceeds individual file size limit of ${formatFileSize(config.maxFileSize)}.`,
          isClientError: true,
        };
      }
      continue;
    }

    totalSize += file.size;

    // Check total size
    if (totalSize > config.maxTotalSize) {
      result.push({
        ...file,
        status: FILE_STATUSES.VALIDATION_FAILED,
        statusMessage: `Total size would exceed limit of ${formatFileSize(config.maxTotalSize)}`,
      });
      if (!error) {
        error = {
          error: 'Total Size Exceeded',
          details: `Total size of files (${formatFileSize(totalSize)}) exceeds the limit of ${formatFileSize(config.maxTotalSize)}.`,
          isClientError: true,
        };
      }
      continue;
    }

    // File is valid
    const validFile = {
      ...file,
      status: FILE_STATUSES.READY,
      statusMessage: 'Ready for upload',
    };
    result.push(validFile);
    validFiles.push(validFile);
  }

  return { files: result, validFiles, error };
}

/**
 * Get only the valid files (status: READY) from a list
 */
export function getValidFiles(files: ProcessedFile[]): ProcessedFile[] {
  return files.filter(f => f.status === FILE_STATUSES.READY);
}

/**
 * Check if all valid files have MD5 checksums calculated
 */
export function allValidFilesHaveChecksums(files: ProcessedFile[]): boolean {
  const validFiles = getValidFiles(files);

  // Return false for empty array (no valid files = no checksums)
  if (validFiles.length === 0) {
    return false;
  }

  return validFiles.every(f => f.md5 !== undefined);
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

  return files.map(f => ({
    ...f,
    path: f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path,
  }));
}

