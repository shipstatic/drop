/**
 * @shipstatic/drop — headless file dropping, ZIP extraction and validation for
 * Ship SDK deployments.
 *
 * This surface is curated, not swept: the modules behind it export helpers that
 * are deliberately NOT public (path patching, status stamping, the SDK
 * projection, entry traversal), because publishing them would put semver around
 * implementation detail.
 *
 * Two entry points, one per altitude:
 *
 * - `useDrop` — the React hook (state, DOM events, prop getters)
 * - `processFiles` — the same pipeline without React, for any other UI layer
 *
 * The file-status vocabulary is deliberately absent: it is Ship's
 * `FileValidationStatus`, already exported by `@shipstatic/ship`, which every
 * consumer of this package depends on. Re-exporting it here — under this name or
 * another — would put a second name on one object.
 */

export type { DropOutcome, ProcessFilesOptions } from './process';
export { processFiles } from './process';
export type { DropPhase, DropStatus, ProcessedFile } from './types';
export type { DropOptions, DropReturn, DropzonePropsOptions } from './useDrop';
export { useDrop } from './useDrop';
