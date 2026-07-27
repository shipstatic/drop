/**
 * Core types for @shipstatic/drop.
 *
 * `@shipstatic/types` owns the file-validation vocabulary and drop uses it by its
 * real name — `FileValidationStatus`, reachable from `@shipstatic/ship`, which
 * every consumer already depends on. Re-badging it as a drop-local
 * `FILE_STATUSES` would put a second name on one object and leave a consumer of
 * both packages wondering whether they differ.
 *
 * Drop adds no statuses of its own, so `ProcessedFile` stays expressible as a
 * `ValidatableFile` and the packages can never disagree about what "ready" means.
 */

import type { FileValidationStatusType } from '@shipstatic/types';

/**
 * A file prepared for deployment.
 *
 * `path` is the deploy identity; `name` is the basename, for display. Ship
 * computes checksums during upload, so no `md5` lives here.
 */
export interface ProcessedFile {
  /** Unique identifier for React keys and tracking */
  id: string;
  /** The File object — pass this to ship.deployments.upload() */
  file: File;
  /** Relative path for deployment (e.g. "images/photo.jpg") */
  path: string;
  /** File size in bytes */
  size: number;
  /** Filename without path — for display; `path` is the deploy identity */
  name: string;
  /** MIME type as reported by the browser, for UI icons/previews */
  type: string;
  /** Last modified timestamp */
  lastModified: number;
  /** Current processing status */
  status: FileValidationStatusType;
  /** Human-readable status message for UI */
  statusMessage?: string;
}

/**
 * Phase of the drop lifecycle.
 *
 * Dragging is not a phase — it is a pointer state that can occur over any of
 * these, carried separately as `isDragging`.
 */
export type DropPhase = 'idle' | 'processing' | 'ready' | 'error';

/** What to show the user about the current phase. */
export interface DropStatus {
  title: string;
  details: string;
  /** Per-item breakdown, for multi-error cases */
  errors?: string[];
  /** Non-blocking issues (e.g. excluded empty files) */
  warnings?: string[];
}
