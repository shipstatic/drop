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
import { createMockFile, createMockFileWithPath, DEFAULT_TEST_CONFIG } from '../test-utils';
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

    // Default mock validation (all files valid) - NEW API structure
    mockValidateFiles.mockImplementation((files) => ({
      files: files.map((f: any) => ({ ...f, status: FILE_STATUSES.READY, statusMessage: 'Ready for upload' })),
      validFiles: files.map((f: any) => ({ ...f, status: FILE_STATUSES.READY, statusMessage: 'Ready for upload' })),
      errors: [],      // NEW: No errors
      warnings: [],    // NEW: No warnings
      canDeploy: true, // NEW: Can deploy
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
      errors: [{
        file: '(3 files)',
        severity: 'error',
        type: 'file_count_exceeded',
        message: 'File count (3) exceeds limit of 2'
      }],
      warnings: [],
      canDeploy: false,
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

    expect(result.current.status?.title).toBe('Validation Failed');
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
      errors: [{
        file: 'huge.txt',
        severity: 'error',
        type: 'file_too_large',
        message: 'File size exceeds limit'
      }],
      warnings: [],
      canDeploy: false,
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

    expect(result.current.status?.title).toBe('Validation Failed');
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
      errors: [{
        file: 'file2.txt',
        severity: 'error',
        type: 'total_size_exceeded',
        message: 'Total size exceeds limit'
      }],
      warnings: [],
      canDeploy: false,
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

    expect(result.current.status?.title).toBe('Validation Failed');
    expect(onValidationError).toHaveBeenCalled();
  });

  it('should exclude empty files (0 bytes) with warnings', async () => {
    const ship = createMockShip();

    // Mock validation: empty files are warnings (not errors) but result in no valid files
    mockValidateFiles.mockReturnValueOnce({
      files: [
        { name: 'empty.txt', status: FILE_STATUSES.EXCLUDED, statusMessage: 'File is empty (0 bytes) and cannot be deployed due to storage limitations' },
      ],
      validFiles: [],
      errors: [],  // No errors (empty files are warnings)
      warnings: [   // Empty files generate warnings
        {
          file: 'empty.txt',
          message: 'File is empty (0 bytes) and cannot be deployed due to storage limitations'
        }
      ],
      canDeploy: true,  // No errors, but no valid files either
    });

    const { result } = renderHook(() => useDrop({ ship }));

    const file = createMockFile('empty.txt', '');

    await act(async () => {
      await result.current.processFiles([file]);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    // Should stay in ready state (not error) because only warnings, no errors
    expect(result.current.phase).toBe('ready');
    expect(result.current.status?.title).toBe('All files excluded');
    expect(result.current.status?.warnings).toBeDefined();
    expect(result.current.status?.warnings?.length).toBeGreaterThan(0);
    expect(result.current.files[0].status).toBe(FILE_STATUSES.EXCLUDED);
    // validFiles.length === 0 will naturally disable deploy button in UI
    expect(result.current.validFiles).toHaveLength(0);
  });

  it('should accept files with any MIME type (extension blocklist only)', async () => {
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

    // Should transition to ready state (file accepted — no MIME type validation)
    expect(result.current.phase).toBe('ready');
    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].status).toBe(FILE_STATUSES.READY);

    // ValidatableFile no longer includes type — only name and size
    const validateCall = mockValidateFiles.mock.calls[0];
    const filesPassedToValidate = validateCall[0];
    expect(filesPassedToValidate[0].name).toBe('LICENSE');
    expect(filesPassedToValidate[0].size).toBeGreaterThan(0);
  });

  it('should reject files with square brackets in directory names', async () => {
    const ship = createMockShip();
    const onValidationError = vi.fn();

    // Mock validation to fail with unsafe characters error (matches actual validation behavior)
    mockValidateFiles.mockReturnValueOnce({
      files: [
        { name: 'app/page/[slug]/page.js', status: FILE_STATUSES.VALIDATION_FAILED, statusMessage: 'File name contains unsafe characters' },
      ],
      validFiles: [],
      errors: [{
        file: 'app/page/[slug]/page.js',
        severity: 'error',
        type: 'invalid_filename',
        message: 'File name contains unsafe characters'
      }],
      warnings: [],
      canDeploy: false,
    });

    const { result } = renderHook(() =>
      useDrop({ ship, onValidationError, stripPrefix: false })  // Disable prefix stripping to test full path validation
    );

    // Create a file with square brackets in the path (Next.js dynamic route)
    const file = createMockFileWithPath(
      'page.js',
      'app/page/[slug]/page.js',
      'export default function Page() {}',
      'text/javascript'
    );

    await act(async () => {
      await result.current.processFiles([file]);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.status?.title).toBe('Validation Failed');
    expect(onValidationError).toHaveBeenCalled();
    expect(result.current.files[0].status).toBe(FILE_STATUSES.VALIDATION_FAILED);

    // Critical assertion: Verify that validateFiles was called with the FULL PATH, not just filename
    // This is the bug fix - we now validate 'app/page/[slug]/page.js' not 'page.js'
    const validateCall = mockValidateFiles.mock.calls[0];
    const filesPassedToValidate = validateCall[0];
    expect(filesPassedToValidate[0].name).toBe('app/page/[slug]/page.js');
  });
});
