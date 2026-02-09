/**
 * Shared test utilities for creating mock data across all test files
 *
 * These factories provide consistent, well-typed mock objects for testing.
 * Use these instead of creating ad-hoc mocks in individual tests.
 */

import { vi } from 'vitest';
import type { Ship } from '@shipstatic/ship';
import { FILE_STATUSES } from '../src/types';

// ============================================================================
// File Mocks
// ============================================================================

/**
 * Creates a mock File object with arrayBuffer support for testing
 * Used for testing file processing logic
 *
 * Relies on the global File.prototype.arrayBuffer mock in tests/setup.ts
 * which reads from the _testContent property
 *
 * @param name - File name
 * @param content - File content (use null to simulate read error)
 * @param type - MIME type
 */
export const createMockFile = (
  name: string,
  content: string | null = 'test content',
  type: string = 'text/plain'
): File => {
  const file = new File([content || ''], name, { type, lastModified: Date.now() });
  // Signal to global mock: null content means throw error
  (file as any)._testContent = content;
  return file;
};

/**
 * Creates a mock File object with webkitRelativePath set
 * Used for testing folder structure preservation
 */
export const createMockFileWithPath = (
  name: string,
  webkitRelativePath: string,
  content: string = 'test content',
  type: string = 'text/plain'
): File => {
  const file = createMockFile(name, content, type);
  // Set webkitRelativePath (read-only property)
  Object.defineProperty(file, 'webkitRelativePath', {
    value: webkitRelativePath,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  return file;
};

// ============================================================================
// Ship SDK Mocks
// ============================================================================

/**
 * Ship SDK Mock Pattern
 *
 * Due to vitest's mock hoisting, each test file needs its own vi.mock() call.
 * Use this standard pattern for consistency:
 *
 * ```typescript
 * import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
 * import { createMockShip, createPassingValidation, DEFAULT_TEST_CONFIG } from '../test-utils';
 *
 * // Module-scoped mock functions (referenced by vi.mock)
 * const mockGetConfig = vi.fn();
 * const mockValidateFiles = vi.fn();
 *
 * // Mock the Ship SDK module
 * vi.mock('@shipstatic/ship', async (importOriginal) => {
 *   const actual = await importOriginal<typeof import('@shipstatic/ship')>();
 *   return {
 *     ...actual,
 *     validateFiles: (...args: any[]) => mockValidateFiles(...args),
 *   };
 * });
 *
 * // Create Ship instance
 * const createTestShip = () => ({ getConfig: mockGetConfig } as any);
 *
 * beforeEach(() => {
 *   mockGetConfig.mockResolvedValue(DEFAULT_TEST_CONFIG);
 *   mockValidateFiles.mockImplementation(createPassingValidation());
 * });
 *
 * afterEach(() => {
 *   vi.clearAllMocks();
 * });
 * ```
 *
 * Use createPassingValidation() and createFailingValidation() for mock implementations.
 */

/**
 * Default relaxed config for unit tests
 * Uses high limits to avoid accidental validation failures in unrelated tests
 */
export const DEFAULT_TEST_CONFIG = {
  maxFileSize: 100 * 1024 * 1024,     // 100MB
  maxFilesCount: 10000,
  maxTotalSize: 500 * 1024 * 1024,    // 500MB
  allowedMimeTypes: ['text/', 'image/', 'audio/', 'video/', 'font/', 'model/', 'application/'],
};

/**
 * Creates a mock Ship SDK instance
 * @param configOverrides - Override default config values
 */
export const createMockShip = (
  configOverrides: Partial<typeof DEFAULT_TEST_CONFIG> = {}
): { ship: Ship; mockGetConfig: ReturnType<typeof vi.fn> } => {
  const mockGetConfig = vi.fn().mockResolvedValue({
    ...DEFAULT_TEST_CONFIG,
    ...configOverrides,
  });

  return {
    ship: { getConfig: mockGetConfig } as unknown as Ship,
    mockGetConfig,
  };
};

/**
 * Creates a mock validateFiles implementation that marks all files as valid
 */
export const createPassingValidation = () => {
  return vi.fn((files: any[]) => ({
    files: files.map((f: any) => ({
      ...f,
      status: FILE_STATUSES.READY,
      statusMessage: 'Ready for upload',
    })),
    validFiles: files.map((f: any) => ({
      ...f,
      status: FILE_STATUSES.READY,
      statusMessage: 'Ready for upload',
    })),
    errors: [],
    warnings: [],
    canDeploy: true,
  }));
};

/**
 * Creates a mock validateFiles implementation that fails all files
 */
export const createFailingValidation = (
  error: { error: string; details: string } = { error: 'Validation Failed', details: 'Test failure' }
) => {
  return vi.fn((files: any[]) => ({
    files: files.map((f: any) => ({
      ...f,
      status: FILE_STATUSES.VALIDATION_FAILED,
      statusMessage: error.details,
    })),
    validFiles: [],
    errors: files.map((f: any) => ({
      file: f.name || f.path || 'unknown',
      severity: 'error' as const,
      type: 'validation_failed' as const,
      message: error.details,
    })),
    warnings: [],
    canDeploy: false,
  }));
};

// ============================================================================
// Event Mocks
// ============================================================================

/**
 * Creates a mock DragEvent for testing drag handlers
 */
export const createMockDragEvent = (
  overrides: Partial<{
    items: DataTransferItem[];
    files: File[];
  }> = {}
): React.DragEvent => ({
  preventDefault: vi.fn(),
  dataTransfer: {
    items: overrides.items || [],
    files: overrides.files || [],
  },
} as unknown as React.DragEvent);

/**
 * Creates a mock ChangeEvent for testing file input handlers
 */
export const createMockInputChangeEvent = (
  files: File[]
): React.ChangeEvent<HTMLInputElement> => {
  let inputValue = files.length > 0 ? 'C:\\fakepath\\' + files[0].name : '';

  return {
    target: {
      files,
      get value() { return inputValue; },
      set value(v: string) { inputValue = v; },
    },
  } as unknown as React.ChangeEvent<HTMLInputElement>;
};

// ============================================================================
// FileSystemEntry Mocks (for drag-and-drop testing)
// ============================================================================

/**
 * Mock interface matching FileSystemEntry behavior
 */
export interface MockFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (f: File) => void, error?: (e: Error) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: MockFileSystemEntry[]) => void,
      error?: (e: Error) => void
    ) => void;
  };
}

/**
 * Creates a mock FileSystemFileEntry
 */
export const createMockFileEntry = (
  name: string,
  content: string = 'test content',
  type: string = 'text/plain'
): MockFileSystemEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (success) => success(new File([content], name, { type })),
});

/**
 * Creates a mock FileSystemDirectoryEntry
 * Correctly handles the readEntries batching behavior (returns entries once, then empty)
 */
export const createMockDirectoryEntry = (
  name: string,
  children: MockFileSystemEntry[]
): MockFileSystemEntry => {
  let hasBeenRead = false;

  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (success) => {
        if (!hasBeenRead) {
          hasBeenRead = true;
          success(children);
        } else {
          success([]); // Signal end of directory
        }
      },
    }),
  };
};

/**
 * Creates a mock DataTransferItem for drag-and-drop testing
 */
export const createMockDataTransferItem = (
  entry: MockFileSystemEntry | null,
  file: File | null = null
): DataTransferItem => ({
  kind: 'file',
  webkitGetAsEntry: () => entry as unknown as FileSystemEntry,
  getAsFile: () => file,
} as unknown as DataTransferItem);
