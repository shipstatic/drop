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
import type { ProcessedFile, ClientError, DropState, DropStatus, DropStateValue, FileWithPath, FileStatus } from '../types';
import { FILE_STATUSES } from '../types';
import { extractZipToFiles, isZipFile } from '../utils/zipExtractor';
import {
  createProcessedFile,
  stripCommonPrefix,
  traverseFileTree,
} from '../utils/fileProcessing';
import type { Ship } from '@shipstatic/ship';
import type { ValidatableFile } from '@shipstatic/types';
import { isShipError, hasUnbuiltMarker } from '@shipstatic/types';
import { validateFiles, filterJunk } from '@shipstatic/ship';

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
  const validFiles = useMemo(() => state.files.filter(f => f.status === 'ready'), [state.files]);

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

    try {
      // Step 1: Detect source name from input
      // Priority: ZIP name > folder name (from webkitRelativePath) > first file name

      if (newFiles.length === 1 && isZipFile(newFiles[0])) {
        // Single ZIP: use ZIP filename without extension
        detectedSourceName = newFiles[0].name.replace(/\.zip$/i, '');
      } else if (newFiles.length > 0) {
        // Check if files have webkitRelativePath (folder drop/selection)
        const firstPath = (newFiles[0] as FileWithPath).webkitRelativePath || '';
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
      const getFilePath = (f: File) => {
        const webkitPath = (f as FileWithPath).webkitRelativePath;
        return (webkitPath && webkitPath.trim()) ? webkitPath : f.name;
      };

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
      // NOTE: We no longer filter empty files here - validation will handle them
      // Empty files will be marked as EXCLUDED with warnings (not errors)
      setState(prev => ({
        ...prev,
        status: { title: 'Processing...', details: 'Processing files...' },
      }));
      const processedFiles = cleanFiles.map(file => createProcessedFile(file));

      // Step 5: Strip common prefix if requested
      const finalFiles = stripPrefix ? stripCommonPrefix(processedFiles) : processedFiles;

      // Step 5.5: Build uploads — skip deploy validation (build service produces the actual output)
      if (needsBuild) {
        const filesWithStatus = finalFiles.map(f => ({ ...f, status: 'ready' as FileStatus }));

        setState({
          value: 'ready',
          files: filesWithStatus,
          sourceName: detectedSourceName,
          needsBuild: true,
          status: { title: 'Ready', details: `${filesWithStatus.length} file(s) ready — project will be built` },
        });
        onFilesReady?.(filesWithStatus);
        return;
      }

      // Step 6: Map ProcessedFile to ValidatableFile format
      // validateFiles expects { name, size }, not { file: File }
      // IMPORTANT: Use f.path (full path) not f.file.name (filename only) to match server validation
      const validatableFiles: ValidatableFile[] = finalFiles.map(f => ({
        name: f.path,  // Use full path to match server-side validation
        size: f.file.size,
      }));

      // Step 7: Validate all files using Ship SDK's config
      const config = await ship.getConfig();
      const validation = validateFiles(validatableFiles, config);

      // Map validation results back to ProcessedFile format
      // validation.files has ValidatableFile with status, we need ProcessedFile with updated status
      const filesWithStatus = finalFiles.map((processedFile, idx) => ({
        ...processedFile,
        status: validation.files[idx]?.status || processedFile.status,
        statusMessage: validation.files[idx]?.statusMessage || processedFile.statusMessage
      }));

      // Check canDeploy instead of error (atomic validation)
      if (!validation.canDeploy) {
        // Format error messages from structured errors
        const errorMessages = validation.errors.map(err =>
          `${err.file}: ${err.message}`
        );

        setState({
          value: 'error',
          files: filesWithStatus,
          sourceName: detectedSourceName,
          needsBuild: false,
          status: {
            title: 'Validation Failed',
            details: `${validation.errors.length} file(s) failed validation`,
            errors: errorMessages
          },
        });

        // Call error callback with structured errors (backward compatible format)
        onValidationError?.({
          error: 'Validation Failed',
          details: `${validation.errors.length} error(s)`,
          errors: errorMessages,
          isClientError: true
        });

      } else if (validation.validFiles.length > 0) {
        // Files are ready - show count with excluded files if any
        let details = `${validation.validFiles.length} file(s) ready`;

        // Add warning info if empty files were excluded
        if (validation.warnings.length > 0) {
          details += ` (${validation.warnings.length} empty file(s) excluded)`;
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
          validation.files[idx]?.status === 'ready'
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
              details: `${validation.warnings.length} file(s) excluded (empty files cannot be deployed)`,
              warnings: validation.warnings.map(w => `${w.file}: ${w.message}`)
            },
          });
          // Note: validFiles.length === 0 will naturally disable deploy button in UI
        } else {
          // No valid files due to errors or processing failures
          const noValidError: ClientError = {
            error: 'No Valid Files',
            details: 'None of the provided files could be processed.',
            errors: [],
            isClientError: true,
          };
          setState({
            value: 'error',
            files: filesWithStatus,
            sourceName: detectedSourceName,
            needsBuild: false,
            status: { title: noValidError.error, details: noValidError.details },
          });
          onValidationError?.(noValidError);
        }
      }
    } catch (error) {
      // ShipError = validation rejection (e.g. unbuilt project from filterJunk)
      // Other errors = unexpected processing failures
      const message = error instanceof Error ? error.message : String(error);
      const isValidation = isShipError(error);
      const clientError: ClientError = {
        error: isValidation ? 'Validation Failed' : 'Processing Failed',
        details: isValidation ? message : `Failed to process files: ${message}`,
        errors: isValidation ? [message] : [],
        isClientError: true,
      };
      setState({
        value: 'error',
        files: [],
        sourceName: detectedSourceName,
        needsBuild: false,
        status: {
          title: clientError.error,
          details: clientError.details,
          ...(clientError.errors.length > 0 && { errors: clientError.errors }),
        },
      });
      onValidationError?.(clientError);
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
              Object.defineProperty(file, 'webkitRelativePath', {
                value: file.name,
                writable: false,
                configurable: true,
              });
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
