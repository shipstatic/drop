/**
 * Core types for @shipstatic/dropzone
 * Imports types from @shipstatic/types (single source of truth)
 * and defines dropzone-specific types
 */

// Import SDK types as single source of truth
import type { StaticFile, ConfigResponse } from '@shipstatic/types';

// File statuses during processing
export const FILE_STATUSES = {
  PENDING: "pending",
  PROCESSING: "processing",
  VALIDATION_FAILED: "validation_failed",
  PROCESSING_ERROR: "processing_error",
  EMPTY_FILE: "empty_file",
  READY: "ready",
  UPLOADING: "uploading",
  COMPLETE: "complete",
  ERROR: "error",
} as const;

export type FileStatus = (typeof FILE_STATUSES)[keyof typeof FILE_STATUSES];

/**
 * Client-side error structure
 * Matches ValidationError from @shipstatic/ship for consistency
 */
export interface ClientError {
  error: string;
  details: string;
  errors?: string[];
  isClientError: true;
}

/**
 * Processed file entry ready for upload
 * Extends StaticFile from SDK, adding UI-specific properties
 * This means ProcessedFile IS a StaticFile - can be passed directly to ship.deployments.create()
 */
export interface ProcessedFile extends StaticFile {
  /** Unique identifier for React keys and tracking */
  id: string;
  /** Original File object (alias for 'content' from StaticFile for better DX) */
  file: File;
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

