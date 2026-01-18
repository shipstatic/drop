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
import type { ProcessedFile, ClientError, FileStatus, DropState, DropStateValue, FileWithPath } from '../types';
import { FILE_STATUSES } from '../types';
import { extractZipToFiles, isZipFile } from '../utils/zipExtractor';
import {
  createProcessedFile,
  stripCommonPrefix,
  traverseFileTree,
} from '../utils/fileProcessing';
import type { Ship } from '@shipstatic/ship';
import { validateFiles, filterJunk, getValidFiles } from '@shipstatic/ship';

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

export interface DropReturn {
  // State machine -- Internal only now

  // Convenience getters (computed from state)
  /** Current phase of the state machine */
  phase: DropStateValue;
  /** Whether currently processing files (ZIP extraction, etc.) */
  isProcessing: boolean;
  /** Whether user is currently dragging over the dropzone */
  isDragging: boolean;
  /** Flattened access to files */
  files: ProcessedFile[];
  /** Flattened access to source name */
  sourceName: string;
  /** Flattened access to status */
  status: { title: string; details: string; errors?: string[] } | null;

  // Primary API: Prop getters for easy integration
  /** Get props to spread on dropzone element (handles drag & drop) */
  getDropzoneProps: () => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onClick: () => void;
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
  /** Clear all files and reset state */
  clearAll: () => void;

  // Helpers
  /** Get only valid files ready for upload */
  validFiles: ProcessedFile[];
  /** Update upload state for a specific file (status, progress, message) */
  updateFileStatus: (fileId: string, state: { status: FileStatus; statusMessage?: string; progress?: number }) => void;
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
export function useDrop(options: DropOptions): DropReturn {
  const {
    ship,
    onValidationError,
    onFilesReady,
    stripPrefix = true,
  } = options;

  // Initial state
  const initialState: DropState = {
    value: 'idle',
    files: [],
    sourceName: '',
    status: null,
  };

  // State machine
  const [state, setState] = useState<DropState>(initialState);

  // Refs
  const isProcessingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Computed convenience getters
  const isProcessing = useMemo(() => state.value === 'processing', [state.value]);
  const isDragging = useMemo(() => state.value === 'dragging', [state.value]);

  // Computed valid files
  const validFiles = useMemo(() => getValidFiles<ProcessedFile>(state.files), [state.files]);

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
    });

    try {
      // Step 1: Detect source name from input
      // Priority: ZIP name > folder name (from webkitRelativePath) > first file name
      let detectedSourceName = '';

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

      // Step 3: Filter junk files (single point for both ZIP and direct drops)
      // Extract paths: for ZIP files, name contains the full path; for direct drops, use webkitRelativePath or name
      const getFilePath = (f: File) => {
        const webkitPath = (f as FileWithPath).webkitRelativePath;
        // Handle both undefined and empty string as falsy
        return (webkitPath && webkitPath.trim()) ? webkitPath : f.name;
      };

      const filePaths = allFiles.map(getFilePath);
      const validPaths = new Set(filterJunk(filePaths));
      const cleanFiles = allFiles.filter(f => validPaths.has(getFilePath(f)));

      // Step 4: Convert all Files to ProcessedFiles
      setState(prev => ({
        ...prev,
        status: { title: 'Processing...', details: 'Processing files...' },
      }));
      const processedFiles = cleanFiles.map(file => createProcessedFile(file));

      // Step 5: Strip common prefix if requested
      const finalFiles = stripPrefix ? stripCommonPrefix(processedFiles) : processedFiles;

      // Step 6: Validate all files using Ship SDK's config
      const config = await ship.getConfig();
      const validation = validateFiles(finalFiles, config);

      if (validation.error) {
        // Transition to error state
        setState({
          value: 'error',
          files: validation.files,
          sourceName: detectedSourceName,
          status: {
            title: validation.error.error,
            details: validation.error.details,
            errors: validation.error.errors
          },
        });
        onValidationError?.(validation.error as ClientError);
      } else if (validation.validFiles.length > 0) {
        // Transition to ready state
        setState({
          value: 'ready',
          files: validation.files,
          sourceName: detectedSourceName,
          status: { title: 'Ready', details: `${validation.validFiles.length} file(s) are ready.` },
        });
        onFilesReady?.(validation.validFiles);
      } else {
        // Handle case where no valid files were found
        const noValidError: ClientError = {
          error: 'No Valid Files',
          details: 'None of the provided files could be processed.',
          errors: [],
          isClientError: true,
        };
        setState({
          value: 'error',
          files: validation.files,
          sourceName: detectedSourceName,
          status: { title: noValidError.error, details: noValidError.details },
        });
        onValidationError?.(noValidError);
      }
    } catch (error) {
      // Transition to error state on exception
      const processingError: ClientError = {
        error: 'Processing Failed',
        details: `Failed to process files: ${error instanceof Error ? error.message : String(error)}`,
        errors: [],
        isClientError: true,
      };
      setState(prev => ({
        ...prev,
        value: 'error',
        status: { title: processingError.error, details: processingError.details },
      }));
      onValidationError?.(processingError);
    } finally {
      // Always clear processing ref, even on error
      isProcessingRef.current = false;
    }
  }, [ship, onValidationError, onFilesReady, stripPrefix]);

  const clearAll = useCallback(() => {
    setState(initialState);
    isProcessingRef.current = false;
  }, []);

  const updateFileStatus = useCallback((
    fileId: string,
    fileState: { status: FileStatus; statusMessage?: string; progress?: number }
  ) => {
    setState(prev => ({
      ...prev,
      files: prev.files.map(file =>
        file.id === fileId
          ? { ...file, ...fileState }
          : file
      ),
    }));
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
        FILE_STATUSES.EMPTY_FILE,
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
  const getDropzoneProps = useCallback(() => ({
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    onClick: open,
  }), [handleDragOver, handleDragLeave, handleDrop, open]);

  const getInputProps = useCallback(() => ({
    ref: inputRef,
    type: 'file' as const,
    style: { display: 'none' },
    multiple: true,
    webkitdirectory: '',
    onChange: handleInputChange,
  }), [handleInputChange]);

  return {
    // State machine

    // Convenience getters (computed from state)
    phase: state.value,
    isProcessing,
    isDragging,
    files: state.files,
    sourceName: state.sourceName,
    status: state.status,

    // Primary API: Prop getters
    getDropzoneProps,
    getInputProps,

    // Actions
    open,
    processFiles,
    clearAll,

    // Helpers
    validFiles,
    updateFileStatus,
  };
}
