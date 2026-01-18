/**
 * Core types for @shipstatic/drop
 * Imports types from @shipstatic/types (single source of truth)
 * and defines drop-specific types
 */

import type { ValidationError } from '@shipstatic/types';
import { FileValidationStatus } from '@shipstatic/types';

/**
 * Extended File interface with webkitRelativePath
 * This property is set by browsers for folder uploads and drag-drop
 * https://developer.mozilla.org/en-US/docs/Web/API/File/webkitRelativePath
 */
export interface FileWithPath extends File {
  readonly webkitRelativePath: string;
}

// File statuses during processing
export const FILE_STATUSES = {
  ...FileValidationStatus,
  PROCESSING: "processing",
  UPLOADING: "uploading",
  COMPLETE: "complete",
  ERROR: "error",
} as const;

export type FileStatus = (typeof FILE_STATUSES)[keyof typeof FILE_STATUSES];

/**
 * Client-side error structure
 * Matches ValidationError from @shipstatic/ship for consistency
 */
export type ClientError = ValidationError;

/**
 * Processed file entry ready for upload
 * Contains both the File object and UI-specific metadata
 * Use `file` property to access the underlying File for SDK operations
 */
export interface ProcessedFile {
  /** Unique identifier for React keys and tracking */
  id: string;
  /** The File object - pass this to ship.deployments.create() */
  file: File;
  /** Relative path for deployment (e.g., "images/photo.jpg") */
  path: string;
  /** File size in bytes */
  size: number;
  /** MD5 hash (optional - Ship SDK calculates during deployment if not provided) */
  md5?: string;
  /** Filename without path */
  name: string;
  /** MIME type for UI icons/previews */
  type: string;
  /** Last modified timestamp */
  lastModified: number;
  /** Current processing/upload status */
  status: FileStatus;
  /** Human-readable status message for UI */
  statusMessage?: string;
  /** Upload progress (0-100) - only set during upload */
  progress?: number;
}

/**
 * State machine values for the drop hook
 */
export type DropStateValue =
  | 'idle'       // The hook is ready for files
  | 'dragging'   // The user is dragging files over the dropzone
  | 'processing' // Files are being validated and processed
  | 'ready'      // Files are valid and ready for deployment
  | 'error';     // An error occurred during processing

/**
 * Status information with title and details
 */
export interface DropStatus {
  title: string;
  details: string;
  errors?: string[];
}

/**
 * State machine state for the drop hook
 */
export interface DropState {
  value: DropStateValue;
  files: ProcessedFile[];
  sourceName: string;
  status: DropStatus | null;
}

