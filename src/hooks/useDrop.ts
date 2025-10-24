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
import { useState, useCallback, useRef } from 'react';
import type { ProcessedFile, ClientError, FileStatus } from '../types';
import { extractZipToFiles, isZipFile } from '../utils/zipExtractor';
import {
  createProcessedFile,
  getValidFiles,
  stripCommonPrefix,
} from '../utils/fileProcessing';
import type { Ship } from '@shipstatic/ship';
import { validateFiles, filterJunk } from '@shipstatic/ship';

/**
 * Recursively traverse FileSystemEntry from drag & drop to collect all files
 * Properly sets webkitRelativePath to preserve folder structure
 */
async function traverseFileTree(
  entry: FileSystemEntry,
  files: File[],
  currentPath = ''
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    const relativePath = currentPath
      ? `${currentPath}/${file.name}`
      : file.name;
    Object.defineProperty(file, 'webkitRelativePath', {
      value: relativePath,
      writable: false,
    });
    files.push(file);
  } else if (entry.isDirectory) {
    const dirReader = (entry as FileSystemDirectoryEntry).createReader();
    let allEntries: FileSystemEntry[] = [];

    // Read all entries (may require multiple calls due to browser limits)
    const readEntriesBatch = async (): Promise<void> => {
      const batch = await new Promise<FileSystemEntry[]>(
        (resolve, reject) => {
          dirReader.readEntries(resolve, reject);
        }
      );
      if (batch.length > 0) {
        allEntries = allEntries.concat(batch);
        await readEntriesBatch();
      }
    };
    await readEntriesBatch();

    for (const childEntry of allEntries) {
      // For directories: include directory name in path (we're entering it)
      // For files: don't include filename (it will be appended when processing the file)
      const entryPath = childEntry.isDirectory
        ? (currentPath ? `${currentPath}/${childEntry.name}` : childEntry.name)
        : currentPath;
      await traverseFileTree(childEntry, files, entryPath);
    }
  }
}

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
  // State
  /** All processed files with their status */
  files: ProcessedFile[];
  /** Name of the source (file/folder/ZIP) that was dropped/selected */
  sourceName: string;
  /** Current status text */
  statusText: string;
  /** Whether currently processing files (ZIP extraction, etc.) */
  isProcessing: boolean;
  /** Whether user is currently dragging over the dropzone */
  isDragging: boolean;
  /** Last validation error if any */
  validationError: ClientError | null;

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
  getValidFiles: () => ProcessedFile[];
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

  // State
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [sourceName, setSourceName] = useState('');
  const [statusText, setStatusText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<ClientError | null>(null);

  // Refs
  const isProcessingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

      // Step 3: Filter junk files (single point for both ZIP and direct drops)
      // Extract paths: for ZIP files, name contains the full path; for direct drops, use webkitRelativePath or name
      const getFilePath = (f: File) => {
        const webkitPath = (f as any).webkitRelativePath;
        // Handle both undefined and empty string as falsy
        return (webkitPath && webkitPath.trim()) ? webkitPath : f.name;
      };

      const filePaths = allFiles.map(getFilePath);
      const validPaths = new Set(filterJunk(filePaths));
      const cleanFiles = allFiles.filter(f => validPaths.has(getFilePath(f)));

      // Step 4: Convert all Files to ProcessedFiles
      setStatusText('Processing files...');
      const processedFiles = await Promise.all(
        cleanFiles.map(file => createProcessedFile(file))
      );

      // Step 5: Strip common prefix if requested
      const finalFiles = stripPrefix ? stripCommonPrefix(processedFiles) : processedFiles;

      // Step 6: Validate all files using Ship SDK's config
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
    setIsDragging(false);
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

  // Drag & drop event handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = Array.from(e.dataTransfer.items);
    const files: File[] = [];

    // Use FileSystemEntry API for proper folder traversal
    let hasEntries = false;
    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          hasEntries = true;
          await traverseFileTree(
            entry,
            files,
            entry.isDirectory ? entry.name : ''
          );
        }
      }
    }

    // Fallback for browsers without webkitGetAsEntry support
    if (!hasEntries && e.dataTransfer.files.length > 0) {
      files.push(...Array.from(e.dataTransfer.files));
    }

    if (files.length > 0) {
      await processFiles(files);
    }
  }, [processFiles]);

  // File input handlers
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      processFiles(files);
    }
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
    // State
    files,
    sourceName,
    statusText,
    isProcessing,
    isDragging,
    validationError,

    // Primary API: Prop getters
    getDropzoneProps,
    getInputProps,

    // Actions
    open,
    processFiles,
    clearAll,

    // Helpers
    getValidFiles: getValidFilesCallback,
    updateFileStatus,
  };
}
