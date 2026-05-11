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
import { createMockFile, createMockFileWithPath, createMockShip } from '../test-utils';

// Module-scoped mock functions (referenced by vi.mock — cannot be moved to shared utils)
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

describe('useDrop - Validation', () => {
  beforeEach(() => {
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
    const { ship } = createMockShip();
    const onValidationError = vi.fn();

    // Mock validation to fail with count error
    mockValidateFiles.mockReturnValueOnce({
      files: [
        { name: 'index.html', status: FILE_STATUSES.VALIDATION_FAILED, statusMessage: 'File count exceeded' },
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
      createMockFile('index.html'),
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
    const { ship } = createMockShip();
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
    const { ship } = createMockShip();
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
    const { ship } = createMockShip();

    // Mock validation: empty files are warnings (not errors) but result in no valid files
    mockValidateFiles.mockReturnValueOnce({
      files: [
        { name: 'index.html', status: FILE_STATUSES.EXCLUDED, statusMessage: 'File is empty (0 bytes) and cannot be deployed due to storage limitations' },
      ],
      validFiles: [],
      errors: [],  // No errors (empty files are warnings)
      warnings: [   // Empty files generate warnings
        {
          file: 'index.html',
          message: 'File is empty (0 bytes) and cannot be deployed due to storage limitations'
        }
      ],
      canDeploy: true,  // No errors, but no valid files either
    });

    const { result } = renderHook(() => useDrop({ ship }));

    const file = createMockFile('index.html', '');

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
    const { ship } = createMockShip();

    const { result } = renderHook(() => useDrop({ ship }));

    // Create files — index.html required at root, plus a file with application/octet-stream MIME type
    const files = [
      createMockFile('index.html', '<html></html>'),
      createMockFile('LICENSE', 'MIT License...', 'application/octet-stream'),
    ];

    await act(async () => {
      await result.current.processFiles(files);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    // Should transition to ready state (file accepted — no MIME type validation)
    expect(result.current.phase).toBe('ready');
    expect(result.current.files).toHaveLength(2);
    expect(result.current.files[1].status).toBe(FILE_STATUSES.READY);

    // ValidatableFile no longer includes type — only name and size
    const validateCall = mockValidateFiles.mock.calls[0];
    const filesPassedToValidate = validateCall[0];
    expect(filesPassedToValidate[1].name).toBe('LICENSE');
    expect(filesPassedToValidate[1].size).toBeGreaterThan(0);
  });

  it('should reject files with unsafe characters in directory names', async () => {
    const { ship } = createMockShip();
    const onValidationError = vi.fn();

    // Mock validation to fail with unsafe characters error (matches actual validation behavior)
    mockValidateFiles.mockReturnValueOnce({
      files: [
        { name: 'index.html', status: FILE_STATUSES.READY, statusMessage: 'Ready for upload' },
        { name: 'app/page/file?.js', status: FILE_STATUSES.VALIDATION_FAILED, statusMessage: 'File name contains unsafe characters' },
      ],
      validFiles: [],
      errors: [{
        file: 'app/page/file?.js',
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

    // Create files — index.html required at root, plus a file with unsafe characters in the path
    const indexFile = createMockFile('index.html', '<html></html>');
    const file = createMockFileWithPath(
      'file?.js',
      'app/page/file?.js',
      'export default function Page() {}',
      'text/javascript'
    );

    await act(async () => {
      await result.current.processFiles([indexFile, file]);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.status?.title).toBe('Validation Failed');
    expect(onValidationError).toHaveBeenCalled();
    expect(result.current.files[1].status).toBe(FILE_STATUSES.VALIDATION_FAILED);

    // Critical assertion: Verify that validateFiles was called with the FULL PATH, not just filename
    // This ensures we validate 'app/page/file?.js' not 'file?.js'
    const validateCall = mockValidateFiles.mock.calls[0];
    const filesPassedToValidate = validateCall[0];
    expect(filesPassedToValidate[1].name).toBe('app/page/file?.js');
  });

  it('should reject built site without index.html at root', async () => {
    const { ship } = createMockShip();
    const onValidationError = vi.fn();

    const { result } = renderHook(() =>
      useDrop({ ship, onValidationError })
    );

    const files = [
      createMockFile('style.css', 'body {}'),
      createMockFile('app.js', 'console.log("hi")'),
    ];

    await act(async () => {
      await result.current.processFiles(files);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.status?.title).toBe('Validation Failed');
    expect(result.current.status?.details).toContain('No index.html at root');
    // Regression: the single message must NOT appear in both status.details
    // and status.errors[] — consumers that render both fields show it twice.
    expect(result.current.status?.errors).toBeUndefined();
    expect(onValidationError).toHaveBeenCalledWith(
      expect.objectContaining({ errors: [] })
    );
    // Files are preserved in error state so the user can see what they dropped
    expect(result.current.files).toHaveLength(2);
    expect(result.current.files[0].status).toBe(FILE_STATUSES.VALIDATION_FAILED);
  });

  it('should accept built site with index.html at root', async () => {
    const { ship } = createMockShip();

    const { result } = renderHook(() => useDrop({ ship }));

    const files = [
      createMockFile('index.html', '<html></html>'),
      createMockFile('style.css', 'body {}'),
    ];

    await act(async () => {
      await result.current.processFiles(files);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.phase).toBe('ready');
  });

  it('should reject built site with index.html only in subdirectory', async () => {
    const { ship } = createMockShip();
    const onValidationError = vi.fn();

    const { result } = renderHook(() =>
      useDrop({ ship, onValidationError })
    );

    // Simulate a folder drop where stripCommonPrefix removes the common "dist/" prefix
    // but index.html is nested inside a subdirectory
    const files = [
      createMockFileWithPath('style.css', 'dist/style.css', 'body {}'),
      createMockFileWithPath('index.html', 'dist/public/index.html', '<html></html>'),
    ];

    await act(async () => {
      await result.current.processFiles(files);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.status?.title).toBe('Validation Failed');
    expect(result.current.status?.details).toContain('No index.html at root');
    // Files are preserved — user sees what they dropped
    expect(result.current.files).toHaveLength(2);
  });

  it('should reject unbuilt project without index.html anywhere', async () => {
    const { ship } = createMockShip();
    const onValidationError = vi.fn();

    const { result } = renderHook(() =>
      useDrop({ ship, onValidationError })
    );

    // node_modules triggers needsBuild, but no index.html anywhere
    const files = [
      createMockFileWithPath('package.json', 'myapp/package.json', '{}'),
      createMockFileWithPath('app.js', 'myapp/src/app.js', 'console.log("hi")'),
      createMockFileWithPath('index.js', 'myapp/node_modules/.pnpm/react@19/node_modules/react/index.js', 'react'),
    ];

    await act(async () => {
      await result.current.processFiles(files);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.status?.title).toBe('Validation Failed');
    expect(result.current.status?.details).toContain('No index.html found');
    expect(onValidationError).toHaveBeenCalled();
    // Files are preserved (node_modules stripped, 2 source files remain)
    expect(result.current.files).toHaveLength(2);
    expect(result.current.files[0].status).toBe(FILE_STATUSES.VALIDATION_FAILED);
  });

  it('should accept unbuilt project with index.html in subdirectory', async () => {
    const { ship } = createMockShip();
    const onFilesReady = vi.fn();

    const { result } = renderHook(() =>
      useDrop({ ship, onFilesReady })
    );

    // node_modules triggers needsBuild, index.html is nested in public/
    const files = [
      createMockFileWithPath('package.json', 'myapp/package.json', '{}'),
      createMockFileWithPath('index.html', 'myapp/public/index.html', '<html></html>'),
      createMockFileWithPath('App.tsx', 'myapp/src/App.tsx', 'export default function App() {}'),
      createMockFileWithPath('index.js', 'myapp/node_modules/.pnpm/react@19/node_modules/react/index.js', 'react'),
    ];

    await act(async () => {
      await result.current.processFiles(files);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.needsBuild).toBe(true);
    expect(onFilesReady).toHaveBeenCalled();
  });

  it('should detect unbuilt project with node_modules and set needsBuild', async () => {
    const { ship } = createMockShip();
    const onFilesReady = vi.fn();

    const { result } = renderHook(() =>
      useDrop({ ship, onFilesReady })
    );

    // Simulate a project folder drop: build output + node_modules files
    // node_modules files are stripped, remaining files go to ready with needsBuild
    const files = [
      createMockFileWithPath('index.html', 'demo/dist/index.html', '<html></html>'),
      createMockFileWithPath('app.js', 'demo/dist/assets/app.js', 'console.log("app")'),
      createMockFileWithPath('.modules.yaml', 'demo/node_modules/.modules.yaml', 'yaml'),
      createMockFileWithPath('index.js', 'demo/node_modules/.pnpm/react@19/node_modules/react/index.js', 'react'),
    ];

    await act(async () => {
      await result.current.processFiles(files);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.needsBuild).toBe(true);
    expect(result.current.status?.details).toContain('project will be built');
    // node_modules files should be stripped — only non-node_modules files remain
    expect(result.current.files.every(f => !f.path.includes('node_modules'))).toBe(true);
    // validateFiles should NOT have been called — build uploads skip deploy validation
    expect(mockValidateFiles).not.toHaveBeenCalled();
    expect(onFilesReady).toHaveBeenCalled();
  });

  it('should strip all node_modules files including those under dot directories', async () => {
    const { ship } = createMockShip();

    const { result } = renderHook(() => useDrop({ ship }));

    // node_modules files under .pnpm (dot directory) are stripped along with all node_modules
    const files = [
      createMockFileWithPath('index.html', 'demo/index.html', '<html></html>'),
      createMockFileWithPath('src/App.tsx', 'demo/src/App.tsx', 'export default function App() {}'),
      createMockFileWithPath('index.js', 'demo/node_modules/.pnpm/lodash@4/node_modules/lodash/index.js', 'module.exports'),
    ];

    await act(async () => {
      await result.current.processFiles(files);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.needsBuild).toBe(true);
    // node_modules files stripped, only source files remain
    expect(result.current.files.every(f => !f.path.includes('node_modules'))).toBe(true);
    expect(result.current.files.length).toBe(2);
  });
});
