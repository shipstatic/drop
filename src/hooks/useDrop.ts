/**
 * Headless drop hook for file upload workflows
 *
 * Handles the complex parts:
 * - Drag & drop with folder support
 * - ZIP extraction
 * - Path normalization
 * - File validation
 *
 * Simple usage:
 * ```tsx
 * const drop = useDrop({ ship });
 *
 * <div {...drop.getDropzoneProps()}>
 *   <input {...drop.getInputProps()} />
 *   {drop.isDragging ? "Drop here" : "Click to upload"}
 * </div>
 * ```
 */
import { useState, useCallback, useRef, useMemo } from 'react';
import {
  FILE_STATUSES,
  type ProcessedFile,
  type ClientError,
  type DropState,
  type DropStatus,
  type DropStateValue,
  type FileStatus,
} from '../types';
import { extractZipToFiles, isZipFile } from '../utils/zipExtractor';
import {
  createProcessedFile,
  setRelativePath,
  stripCommonPrefix,
  traverseFileTree,
} from '../utils/fileProcessing';
import { validateFiles, filterJunk, pluralize, type Ship } from '@shipstatic/ship';
import { isShipError, hasUnbuiltMarker, type ValidatableFile } from '@shipstatic/types';

export interface DropOptions {
  /** Ship SDK instance (required for validation) */
  ship: Ship;
  /** Callback when files are processed and ready */
  onFilesReady?: (files: ProcessedFile[]) => void;
  /** Callback when validation fails */
  onValidationError?: (error: ClientError) => void;
  /** Whether to strip common directory prefix from paths (default: true) */
  stripPrefix?: boolean;
}

/** Options for getDropzoneProps() */
export interface DropzonePropsOptions {
  /** Whether clicking the dropzone opens the file picker (default: true) */
  clickable?: boolean;
}

export interface DropReturn {
  // Convenience getters (computed from state)
  /** Current phase of the state machine */
  phase: DropStateValue;
  /** Whether currently processing files (ZIP extraction, etc.) */
  isProcessing: boolean;
  /** Whether user is currently dragging over the dropzone */
  isDragging: boolean;
  /** Whether the dropzone is interactive (idle, dragging, or ready - not processing or error) */
  isInteractive: boolean;
  /** Whether an error occurred during processing */
  hasError: boolean;
  /** Flattened access to files */
  files: ProcessedFile[];
  /** Flattened access to source name */
  sourceName: string;
  /** Flattened access to status */
  status: DropStatus | null;
  /** Whether the dropped files need server-side building before deployment */
  needsBuild: boolean;

  // Primary API: Prop getters for easy integration
  /** Get props to spread on dropzone element (handles drag & drop, optionally click) */
  getDropzoneProps: (options?: DropzonePropsOptions) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onClick?: () => void;
  };
  /** Get props to spread on hidden file input element */
  getInputProps: () => {
    ref: React.RefObject<HTMLInputElement | null>;
    type: 'file';
    style: { display: string };
    multiple: boolean;
    webkitdirectory: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  };

  // Actions
  /** Programmatically trigger file picker */
  open: () => void;
  /** Manually process files (for advanced usage) */
  processFiles: (files: File[]) => Promise<void>;
  /** Reset state and clear all files */
  reset: () => void;

  // Helpers
  /** Get only valid files ready for upload */
  validFiles: ProcessedFile[];
  /** Get raw File objects ready for Ship SDK upload */
  getFilesForUpload: () => File[];
}

/**
 * Headless drop hook for file upload workflows
 *
 * @example
 * ```tsx
 * const drop = useDrop({ ship });
 *
 * return (
 *   <div {...drop.getDropzoneProps()} style={{...}}>
 *     <input {...drop.getInputProps()} />
 *     {drop.isDragging ? "📂 Drop" : "📁 Click"}
 *   </div>
 * );
 * ```
 */
const initialState: DropState = {
  value: 'idle',
  files: [],
  sourceName: '',
  status: null,
  needsBuild: false,
};

