/**
 * Simplified headless dropzone manager hook
 * Handles file processing, ZIP extraction, and validation
 * Upload logic is the responsibility of the consumer
 */
import { useState, useCallback, useRef } from 'react';
import type { ProcessedFile, ClientError, ValidationConfig, FileStatus } from '../types';
import { DEFAULT_VALIDATION } from '../types';
import { extractZipToFiles, isZipFile } from '../utils/zipExtractor';
import {
  createProcessedFile,
  validateFiles,
  getValidFiles,
  allValidFilesHaveChecksums,
  stripCommonPrefix,
} from '../utils/fileProcessing';

export interface DropzoneManagerOptions {
  /** Validation configuration (from ship.getConfig()) */
  config?: Partial<ValidationConfig>;
  /** Callback when validation fails */
  onValidationError?: (error: ClientError) => void;
  /** Callback when files are ready for upload */
  onFilesReady?: (files: ProcessedFile[]) => void;
  /** Whether to strip common directory prefix from paths (default: true) */
  stripPrefix?: boolean;
}

export interface DropzoneManagerReturn {
  /** All processed files with their status */
  files: ProcessedFile[];
  /** Current status text */
  statusText: string;
  /** Whether currently processing files (ZIP extraction, etc.) */
  isProcessing: boolean;
  /** Last validation error if any */
  validationError: ClientError | null;
  /** Whether all valid files have MD5 checksums calculated */
  hasChecksums: boolean;

  /** Process files from dropzone (resets and replaces existing files) */
  processFiles: (files: File[]) => Promise<void>;
  /** Remove a specific file */
  removeFile: (fileId: string) => void;
  /** Clear all files and reset state */
  clearAll: () => void;
  /** Get only valid files ready for upload */
  getValidFiles: () => ProcessedFile[];
  /** Update upload state for a specific file (status, progress, message) */
  updateFileStatus: (fileId: string, state: { status: FileStatus; statusMessage?: string; progress?: number }) => void;
}

/**
 * Headless dropzone manager hook
 * Handles file processing, ZIP extraction, and validation
 * Does NOT handle uploading - that's the consumer's responsibility
 */
export function useDropzoneManager(options: DropzoneManagerOptions = {}): DropzoneManagerReturn {
  const {
    config: customConfig,
    onValidationError,
    onFilesReady,
    stripPrefix = true,
  } = options;

  const validationConfig = { ...DEFAULT_VALIDATION, ...customConfig };

  // Simple state - no reducer needed
  const [files, setFiles] = useState<ProcessedFile[]>([]);
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
      // Step 1: Extract any ZIP files
      const allFiles: File[] = [];
      for (const file of newFiles) {
        if (isZipFile(file)) {
          setStatusText(`Extracting ${file.name}...`);
          const { files: extractedFiles, errors } = await extractZipToFiles(file);

          if (errors.length > 0) {
            console.warn('ZIP extraction errors:', errors);
          }

          allFiles.push(...extractedFiles);
        } else {
          allFiles.push(file);
        }
      }

      // Step 2: Convert all Files to ProcessedFiles with MD5
      setStatusText('Calculating checksums...');
      const processedFiles = await Promise.all(
        allFiles.map(file => createProcessedFile(file))
      );

      // Step 3: Strip common prefix if requested
      const finalFiles = stripPrefix ? stripCommonPrefix(processedFiles) : processedFiles;

      // Step 4: Validate all files
      const validation = validateFiles(finalFiles, validationConfig);

      setFiles(validation.files);
      setValidationError(validation.error);

      if (validation.error) {
        setStatusText(validation.error.details);
        onValidationError?.(validation.error);
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
  }, [validationConfig, onValidationError, onFilesReady, stripPrefix]);

  const removeFile = useCallback((fileId: string) => {
    setFiles(prev => prev.filter(file => file.id !== fileId));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
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

  // Calculate hasChecksums
  const hasChecksums = allValidFilesHaveChecksums(files);

  return {
    files,
    statusText,
    isProcessing,
    validationError,
    hasChecksums,
    processFiles,
    removeFile,
    clearAll,
    getValidFiles: getValidFilesCallback,
    updateFileStatus,
  };
}
