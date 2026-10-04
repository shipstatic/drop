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
import { FileValidationStatus, WEB_FILE_ACCEPT } from '@shipstatic/types';
import { useCallback, useMemo, useRef, useState } from 'react';
import { traverseFileTree } from './entries';
import { setRelativePath } from './files';
import { COULDNT_PREPARE, processFiles as runPipeline } from './process';
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

/**
 * Which picker `getInputProps()` describes and `open()` opens.
 *
 * **Folder is the default**, so a bare `getInputProps()` / `open()` — and the
 * dropzone's own click — address the folder picker exactly as they always have.
 *
 * The singular/plural mix is deliberate: you pick one folder or many files, and
 * these are the words the buttons above them carry.
 */
export type PickerMode = 'folder' | 'files';

/**
 * The hidden input to spread onto an `<input>`.
 *
 * One shape for both modes, because exactly one attribute distinguishes them:
 * `webkitdirectory` makes the dialog a folder picker, and `accept` biases a file
 * picker's default view. Never both — a folder picker ignores `accept`, so
 * emitting it there would advertise a filter that does not apply.
 */
export interface DropInputProps {
  ref: React.RefObject<HTMLInputElement | null>;
  type: 'file';
  style: { display: string };
  multiple: boolean;
  /** Folder mode only — the attribute that makes it a folder picker. */
  webkitdirectory?: string;
  /**
   * Files mode only. A HINT, not a gate: every dialog offers an all-files
   * escape and drag-and-drop ignores `accept` outright, so the verdict on any
   * file is `validateFiles` downstream — the same one the dropzone reaches.
   */
  accept?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
  /**
   * Props to spread on a hidden file input element, one per picker mode.
   *
   * Each mode owns its own element and its own ref, so a UI offering both
   * renders both inputs — `open(mode)` clicks whichever is mounted.
   */
  getInputProps: (mode?: PickerMode) => DropInputProps;

  /** Programmatically trigger a picker (default: the folder picker) */
  open: (mode?: PickerMode) => void;
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

  // The preparation run in flight, if any. A run is one selection from the
  // moment it is made: collecting its files (a dropped folder is read
  // asynchronously), reading the limits, the pipeline. One controller per run
  // does three jobs: its presence is the synchronous re-entry guard (React
  // state is too late to gate a second drop), its signal stops the limits read
  // when the run is cancelled, and its `aborted` flag is how a run that was
  // cancelled knows to say nothing more. Preparation outlives a cancel (a
  // folder being read, an archive being inflated, a request already sent), so
  // without that last one a retired run would finish over whatever the person
  // selected next.
  const runRef = useRef<AbortController | null>(null);
  // One ref per picker: an <input> is either a folder picker or a file picker,
  // and toggling `webkitdirectory` on a live node to reuse a single element
  // would mean writing an attribute behind React's back.
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const isProcessing = state.phase === 'processing';
  const hasError = state.phase === 'error';
  const isInteractive = state.phase === 'idle' || state.phase === 'ready';

  const validFiles = useMemo(
    () => state.files.filter((f) => f.status === FileValidationStatus.READY),
    [state.files],
  );

  const getFilesForUpload = useCallback(() => validFiles.map((f) => f.file), [validFiles]);

  // One selection, start to finish. `collect` is how its files arrive: at once
  // from a picker, or after a dropped folder has been read.
  const prepare = useCallback(
    async (collect: () => Promise<File[]>) => {
      if (runRef.current) {
        console.warn('File processing already in progress. Ignoring duplicate call.');
        return;
      }

      const run = new AbortController();
      runRef.current = run;
      setState({
        ...initialState,
        phase: 'processing',
        status: { title: 'Processing...', details: 'Validating and preparing files.' },
      });

      try {
        // The files and the limits are independent, so they are gathered
        // together: the platform is asked while a dropped folder is read.
        const [files, limits] = await Promise.all([
          collect(),
          ship.getLimits({ signal: run.signal }),
        ]);
        if (run.signal.aborted) return;
        // A dropped folder with nothing in it to read. The pipeline is never
        // asked: there is no file to give a verdict on.
        if (files.length === 0) {
          setState({
            ...initialState,
            phase: 'error',
            status: { title: 'Empty Folder', details: 'It has no files to deploy.' },
          });
          return;
        }

        const outcome = await runPipeline(files, {
          limits,
          // The pipeline says its status before its first wait, so a
          // cancelled run has none left to say.
          onStatus: (status) => setState((prev) => ({ ...prev, status })),
        });
        if (run.signal.aborted) return;

        setState({
          phase: outcome.phase,
          isDragging: false,
          files: outcome.files,
          sourceName: outcome.sourceName,
          status: outcome.status,
          needsBuild: outcome.needsBuild,
        });
      } catch (error) {
        // Folder reading skips what it cannot read and the pipeline never
        // throws, so this is the limits read: the platform could not be asked
        // what it accepts. Said in the error state like any other failed
        // preparation, in the client's own words; a cancelled run's rejection
        // is the cancel itself and says nothing.
        if (run.signal.aborted) return;
        setState({
          ...initialState,
          phase: 'error',
          status: {
            title: COULDNT_PREPARE,
            details: error instanceof Error ? error.message : String(error),
          },
        });
      } finally {
        // Only its own slot: a run cancelled long ago must not free the guard
        // of the run that replaced it.
        if (runRef.current === run) runRef.current = null;
      }
    },
    [ship],
  );

  const processFiles = useCallback(
    async (newFiles: File[]) => {
      if (!newFiles || newFiles.length === 0) return;
      await prepare(async () => newFiles);
    },
    [prepare],
  );

  const reset = useCallback(() => {
    runRef.current?.abort();
    runRef.current = null;
    setState(initialState);
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

      // The drag data is only valid synchronously: the browser invalidates it
      // at the first await, so every entry is captured here and the folders are
      // read afterwards, inside the run.
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

      // A drop that carries no files is not a selection, and leaves the
      // current one alone.
      if (directories.length === 0 && files.length === 0) return;

      await prepare(async () => {
        await Promise.all(directories.map((d) => traverseFileTree(d.entry, files, d.path)));
        return files;
      });
    },
    [prepare],
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

  // `files` is the exception, so any other value — including a stray argument —
  // resolves to the folder picker, and the default is written once.
  const open = useCallback((mode?: PickerMode) => {
    const input = mode === 'files' ? filesInputRef.current : folderInputRef.current;
    if (!input) {
      console.warn(
        `No ${mode === 'files' ? 'files' : 'folder'} input is mounted. Spread getInputProps('${mode === 'files' ? 'files' : 'folder'}') onto an <input> to open this picker.`,
      );
      return;
    }
    input.click();
  }, []);

  const getDropzoneProps = useCallback(
    (options?: DropzonePropsOptions) => {
      const { clickable = true } = options ?? {};
      return {
        onDragOver: handleDragOver,
        onDragLeave: handleDragLeave,
        onDrop: handleDrop,
        // Wrapped rather than passed by reference: `open` takes a mode, and a
        // click handler would hand it a MouseEvent.
        ...(clickable && { onClick: () => open() }),
      };
    },
    [handleDragOver, handleDragLeave, handleDrop, open],
  );

  const getInputProps = useCallback(
    (mode?: PickerMode): DropInputProps => ({
      ref: mode === 'files' ? filesInputRef : folderInputRef,
      type: 'file' as const,
      style: { display: 'none' },
      multiple: true,
      ...(mode === 'files' ? { accept: WEB_FILE_ACCEPT } : { webkitdirectory: '' }),
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
