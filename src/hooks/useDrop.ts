/**
 * Headless drop hook - Pure file processor
 * Handles file processing, ZIP extraction, and path normalization
 * Does NOT validate - validation happens in Ship SDK
 * Does NOT upload - consumer handles deployment
 */
import { useState, useCallback, useRef } from 'react';
import type { ProcessedFile, ClientError, FileStatus } from '../types';
import { extractZipToFiles, isZipFile } from '../utils/zipExtractor';
import {
  createProcessedFile,
  getValidFiles,
  stripCommonPrefix,
} from '../utils/fileProcessing';
import type { Ship } from '@shipstatic/ship';
import { validateFiles } from '@shipstatic/ship';

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
  /** All processed files with their status */
  files: ProcessedFile[];
  /** Name of the source (file/folder/ZIP) that was dropped/selected */
  sourceName: string;
  /** Current status text */
  statusText: string;
  /** Whether currently processing files (ZIP extraction, etc.) */
  isProcessing: boolean;
  /** Last validation error if any */
  validationError: ClientError | null;

  /** Process files from drop (resets and replaces existing files) */
  processFiles: (files: File[]) => Promise<void>;
  /** Clear all files and reset state */
  clearAll: () => void;
  /** Get only valid files ready for upload */
  getValidFiles: () => ProcessedFile[];
  /** Update upload state for a specific file (status, progress, message) */
  updateFileStatus: (fileId: string, state: { status: FileStatus; statusMessage?: string; progress?: number }) => void;
}

/**
 * Headless drop hook
 * Handles file processing, ZIP extraction, and validation
 * Does NOT handle uploading - that's the consumer's responsibility
 */
export function useDrop(options: DropOptions): DropReturn {
  const {
    ship,
    onValidationError,
    onFilesReady,
    stripPrefix = true,
  } = options;

  // Simple state - no reducer needed
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [sourceName, setSourceName] = useState('');
  const [statusText, setStatusText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [validationError, setValidationError] = useState<ClientError | null>(null);

  // Concurrency guard to prevent race conditions
  const isProcessingRef = useRef(false);

  const processFiles = useCallback(async (newFiles: File[]) => {
    // Guard against concurrent calls
    if (isProcessingRef.current) {
      console.warn('File processing already in progress. Ignoring duplicate call.');
      return;
    }

    if (!newFiles || newFiles.length === 0) {
      setStatusText('No files selected.');
      return;
    }

    // Set both ref (synchronous guard) and state (UI indicator)
    isProcessingRef.current = true;
    setIsProcessing(true);

    // Reset state
    setFiles([]);
    setValidationError(null);
    setStatusText('Processing files...');

    try {
      // Step 1: Detect source name from input
      // Priority: ZIP name > folder name (from webkitRelativePath) > first file name
      let detectedSourceName = '';

      if (newFiles.length === 1 && isZipFile(newFiles[0])) {
        // Single ZIP: use ZIP filename without extension
        detectedSourceName = newFiles[0].name.replace(/\.zip$/i, '');
      } else if (newFiles.length > 0) {
        // Check if files have webkitRelativePath (folder drop/selection)
        const firstPath = (newFiles[0] as any).webkitRelativePath || '';
        if (firstPath && firstPath.includes('/')) {
          // Folder drop: extract folder name from path
          detectedSourceName = firstPath.split('/')[0];
        } else {
          // Individual file(s): use first file name
          detectedSourceName = newFiles[0].name;
        }
      }

      setSourceName(detectedSourceName);

      // Step 2: Extract ZIP only if single file is dropped and it's a ZIP
      // For multiple files, treat ZIPs as regular files (don't extract)
      const allFiles: File[] = [];
      const shouldExtractZip = newFiles.length === 1 && isZipFile(newFiles[0]);

      if (shouldExtractZip) {
        const zipFile = newFiles[0];
        setStatusText(`Extracting ${zipFile.name}...`);
        const { files: extractedFiles, errors } = await extractZipToFiles(zipFile);

        if (errors.length > 0) {
          console.warn('ZIP extraction errors:', errors);
        }

        allFiles.push(...extractedFiles);
      } else {
        // Multiple files or non-ZIP: don't extract anything
        allFiles.push(...newFiles);
      }

      // Step 3: Convert all Files to ProcessedFiles
      setStatusText('Processing files...');
      const processedFiles = await Promise.all(
        allFiles.map(file => createProcessedFile(file))
      );

      // Step 4: Strip common prefix if requested
      const finalFiles = stripPrefix ? stripCommonPrefix(processedFiles) : processedFiles;

      // Step 5: Validate all files using Ship SDK's config
      const config = await ship.getConfig();
      const validation = validateFiles(finalFiles, config);

      setFiles(validation.files);
      setValidationError(validation.error as ClientError | null);

      if (validation.error) {
        setStatusText(validation.error.details);
        onValidationError?.(validation.error as ClientError);
      } else if (validation.validFiles.length > 0) {
        setStatusText(`${validation.validFiles.length} file(s) ready.`);
        onFilesReady?.(validation.validFiles);
      } else {
        const noValidError: ClientError = {
          error: 'No Valid Files',
          details: 'No files are valid for upload after processing.',
          isClientError: true,
        };
        setStatusText(noValidError.details);
        setValidationError(noValidError);
        onValidationError?.(noValidError);
      }
    } catch (error) {
      const processingError: ClientError = {
        error: 'Processing Failed',
        details: `Failed to process files: ${error instanceof Error ? error.message : String(error)}`,
        isClientError: true,
      };
      setStatusText(processingError.details);
      setValidationError(processingError);
      onValidationError?.(processingError);
    } finally {
      // Always clear both ref and state, even on error
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [ship, onValidationError, onFilesReady, stripPrefix]);

  const clearAll = useCallback(() => {
    setFiles([]);
    setSourceName('');
    setStatusText('');
    setValidationError(null);
    isProcessingRef.current = false;
    setIsProcessing(false);
  }, []);

  const getValidFilesCallback = useCallback(() => {
    return getValidFiles(files);
  }, [files]);

  const updateFileStatus = useCallback((
    fileId: string,
    state: { status: FileStatus; statusMessage?: string; progress?: number }
  ) => {
    setFiles(prev => prev.map(file =>
      file.id === fileId
        ? { ...file, ...state }
        : file
    ));
  }, []);

  return {
    files,
    sourceName,
    statusText,
    isProcessing,
    validationError,
    processFiles,
    clearAll,
    getValidFiles: getValidFilesCallback,
    updateFileStatus,
  };
}
