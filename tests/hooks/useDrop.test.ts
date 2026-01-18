import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDrop } from '@/hooks/useDrop';
import { FILE_STATUSES } from '@/types';
import { createMockFile, createMockFileWithPath } from '../test-utils';
import type { Ship } from '@shipstatic/ship';

// Mock @shipstatic/ship
const mockGetConfig = vi.fn();
const mockValidateFiles = vi.fn();

vi.mock('@shipstatic/ship', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipstatic/ship')>();
  return {
    ...actual,
    validateFiles: (...args: any[]) => mockValidateFiles(...args),
    // Explicitly keep getValidFiles from actual if possible, or use the real one if it's pure
    getValidFiles: actual.getValidFiles,
    formatFileSize: actual.formatFileSize,
    filterJunk: actual.filterJunk,
  };
});

// Mock JSZip
vi.mock('jszip');

// Helper to create mock Ship instance
const createMockShip = (): Ship => ({
  getConfig: mockGetConfig,
} as any);

describe('useDrop', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });

    // Default mock config - uses relaxed limits for unit tests
    // MIME types match production to avoid false negatives with video/audio files
    mockGetConfig.mockResolvedValue({
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 500 * 1024 * 1024,
      maxFilesCount: 10000,
      allowedMimeTypes: ['text/', 'image/', 'audio/', 'video/', 'font/', 'model/', 'application/'],
    });

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

  describe('Initial state', () => {
    it('should initialize with empty state', () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      expect(result.current.files).toEqual([]);
      expect(result.current.status).toBeNull();
      expect(result.current.phase).toBe('idle');
      // expect(result.current.state.value).not.toBe('error'); // Internal state not exposed
    });

    it('should accept callback options', () => {
      const ship = createMockShip();
      const onValidationError = vi.fn();
      const onFilesReady = vi.fn();

      const { result } = renderHook(() =>
        useDrop({ ship, onValidationError, onFilesReady })
      );

      expect(result.current.files).toEqual([]);
      expect(result.current.files).toEqual([]);
      expect(result.current.sourceName).toBe('');
      expect(result.current.status).toBeNull();
    });
  });

  describe('processFiles - basic functionality', () => {
    it('should process single file successfully', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const file = createMockFile('test.txt', 'hello world');

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('test.txt');
      expect(result.current.phase).toBe('ready');
      expect(result.current.files[0].status).toBe(FILE_STATUSES.READY);
      // expect(result.current.state.value).not.toBe('error');
      expect(result.current.sourceName).toBe('test.txt');
      expect(mockGetConfig).toHaveBeenCalled();
      expect(mockValidateFiles).toHaveBeenCalled();
    });

    it('should process multiple files successfully', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const files = [
        createMockFile('file1.txt', 'content1'),
        createMockFile('file2.txt', 'content2'),
        createMockFile('file3.txt', 'content3'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(3);
      expect(result.current.files.map(f => f.name)).toEqual(['file1.txt', 'file2.txt', 'file3.txt']);
      result.current.files.forEach(file => {
        expect(file.status).toBe(FILE_STATUSES.READY);
      });
    });

    it('should handle empty files array', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      await act(async () => {
        await result.current.processFiles([]);
      });

      expect(result.current.files).toHaveLength(0);
      expect(result.current.status).toBeNull();
    });

    it('should call onFilesReady callback when files are valid', async () => {
      const ship = createMockShip();
      const onFilesReady = vi.fn();
      const { result } = renderHook(() =>
        useDrop({ ship, onFilesReady })
      );

      const file = createMockFile('test.txt', 'content');

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(onFilesReady).toHaveBeenCalled();
      });

      expect(onFilesReady).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'test.txt', status: FILE_STATUSES.READY })
        ])
      );
    });
  });

  describe('Validation', () => {
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
  });

  describe('File management', () => {
    it('should clear all files', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const files = [
        createMockFile('file1.txt'),
        createMockFile('file2.txt'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.files).toHaveLength(2);
      });

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.files).toHaveLength(0);
      expect(result.current.status).toBeNull();
      expect(result.current.phase).not.toBe('error');
      expect(result.current.isProcessing).toBe(false);
    });

    it('should get only valid files', async () => {
      const ship = createMockShip();

      // Mock validation to have one valid and one invalid file
      mockValidateFiles.mockReturnValueOnce({
        files: [
          { name: 'small.txt', status: FILE_STATUSES.READY, statusMessage: 'Ready for upload' },
          { name: 'huge.txt', status: FILE_STATUSES.VALIDATION_FAILED, statusMessage: 'File size exceeds limit' },
        ],
        validFiles: [
          { name: 'small.txt', status: FILE_STATUSES.READY, statusMessage: 'Ready for upload' },
        ],
        error: {
          error: 'File Too Large',
          details: 'File size exceeds limit',
          errors: ['huge.txt: File size exceeds limit'],
          isClientError: true,
        },
      });

      const { result } = renderHook(() =>
        useDrop({ ship })
      );

      const files = [
        createMockFile('small.txt', 'x'),
        createMockFile('huge.txt', 'x'.repeat(100)),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      const validFiles = result.current.validFiles;
      expect(validFiles).toHaveLength(1);
      expect(validFiles[0].name).toBe('small.txt');
      expect(validFiles[0].status).toBe(FILE_STATUSES.READY);
    });
  });

  describe('updateFileStatus', () => {
    it('should update file upload status', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const file = createMockFile('test.txt');

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.files).toHaveLength(1);
      });

      const fileId = result.current.files[0].id;

      act(() => {
        result.current.updateFileStatus(fileId, {
          status: FILE_STATUSES.UPLOADING,
          statusMessage: 'Uploading to server...',
          progress: 50,
        });
      });

      const updatedFile = result.current.files.find(f => f.id === fileId);
      expect(updatedFile?.status).toBe(FILE_STATUSES.UPLOADING);
      expect(updatedFile?.statusMessage).toBe('Uploading to server...');
      expect(updatedFile?.progress).toBe(50);
    });
  });

  describe('stripPrefix option', () => {
    it('should strip common prefix when stripPrefix=true (default)', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      // Use createMockFileWithPath to properly simulate folder drag-and-drop
      // In real scenarios, webkitRelativePath is set by the browser
      const files = [
        createMockFileWithPath('index.html', 'myProject/index.html', 'html content'),
        createMockFileWithPath('app.js', 'myProject/src/app.js', 'js content'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files[0].path).toBe('index.html');
      expect(result.current.files[1].path).toBe('src/app.js');
    });

    it('should not strip prefix when stripPrefix=false', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship, stripPrefix: false }));

      // Use createMockFileWithPath to properly simulate folder drag-and-drop
      const files = [
        createMockFileWithPath('index.html', 'myProject/index.html', 'html content'),
        createMockFileWithPath('app.js', 'myProject/src/app.js', 'js content'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files[0].path).toBe('myProject/index.html');
      expect(result.current.files[1].path).toBe('myProject/src/app.js');
    });
  });

  describe('ZIP file handling', () => {
    it('should extract ZIP when single ZIP file is dropped', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      // Create a spy to track if extractZipToFiles was called
      const extractSpy = vi.spyOn(await import('@/utils/zipExtractor'), 'extractZipToFiles');

      // Mock a ZIP file
      const zipFile = createMockFile('archive.zip', 'zip content', 'application/zip');

      await act(async () => {
        await result.current.processFiles([zipFile]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      // Verify that extractZipToFiles was called for single ZIP
      expect(extractSpy).toHaveBeenCalledWith(zipFile);

      extractSpy.mockRestore();
    });

    it('should NOT extract ZIP when multiple files including ZIP are dropped', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      // Create a spy to track if extractZipToFiles was NOT called
      const extractSpy = vi.spyOn(await import('@/utils/zipExtractor'), 'extractZipToFiles');

      // Multiple files including one ZIP
      const files = [
        createMockFile('document.pdf', 'pdf content', 'application/pdf'),
        createMockFile('archive.zip', 'zip content', 'application/zip'),
        createMockFile('image.png', 'png content', 'image/png'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      // Should have 3 files (ZIP not extracted)
      expect(result.current.files).toHaveLength(3);
      expect(result.current.files.map(f => f.name)).toEqual(['document.pdf', 'archive.zip', 'image.png']);

      // Verify that extractZipToFiles was NOT called
      expect(extractSpy).not.toHaveBeenCalled();

      extractSpy.mockRestore();
    });

    it('should NOT extract ZIP when multiple ZIPs are dropped', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      // Create a spy to track if extractZipToFiles was NOT called
      const extractSpy = vi.spyOn(await import('@/utils/zipExtractor'), 'extractZipToFiles');

      const files = [
        createMockFile('archive1.zip', 'zip content 1', 'application/zip'),
        createMockFile('archive2.zip', 'zip content 2', 'application/zip'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      // Should have 2 files (ZIPs not extracted)
      expect(result.current.files).toHaveLength(2);
      expect(result.current.files.map(f => f.name)).toEqual(['archive1.zip', 'archive2.zip']);

      // Verify that extractZipToFiles was NOT called
      expect(extractSpy).not.toHaveBeenCalled();

      extractSpy.mockRestore();
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle case when no valid files after processing', async () => {
      const ship = createMockShip();
      const onValidationError = vi.fn();

      // Mock validation to fail all files
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

      const file = createMockFile('huge.txt', 'x'.repeat(1000));

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.status?.title).toBe('File Too Large');
      expect(result.current.files).toHaveLength(1);
      expect(result.current.validFiles).toHaveLength(0);
    });

    it('should reset state when processFiles is called again', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      // First batch
      await act(async () => {
        await result.current.processFiles([createMockFile('file1.txt')]);
      });

      await waitFor(() => {
        expect(result.current.files).toHaveLength(1);
      });

      // Second batch should reset
      await act(async () => {
        await result.current.processFiles([createMockFile('file2.txt')]);
      });

      await waitFor(() => {
        expect(result.current.files).toHaveLength(1);
      });

      expect(result.current.files[0].name).toBe('file2.txt');
    });
  });

  describe('Concurrency protection', () => {
    it('should ignore concurrent processFiles calls', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

      const file1 = createMockFile('file1.txt');
      const file2 = createMockFile('file2.txt');

      // Start first processing (don't await yet)
      const promise1 = act(async () => {
        await result.current.processFiles([file1]);
      });

      // Immediately try to start second processing while first is in progress
      await act(async () => {
        await result.current.processFiles([file2]);
      });

      // Wait for first to complete
      await promise1;

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      // Should have warned about concurrent call
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'File processing already in progress. Ignoring duplicate call.'
      );

      // Should only have files from first call
      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('file1.txt');
      expect(result.current.files[0].status).toBe(FILE_STATUSES.READY);
      consoleWarnSpy.mockRestore();
    });

    it('should allow processFiles after previous call completes', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      // First call
      await act(async () => {
        await result.current.processFiles([createMockFile('file1.txt')]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('file1.txt');

      // Second call should work fine
      await act(async () => {
        await result.current.processFiles([createMockFile('file2.txt')]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('file2.txt');
    });

    it('should clear processing flag on error', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      // Make getConfig fail to simulate processing error
      mockGetConfig.mockRejectedValueOnce(new Error('Config fetch failed'));

      const file = createMockFile('test.txt');

      await act(async () => {
        await result.current.processFiles([file]);
      });
      expect(result.current.isProcessing).toBe(false);
    });

    it('should allow processing valid files after an error', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      // 1. Simulate an error first
      mockGetConfig.mockRejectedValueOnce(new Error('Config fetch failed'));
      await act(async () => {
        await result.current.processFiles([createMockFile('bad.txt')]);
      });

      // Should have error state
      expect(result.current.phase).toBe('error');
      expect(result.current.status?.title).toBe('Processing Failed');

      // 2. Now simulate success
      // Reset mock to working state
      mockGetConfig.mockResolvedValue({
        maxFileSize: 100 * 1024 * 1024,
        maxTotalSize: 500 * 1024 * 1024,
        maxFilesCount: 10000,
        allowedMimeTypes: ['text/', 'image/', 'audio/', 'video/', 'font/', 'model/', 'application/'],
      });

      await act(async () => {
        await result.current.processFiles([createMockFile('good.txt')]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('good.txt');
    });
  });

  describe('Source name detection', () => {
    it('should detect source name from single file', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const file = createMockFile('document.pdf', 'content');

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.sourceName).toBe('document.pdf');
    });

    it('should detect source name from folder (webkitRelativePath)', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const files = [
        createMockFileWithPath('index.html', 'my-project/index.html'),
        createMockFileWithPath('app.js', 'my-project/src/app.js'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.sourceName).toBe('my-project');
    });

    it('should detect source name from ZIP file (without extension)', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const zipFile = createMockFile('website.zip', 'zip content', 'application/zip');

      await act(async () => {
        await result.current.processFiles([zipFile]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.sourceName).toBe('website');
    });

    it('should clear source name when clearAll is called', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const file = createMockFile('test.txt');

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.sourceName).toBe('test.txt');
      });

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.sourceName).toBe('');
    });
  });

  describe('Junk file filtering', () => {
    it('should filter out .DS_Store files', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const files = [
        createMockFile('index.html', 'content'),
        createMockFile('.DS_Store', 'junk'),
        createMockFile('app.js', 'code'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      // Should only have 2 files (junk filtered out)
      expect(result.current.files).toHaveLength(2);
      const fileNames = result.current.files.map(f => f.name);
      expect(fileNames).toEqual(['index.html', 'app.js']);
      expect(fileNames).not.toContain('.DS_Store');
    });

    it('should filter out Thumbs.db and desktop.ini', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const files = [
        createMockFile('document.pdf', 'content'),
        createMockFile('Thumbs.db', 'windows junk'),
        createMockFile('desktop.ini', 'windows junk'),
        createMockFile('image.png', 'image'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(2);
      const fileNames = result.current.files.map(f => f.name);
      expect(fileNames).toEqual(['document.pdf', 'image.png']);
    });

    it('should filter out files in __MACOSX directory', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const files = [
        createMockFileWithPath('index.html', 'project/index.html', 'content'),
        createMockFileWithPath('._index.html', '__MACOSX/project/._index.html', 'resource fork'),
        createMockFileWithPath('app.js', 'project/app.js', 'code'),
        createMockFileWithPath('.DS_Store', '__MACOSX/.DS_Store', 'junk'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      // Should only have the 2 valid files (not the __MACOSX ones)
      expect(result.current.files).toHaveLength(2);
      expect(result.current.phase).toBe('ready'); // Should be back to ready state
      expect(result.current.status?.title).toBe('Ready'); // Status is present in Ready state
    });

    it('should handle all junk files being filtered out', async () => {
      const ship = createMockShip();
      const onValidationError = vi.fn();
      const { result } = renderHook(() => useDrop({ ship, onValidationError }));

      const files = [
        createMockFile('.DS_Store', 'junk'),
        createMockFile('Thumbs.db', 'junk'),
        createMockFile('desktop.ini', 'junk'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      // All files filtered out - should have validation error
      expect(result.current.files).toHaveLength(0);
      expect(result.current.status?.title).toBe('No Valid Files'); // Assuming specific error handling logic or default
      // expect(result.current.value).toBe('error'); // value is removed
      expect(onValidationError).toHaveBeenCalled();
    });

    it('should work correctly with mixed valid and junk files from folder drop', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const files = [
        createMockFileWithPath('index.html', 'mysite/index.html', 'html'),
        createMockFileWithPath('.DS_Store', 'mysite/.DS_Store', 'junk'),
        createMockFileWithPath('app.js', 'mysite/src/app.js', 'code'),
        createMockFileWithPath('.DS_Store', 'mysite/src/.DS_Store', 'junk'),
        createMockFileWithPath('styles.css', 'mysite/css/styles.css', 'css'),
        createMockFileWithPath('Thumbs.db', 'mysite/css/Thumbs.db', 'junk'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      // Should have 3 valid files (junk filtered)
      expect(result.current.files).toHaveLength(3);
      const paths = result.current.files.map(f => f.path).sort();
      expect(paths).toEqual(['css/styles.css', 'index.html', 'src/app.js']);
    });
  });
});