export function useDrop(options: DropOptions): DropReturn {
  const {
    ship,
    onValidationError,
    onFilesReady,
    stripPrefix = true,
  } = options;

  // State machine
  const [state, setState] = useState<DropState>(initialState);

  // Refs
  const isProcessingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Computed convenience getters
  const isProcessing = state.value === 'processing';
  const isDragging = state.value === 'dragging';
  const isInteractive = state.value === 'idle' || state.value === 'dragging' || state.value === 'ready';
  const hasError = state.value === 'error';

  // Computed valid files — inline filter since ProcessedFile has wider status type than ValidatableFile
  const validFiles = useMemo(() => state.files.filter(f => f.status === FILE_STATUSES.READY), [state.files]);

  // Get raw File objects for Ship SDK upload
  const getFilesForUpload = useCallback(() => {
    return validFiles.map(f => f.file);
  }, [validFiles]);

  const processFiles = useCallback(async (newFiles: File[]) => {
    // Guard against concurrent calls
    if (isProcessingRef.current) {
      console.warn('File processing already in progress. Ignoring duplicate call.');
      return;
    }

    if (!newFiles || newFiles.length === 0) {
      return;
    }

    // Set ref (synchronous guard) and transition to processing state
    isProcessingRef.current = true;
    setState({
      value: 'processing',
      files: [],
      sourceName: '',
      status: { title: 'Processing...', details: 'Validating and preparing files.' },
      needsBuild: false,
    });

    let detectedSourceName = '';

    /**
     * Transition to error state and notify the consumer.
     *
     * `details` carries the single user-facing message. `errors` is reserved
     * for per-item breakdowns in multi-error cases — leave it out for single
     * errors, otherwise consumers that render both fields show the message
     * twice.
     */
    const setErrorState = (params: {
      title: string;
      details: string;
      errors?: string[];
      files?: ProcessedFile[];
      needsBuild?: boolean;
    }) => {
      const { title, details, errors, files = [], needsBuild = false } = params;
      setState({
        value: 'error',
        files,
        sourceName: detectedSourceName,
        needsBuild,
        status: {
          title,
          details,
          ...(errors?.length && { errors }),
        },
      });
      onValidationError?.({
        error: title,
        details,
        errors: errors ?? [],
        isClientError: true,
      });
    };

    try {
      // Step 1: Detect source name from input
      // Priority: ZIP name > folder name (from webkitRelativePath) > first file name

      if (newFiles.length === 1 && isZipFile(newFiles[0])) {
        // Single ZIP: use ZIP filename without extension
        detectedSourceName = newFiles[0].name.replace(/\.zip$/i, '');
      } else if (newFiles.length > 0) {
        // Check if files have webkitRelativePath (folder drop/selection)
        const firstPath = newFiles[0].webkitRelativePath || '';
        if (firstPath && firstPath.includes('/')) {
          // Folder drop: extract folder name from path
          detectedSourceName = firstPath.split('/')[0];
        } else {
          // Individual file(s): use first file name
          detectedSourceName = newFiles[0].name;
        }
      }

      // Step 2: Extract ZIP only if single file is dropped and it's a ZIP
      // For multiple files, treat ZIPs as regular files (don't extract)
      const allFiles: File[] = [];
      const shouldExtractZip = newFiles.length === 1 && isZipFile(newFiles[0]);

      if (shouldExtractZip) {
        const zipFile = newFiles[0];
        setState(prev => ({
          ...prev,
          status: { title: 'Extracting...', details: `Extracting ${zipFile.name}...` },
        }));
        const { files: extractedFiles, errors } = await extractZipToFiles(zipFile);

        if (errors.length > 0) {
          console.warn('ZIP extraction errors:', errors);
        }

        allFiles.push(...extractedFiles);
      } else {
        // Multiple files or non-ZIP: don't extract anything
        allFiles.push(...newFiles);
      }

      // Step 3: Detect unbuilt project and filter junk files
      const getFilePath = (f: File) => f.webkitRelativePath?.trim() || f.name;

      let filePaths = allFiles.map(getFilePath);
      const needsBuild = filePaths.some(p => hasUnbuiltMarker(p));

      // Strip node_modules files for build uploads (from webkitdirectory folder picker —
      // drag-drop already skips via traverseFileTree)
      if (needsBuild) {
        const filtered = allFiles.filter(f => {
          const segments = getFilePath(f).replace(/\\/g, '/').split('/');
          return !segments.includes('node_modules');
        });
        allFiles.length = 0;
        allFiles.push(...filtered);
        filePaths = allFiles.map(getFilePath);
      }

      // filterJunk: allow unbuilt markers when server will build
      const validPaths = new Set(filterJunk(filePaths, { allowUnbuilt: needsBuild }));
      const cleanFiles = allFiles.filter(f => validPaths.has(getFilePath(f)));

      // Step 4: Convert all Files to ProcessedFiles
      // Empty files are kept — validation will mark them as EXCLUDED with warnings
      setState(prev => ({
        ...prev,
        status: { title: 'Processing...', details: 'Processing files...' },
      }));
      const processedFiles = cleanFiles.map(file => createProcessedFile(file));

      // Step 5: Strip common prefix if requested
      const finalFiles = stripPrefix ? stripCommonPrefix(processedFiles) : processedFiles;

      // Step 6: Validate entry point
      if (finalFiles.length > 0) {
        const hasIndexHtml = needsBuild
          ? finalFiles.some(f => f.path === 'index.html' || f.path.endsWith('/index.html'))
          : finalFiles.some(f => f.path === 'index.html');

        if (!hasIndexHtml) {
          const message = needsBuild
            ? 'No index.html found — every web project needs an index.html entry point'
            : 'No index.html at root — the entry point must be in the top-level directory';

          const filesWithStatus = finalFiles.map(f => ({
            ...f,
            status: FILE_STATUSES.VALIDATION_FAILED,
            statusMessage: message,
          }));

          setErrorState({
            title: 'Validation Failed',
            details: message,
            files: filesWithStatus,
            needsBuild,
          });
          return;
        }
      }

      // Step 7: Build uploads — skip deploy validation (build service produces the actual output)
      if (needsBuild) {
        const filesWithStatus = finalFiles.map(f => ({ ...f, status: FILE_STATUSES.READY }));

        setState({
          value: 'ready',
          files: filesWithStatus,
          sourceName: detectedSourceName,
          needsBuild: true,
          status: { title: 'Ready', details: `${pluralize(filesWithStatus.length, 'file', 'files', true)} ready — project will be built` },
        });
        onFilesReady?.(filesWithStatus);
        return;
      }

      // Step 8: Map ProcessedFile to ValidatableFile format
      // validateFiles expects { name, size }, not { file: File }
      // IMPORTANT: Use f.path (full path) not f.file.name (filename only) to match server validation
      const validatableFiles: ValidatableFile[] = finalFiles.map(f => ({
        name: f.path,  // Use full path to match server-side validation
        size: f.file.size,
      }));

      // Step 9: Validate all files using Ship SDK's platform limits
      const limits = await ship.getLimits();
      const validation = validateFiles(validatableFiles, limits);

      // Map validation results back to ProcessedFile format
      // validation.files has ValidatableFile with status, we need ProcessedFile with updated status
      const filesWithStatus = finalFiles.map((processedFile, idx) => ({
        ...processedFile,
        status: validation.files[idx]?.status || processedFile.status,
        statusMessage: validation.files[idx]?.statusMessage || processedFile.statusMessage
      }));

      // Check canDeploy instead of error (atomic validation)
      if (!validation.canDeploy) {
        setErrorState({
          title: 'Validation Failed',
          details: `${pluralize(validation.errors.length, 'file', 'files', true)} failed validation`,
          errors: validation.errors.map(err => `${err.file}: ${err.message}`),
          files: filesWithStatus,
        });

      } else if (validation.validFiles.length > 0) {
        // Files are ready - show count with excluded files if any
        let details = `${pluralize(validation.validFiles.length, 'file', 'files', true)} ready`;

        // Add warning info if empty files were excluded
        if (validation.warnings.length > 0) {
          details += ` (${pluralize(validation.warnings.length, 'empty file', 'empty files', true)} excluded)`;
        }

        setState({
          value: 'ready',
          files: filesWithStatus,
          sourceName: detectedSourceName,
          needsBuild: false,
          status: {
            title: 'Ready',
            details,
            warnings: validation.warnings.length > 0
              ? validation.warnings.map(w => `${w.file}: ${w.message}`)
              : undefined
          },
        });

        onFilesReady?.(filesWithStatus.filter((f, idx) =>
          validation.files[idx]?.status === FILE_STATUSES.READY
        ));

      } else {
        // No valid files - check if all were excluded (warnings) or failed (errors)
        const hasOnlyWarnings = validation.errors.length === 0 && validation.warnings.length > 0;

        if (hasOnlyWarnings) {
          // All files excluded as warnings (e.g., empty files) - stay in ready state
          setState({
            value: 'ready',
            files: filesWithStatus,
            sourceName: detectedSourceName,
            needsBuild: false,
            status: {
              title: 'All files excluded',
              details: `${pluralize(validation.warnings.length, 'file', 'files', true)} excluded (empty files cannot be deployed)`,
              warnings: validation.warnings.map(w => `${w.file}: ${w.message}`)
            },
          });
          // Note: validFiles.length === 0 will naturally disable deploy button in UI
        } else {
          // No valid files due to errors or processing failures
          setErrorState({
            title: 'No Valid Files',
            details: 'None of the provided files could be processed.',
            files: filesWithStatus,
          });
        }
      }
    } catch (error) {
      // ShipError = validation rejection (e.g. unbuilt project from filterJunk).
      // Other errors = unexpected processing failures.
      const message = error instanceof Error ? error.message : String(error);
      const isValidation = isShipError(error);
      setErrorState({
        title: isValidation ? 'Validation Failed' : 'Processing Failed',
        details: isValidation ? message : `Failed to process files: ${message}`,
      });
    } finally {
      // Always clear processing ref, even on error
      isProcessingRef.current = false;
    }
  }, [ship, onValidationError, onFilesReady, stripPrefix]);

  const reset = useCallback(() => {
    setState(initialState);
    isProcessingRef.current = false;
  }, []);

  // Drag & drop event handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState(prev => {
      // Only allow dragging from idle, ready, or error states
      if (prev.value === 'idle' || prev.value === 'ready' || prev.value === 'error') {
        return { ...prev, value: 'dragging' };
      }
      return prev;
    });
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState(prev => {
      // Only transition out of dragging state
      if (prev.value !== 'dragging') return prev;

      // Determine which state to return to based on file statuses
      if (prev.files.length === 0) {
        return { ...prev, value: 'idle' };
      }

      // Check if any file has an error status
      const errorStatuses: FileStatus[] = [
        FILE_STATUSES.VALIDATION_FAILED,
        FILE_STATUSES.PROCESSING_ERROR,
        FILE_STATUSES.ERROR,
      ];
      const hasErrors = prev.files.some(f => errorStatuses.includes(f.status));
      const nextValue: DropStateValue = hasErrors ? 'error' : 'ready';

      return { ...prev, value: nextValue };
    });
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();

    const items = Array.from(e.dataTransfer.items);
    const files: File[] = [];

    // Use FileSystemEntry API for proper folder traversal
    // CRITICAL: We must access dataTransfer.items SYNCHRONOUSLY.
    // Putting "await" inside a loop over dataTransfer.items causes the items to be 
    // garbage collected/invalidated by the browser before the next iteration.

    const entriesToTraverse: { entry: FileSystemEntry, path: string }[] = [];

    // 1. Synchronous Collection
    for (const item of items) {
      if (item.kind === 'file') {
        try {
          const entry = item.webkitGetAsEntry?.();

          if (entry && entry.isDirectory) {
            // Queue directory for async traversal later
            entriesToTraverse.push({ entry, path: entry.name });
          } else {
            // It's a root file - grab it NOW while item is valid
            const file = item.getAsFile();
            if (file) {
              // Ensure root files have their name as path (consistent with traverseFileTree)
              setRelativePath(file, file.name);
              files.push(file);
            }
          }
        } catch (error) {
          console.warn('Error processing drop item:', error);
          // Try fallback
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }
    }

    // 2. Asynchronous Processing
    // Now that we have captured everything safely, we can await
    if (entriesToTraverse.length > 0) {
      await Promise.all(entriesToTraverse.map(item =>
        traverseFileTree(item.entry, files, item.path)
      ));
    }

    // Fallback for browsers without webkitGetAsEntry support (if no items processed yet)
    if (files.length === 0 && e.dataTransfer.files.length > 0) {
      files.push(...Array.from(e.dataTransfer.files));
    }

    if (files.length > 0) {
      await processFiles(files);
    } else {
      // Return to idle if drop was empty (only if still in dragging state)
      setState(prev => prev.value === 'dragging' ? { ...prev, value: 'idle' } : prev);
    }
  }, [processFiles]);

  // File input handlers
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      processFiles(files);
    }
    // Clear input so selecting the same file again triggers onChange
    e.target.value = '';
  }, [processFiles]);

  const open = useCallback(() => {
    inputRef.current?.click();
  }, []);

  // Prop getters
  const getDropzoneProps = useCallback((options?: DropzonePropsOptions) => {
    const { clickable = true } = options ?? {};
    return {
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      ...(clickable && { onClick: open }),
    };
  }, [handleDragOver, handleDragLeave, handleDrop, open]);

  const getInputProps = useCallback(() => ({
    ref: inputRef,
    type: 'file' as const,
    style: { display: 'none' },
    multiple: true,
    webkitdirectory: '',
    onChange: handleInputChange,
  }), [handleInputChange]);

  return {
    // Convenience getters (computed from state)
    phase: state.value,
    isProcessing,
    isDragging,
    isInteractive,
    hasError,
    files: state.files,
    sourceName: state.sourceName,
    status: state.status,
    needsBuild: state.needsBuild,

    // Primary API: Prop getters
    getDropzoneProps,
    getInputProps,

    // Actions
    open,
    processFiles,
    reset,

    // Helpers
    validFiles,
    getFilesForUpload,
  };
}
