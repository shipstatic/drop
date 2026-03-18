/**
 * Test utilities for @shipstatic/drop
 *
 * Import from '@shipstatic/drop/testing' in your test files:
 *
 * ```typescript
 * import { createMockDrop, createMockFile } from '@shipstatic/drop/testing';
 * ```
 */

import type { ProcessedFile, DropStatus, DropStateValue } from './types';
import type { DropReturn, DropzonePropsOptions } from './hooks/useDrop';

// ============================================================================
// Mock Drop Hook Return
// ============================================================================

/**
 * Options for creating a mock drop return value
 */
export interface MockDropOptions {
  phase?: DropStateValue;
  files?: ProcessedFile[];
  sourceName?: string;
  status?: DropStatus | null;
  needsBuild?: boolean;
}

/**
 * Creates a mock DropReturn for testing components that receive drop as a prop
 *
 * @example
 * ```tsx
 * import { createMockDrop, createMockProcessedFile } from '@shipstatic/drop/testing';
 *
 * it('renders file count when files are ready', () => {
 *   const drop = createMockDrop({
 *     phase: 'ready',
 *     files: [createMockProcessedFile('index.html')],
 *   });
 *
 *   render(<DeployDropArea drop={drop} />);
 *   expect(screen.getByText('1 files ready')).toBeInTheDocument();
 * });
 * ```
 */
export function createMockDrop(options: MockDropOptions = {}): DropReturn {
  const {
    phase = 'idle',
    files = [],
    sourceName = '',
    status = null,
    needsBuild = false,
  } = options;

  const validFiles = files.filter(f => f.status === 'ready');

  return {
    // State
    phase,
    isProcessing: phase === 'processing',
    isDragging: phase === 'dragging',
    isInteractive: phase === 'idle' || phase === 'dragging' || phase === 'ready',
    hasError: phase === 'error',
    files,
    validFiles,
    sourceName,
    status,
    needsBuild,

    // Prop getters - return minimal objects for spreading
    getDropzoneProps: (opts?: DropzonePropsOptions) => ({
      onDragOver: () => {},
      onDragLeave: () => {},
      onDrop: () => {},
      ...(opts?.clickable !== false && { onClick: () => {} }),
    }),
    getInputProps: () => ({
      ref: { current: null },
      type: 'file' as const,
      style: { display: 'none' },
      multiple: true,
      webkitdirectory: '',
      onChange: () => {},
    }),

    // Actions - no-op by default, can be spied on
    open: () => {},
    processFiles: async () => {},
    reset: () => {},

    // Helpers
    getFilesForUpload: () => validFiles.map(f => f.file),
  };
}

/**
 * Creates a mock drop with spy functions for testing interactions
 *
 * @example
 * ```tsx
 * import { createMockDropWithSpies } from '@shipstatic/drop/testing';
 *
 * it('calls reset when Clear button is clicked', async () => {
 *   const { drop, spies } = createMockDropWithSpies({ phase: 'ready', files: [...] });
 *
 *   render(<DeployDropArea drop={drop} />);
 *   await userEvent.click(screen.getByText('Clear'));
 *
 *   expect(spies.reset).toHaveBeenCalled();
 * });
 * ```
 */
export function createMockDropWithSpies(options: MockDropOptions = {}): {
  drop: DropReturn;
  spies: {
    open: () => void;
    processFiles: (files: File[]) => Promise<void>;
    reset: () => void;
    getFilesForUpload: () => File[];
  };
} {
  const baseDrop = createMockDrop(options);

  const spies = {
    open: createNoopSpy(),
    processFiles: createAsyncNoopSpy(),
    reset: createNoopSpy(),
    getFilesForUpload: (() => baseDrop.getFilesForUpload()) as () => File[],
  };

  // Track calls manually (works without vitest in runtime)
  let openCalls = 0;
  let processFilesCalls: File[][] = [];
  let resetCalls = 0;

  const trackedSpies = {
    open: Object.assign(() => { openCalls++; }, {
      calls: () => openCalls,
      toHaveBeenCalled: () => openCalls > 0,
    }),
    processFiles: Object.assign(async (files: File[]) => { processFilesCalls.push(files); }, {
      calls: () => processFilesCalls,
      toHaveBeenCalled: () => processFilesCalls.length > 0,
      toHaveBeenCalledWith: (files: File[]) => processFilesCalls.some(c => c === files),
    }),
    reset: Object.assign(() => { resetCalls++; }, {
      calls: () => resetCalls,
      toHaveBeenCalled: () => resetCalls > 0,
    }),
    getFilesForUpload: baseDrop.getFilesForUpload,
  };

  return {
    drop: {
      ...baseDrop,
      open: trackedSpies.open,
      processFiles: trackedSpies.processFiles,
      reset: trackedSpies.reset,
      getFilesForUpload: trackedSpies.getFilesForUpload,
    },
    spies: trackedSpies,
  };
}

// ============================================================================
// Mock File Utilities
// ============================================================================

let mockFileIdCounter = 0;

/**
 * Creates a mock ProcessedFile for testing
 */
export function createMockProcessedFile(
  name: string,
  options: {
    path?: string;
    content?: string;
    type?: string;
    status?: 'ready' | 'validation_failed' | 'processing_error' | 'excluded';
    statusMessage?: string;
  } = {}
): ProcessedFile {
  const {
    path = name,
    content = 'test content',
    type = 'text/plain',
    status = 'ready',
    statusMessage,
  } = options;

  const file = new File([content], name, { type });

  return {
    id: `mock-file-${++mockFileIdCounter}`,
    file,
    path,
    name,
    size: file.size,
    type,
    lastModified: Date.now(),
    status,
    statusMessage,
  };
}

/**
 * Creates a mock File object
 */
export function createMockFile(
  name: string,
  content: string = 'test content',
  type: string = 'text/plain'
): File {
  return new File([content], name, { type, lastModified: Date.now() });
}

/**
 * Creates a mock File object with webkitRelativePath set
 */
export function createMockFileWithPath(
  name: string,
  webkitRelativePath: string,
  content: string = 'test content',
  type: string = 'text/plain'
): File {
  const file = createMockFile(name, content, type);
  Object.defineProperty(file, 'webkitRelativePath', {
    value: webkitRelativePath,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  return file;
}

// ============================================================================
// Mock Status Utilities
// ============================================================================

/**
 * Creates a mock error status
 */
export function createMockErrorStatus(
  title: string = 'Validation Failed',
  details: string = 'One or more files failed validation',
  errors: string[] = []
): DropStatus {
  return { title, details, errors };
}

/**
 * Creates a mock processing status
 */
export function createMockProcessingStatus(
  title: string = 'Processing...',
  details: string = 'Validating and preparing files.'
): DropStatus {
  return { title, details };
}

/**
 * Creates a mock ready status
 */
export function createMockReadyStatus(fileCount: number): DropStatus {
  return {
    title: 'Ready',
    details: `${fileCount} file(s) are ready.`,
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

function createNoopSpy(): () => void {
  return () => {};
}

function createAsyncNoopSpy(): () => Promise<void> {
  return async () => {};
}
