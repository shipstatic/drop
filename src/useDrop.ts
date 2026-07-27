/**
 * Headless drop hook for file upload workflows.
 *
 * This file owns React state, DOM events, and prop getters — nothing else. The
 * rules live in `./process` as a plain function.
 *
 * ```tsx
 * const drop = useDrop({ ship });
 *
 * <div {...drop.getDropzoneProps()}>
 *   <input {...drop.getInputProps()} />
 *   {drop.isDragging ? 'Drop here' : 'Click to upload'}
 * </div>
 * ```
 */
import type { Ship } from '@shipstatic/ship';
import { FileValidationStatus } from '@shipstatic/types';
import { useCallback, useMemo, useRef, useState } from 'react';
import { traverseFileTree } from './entries';
import { setRelativePath } from './files';
import { processFiles as runPipeline } from './process';
import type { DropPhase, DropStatus, ProcessedFile } from './types';

export interface DropOptions {
  /**
   * The Ship client, for platform limits.
   *
   * Typed as only what drop calls, mirroring the SDK's own resource-factory
   * doctrine — a real `Ship` satisfies it, and nothing else has to be faked.
   */
  ship: Pick<Ship, 'getLimits'>;
}

/** Options for `getDropzoneProps()` */
export interface DropzonePropsOptions {
  /** Whether clicking the dropzone opens the file picker (default: true) */
  clickable?: boolean;
}

export interface DropReturn {
  /** Current phase of the lifecycle */
  phase: DropPhase;
  /** Whether files are being processed (extraction, validation) */
  isProcessing: boolean;
  /** Whether the user is currently dragging over the dropzone */
  isDragging: boolean;
  /** Whether the dropzone is idle or holding a ready set */
  isInteractive: boolean;
  /** Whether an error occurred during processing */
  hasError: boolean;
  /** All processed files */
  files: ProcessedFile[];
  /** Friendly name of what was dropped (ZIP name, folder name, or filename) */
  sourceName: string;
  /** Current status for display */
  status: DropStatus | null;
  /** Whether the dropped files need server-side building before deployment */
  needsBuild: boolean;

  /** Props to spread on the dropzone element (drag & drop, optionally click) */
  getDropzoneProps: (options?: DropzonePropsOptions) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onClick?: () => void;
  };
  /** Props to spread on the hidden file input element */
  getInputProps: () => {
    ref: React.RefObject<HTMLInputElement | null>;
    type: 'file';
    style: { display: string };
    multiple: boolean;
    webkitdirectory: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  };

  /** Programmatically trigger the file picker */
  open: () => void;
  /** Process files directly (advanced — loses folder traversal) */
  processFiles: (files: File[]) => Promise<void>;
  /** Reset state and clear all files */
  reset: () => void;

  /** Only the files that passed validation */
  validFiles: ProcessedFile[];
  /** Raw File objects ready for Ship SDK upload */
  getFilesForUpload: () => File[];
}

interface DropState {
  phase: DropPhase;
  isDragging: boolean;
  files: ProcessedFile[];
  sourceName: string;
  status: DropStatus | null;
  needsBuild: boolean;
}

const initialState: DropState = {
  phase: 'idle',
  isDragging: false,
  files: [],
  sourceName: '',
  status: null,
  needsBuild: false,
};

export function useDrop({ ship }: DropOptions): DropReturn {
  const [state, setState] = useState<DropState>(initialState);

  // Synchronous re-entry guard — React state is too late to gate a second drop
  const isProcessingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isProcessing = state.phase === 'processing';
  const hasError = state.phase === 'error';
  const isInteractive = state.phase === 'idle' || state.phase === 'ready';

  const validFiles = useMemo(
    () => state.files.filter((f) => f.status === FileValidationStatus.READY),
    [state.files],
  );

  const getFilesForUpload = useCallback(() => validFiles.map((f) => f.file), [validFiles]);

  const processFiles = useCallback(
    async (newFiles: File[]) => {
      if (isProcessingRef.current) {
        console.warn('File processing already in progress. Ignoring duplicate call.');
        return;
      }
      if (!newFiles || newFiles.length === 0) return;

      isProcessingRef.current = true;
      setState({
        ...initialState,
        phase: 'processing',
        status: { title: 'Processing...', details: 'Validating and preparing files.' },
      });

      try {
        const outcome = await runPipeline(newFiles, {
          limits: await ship.getLimits(),
          onStatus: (status) => setState((prev) => ({ ...prev, status })),
        });

        setState({
          phase: outcome.phase,
          isDragging: false,
          files: outcome.files,
          sourceName: outcome.sourceName,
          status: outcome.status,
          needsBuild: outcome.needsBuild,
        });
      } finally {
        isProcessingRef.current = false;
      }
    },
    [ship],
  );

  const reset = useCallback(() => {
    setState(initialState);
    isProcessingRef.current = false;
  }, []);

  // Dragging is orthogonal to the phase: the flag flips, the phase is untouched.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState((prev) => (prev.isDragging ? prev : { ...prev, isDragging: true }));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState((prev) => (prev.isDragging ? { ...prev, isDragging: false } : prev));
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setState((prev) => (prev.isDragging ? { ...prev, isDragging: false } : prev));

      const files: File[] = [];
      const directories: { entry: FileSystemEntry; path: string }[] = [];

      // `dataTransfer.items` is only valid synchronously — the browser
      // invalidates the list at the first await, so every entry is captured here
      // and traversed afterwards.
      for (const item of Array.from(e.dataTransfer.items)) {
        if (item.kind !== 'file') continue;
        try {
          const entry = item.webkitGetAsEntry?.();
          if (entry?.isDirectory) {
            directories.push({ entry, path: entry.name });
          } else {
            const file = item.getAsFile();
            if (file) {
              // Root files carry their own name as path, matching traverseFileTree
              setRelativePath(file, file.name);
              files.push(file);
            }
          }
        } catch (error) {
          console.warn('Error processing drop item:', error);
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      await Promise.all(directories.map((d) => traverseFileTree(d.entry, files, d.path)));

      // Browsers without webkitGetAsEntry still populate dataTransfer.files
      if (files.length === 0 && e.dataTransfer.files.length > 0) {
        files.push(...Array.from(e.dataTransfer.files));
      }

      if (files.length > 0) await processFiles(files);
    },
    [processFiles],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) processFiles(files);
      // Clear the input so re-selecting the same folder fires onChange again
      e.target.value = '';
    },
    [processFiles],
  );

  const open = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const getDropzoneProps = useCallback(
    (options?: DropzonePropsOptions) => {
      const { clickable = true } = options ?? {};
      return {
        onDragOver: handleDragOver,
        onDragLeave: handleDragLeave,
        onDrop: handleDrop,
        ...(clickable && { onClick: open }),
      };
    },
    [handleDragOver, handleDragLeave, handleDrop, open],
  );

  const getInputProps = useCallback(
    () => ({
      ref: inputRef,
      type: 'file' as const,
      style: { display: 'none' },
      multiple: true,
      webkitdirectory: '',
      onChange: handleInputChange,
    }),
    [handleInputChange],
  );

  return {
    phase: state.phase,
    isProcessing,
    isDragging: state.isDragging,
    isInteractive,
    hasError,
    files: state.files,
    sourceName: state.sourceName,
    status: state.status,
    needsBuild: state.needsBuild,

    getDropzoneProps,
    getInputProps,

    open,
    processFiles,
    reset,

    validFiles,
    getFilesForUpload,
  };
}
