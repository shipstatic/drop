/**
 * useDrop Validation Tests
 *
 * Tests for file validation against Ship SDK config limits:
 * - File count limits
 * - Individual file size limits
 * - Total size limits
 * - Empty file detection
 *
 * Split from useDrop.test.ts for maintainability.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDrop } from '@/hooks/useDrop';
import { FILE_STATUSES } from '@/types';
import { createMockFile, DEFAULT_TEST_CONFIG } from '../test-utils';
import type { Ship } from '@shipstatic/ship';

// Mock @shipstatic/ship
const mockGetConfig = vi.fn();
const mockValidateFiles = vi.fn();

vi.mock('@shipstatic/ship', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipstatic/ship')>();
  return {
    ...actual,
    validateFiles: (...args: any[]) => mockValidateFiles(...args),
    getValidFiles: actual.getValidFiles,
    formatFileSize: actual.formatFileSize,
    filterJunk: actual.filterJunk,
  };
});

// Helper to create mock Ship instance
const createMockShip = (): Ship => ({
  getConfig: mockGetConfig,
} as any);

describe('useDrop - Validation', () => {
  beforeEach(() => {
    mockGetConfig.mockResolvedValue(DEFAULT_TEST_CONFIG);

    // Default mock validation (all files valid)
    mockValidateFiles.mockImplementation((files) => ({
      files: files.map((f: any) => ({ ...f, status: FILE_STATUSES.READY, statusMessage: 'Ready for upload' })),
      validFiles: files.map((f: any) => ({ ...f, status: FILE_STATUSES.READY, statusMessage: 'Ready for upload' })),
      error: null,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('should reject files exceeding count limit', async () => {
    const ship = createMockShip();
    const onValidationError = vi.fn();

    // Mock validation to fail with count error
    mockValidateFiles.mockReturnValueOnce({
      files: [
        { name: 'file1.txt', status: FILE_STATUSES.VALIDATION_FAILED, statusMessage: 'File count exceeded' },
        { name: 'file2.txt', status: FILE_STATUSES.VALIDATION_FAILED, statusMessage: 'File count exceeded' },
        { name: 'file3.txt', status: FILE_STATUSES.VALIDATION_FAILED, statusMessage: 'File count exceeded' },
      ],
      validFiles: [],
      error: {
        error: 'File Count Exceeded',
        details: 'Number of files (3) exceeds the limit of 2.',
        errors: ['File count exceeded'],
        isClientError: true,
      },
    });

    const { result } = renderHook(() =>
      useDrop({ ship, onValidationError })
    );

    const files = [
      createMockFile('file1.txt'),
      createMockFile('file2.txt'),
      createMockFile('file3.txt'),
    ];

    await act(async () => {
      await result.current.processFiles(files);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.status?.title).toBe('File Count Exceeded');
    expect(onValidationError).toHaveBeenCalled();
    expect(result.current.files).toHaveLength(3);
    result.current.files.forEach(file => {
      expect(file.status).toBe(FILE_STATUSES.VALIDATION_FAILED);
    });
  });

  it('should reject files exceeding individual file size limit', async () => {
    const ship = createMockShip();
    const onValidationError = vi.fn();

    // Mock validation to fail with file size error
    mockValidateFiles.mockReturnValueOnce({
      files: [
        { name: 'huge.txt', status: FILE_STATUSES.VALIDATION_FAILED, statusMessage: 'File size exceeds limit' },
      ],
      validFiles: [],
      error: {
        error: 'File Too Large',
        details: 'File size exceeds limit',
        errors: ['File size exceeds limit'],
        isClientError: true,
      },
    });

    const { result } = renderHook(() =>
      useDrop({ ship, onValidationError })
    );

    const file = createMockFile('huge.txt', 'x'.repeat(100));

    await act(async () => {
      await result.current.processFiles([file]);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.status?.title).toBe('File Too Large');
    expect(onValidationError).toHaveBeenCalled();
  });

  it('should reject files when total size exceeds limit', async () => {
    const ship = createMockShip();
    const onValidationError = vi.fn();

    // Mock validation to fail with total size error
    mockValidateFiles.mockReturnValueOnce({
      files: [
        { name: 'file1.txt', status: FILE_STATUSES.VALIDATION_FAILED, statusMessage: 'Total size exceeded' },
        { name: 'file2.txt', status: FILE_STATUSES.VALIDATION_FAILED, statusMessage: 'Total size exceeded' },
      ],
      validFiles: [],
      error: {
        error: 'Total Size Exceeded',
        details: 'Total size exceeds limit',
        errors: ['Total size exceeds limit'],
        isClientError: true,
      },
    });

    const { result } = renderHook(() =>
      useDrop({ ship, onValidationError })
    );

    const files = [
      createMockFile('file1.txt', 'x'.repeat(10)),
      createMockFile('file2.txt', 'x'.repeat(15)),
    ];

    await act(async () => {
      await result.current.processFiles(files);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.status?.title).toBe('Total Size Exceeded');
    expect(onValidationError).toHaveBeenCalled();
  });

  it('should reject empty files (0 bytes)', async () => {
    const ship = createMockShip();

    // Mock validation to fail with empty file error
    mockValidateFiles.mockReturnValueOnce({
      files: [
        { name: 'empty.txt', status: FILE_STATUSES.EMPTY_FILE, statusMessage: 'File is empty (0 bytes)' },
      ],
      validFiles: [],
      error: {
        error: 'Empty File',
        details: 'File is empty (0 bytes)',
        errors: ['File is empty (0 bytes)'],
        isClientError: true,
      },
    });

    const { result } = renderHook(() => useDrop({ ship }));

    const file = createMockFile('empty.txt', '');

    await act(async () => {
      await result.current.processFiles([file]);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.status?.title).toBe('Empty File');
    expect(result.current.files[0].status).toBe(FILE_STATUSES.EMPTY_FILE);
  });

  it('should accept application/octet-stream files (drop-only exception)', async () => {
    const ship = createMockShip();

    const { result } = renderHook(() => useDrop({ ship }));

    // Create a file with application/octet-stream MIME type (like extensionless LICENSE)
    const file = createMockFile('LICENSE', 'MIT License...', 'application/octet-stream');

    await act(async () => {
      await result.current.processFiles([file]);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    // Should transition to ready state (file accepted)
    expect(result.current.phase).toBe('ready');
    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].status).toBe(FILE_STATUSES.READY);

    // Verify that validateFiles was called with text/plain type (the override)
    const validateCall = mockValidateFiles.mock.calls[0];
    const filesPassedToValidate = validateCall[0];
    expect(filesPassedToValidate[0].file.type).toBe('text/plain');
  });
});
