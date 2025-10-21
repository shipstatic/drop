import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDrop } from '@/hooks/useDrop';
import { FILE_STATUSES } from '@/types';
import { createMockFile, createMockFileWithPath } from '../test-utils';

// Mock SparkMD5
vi.mock('spark-md5', () => ({
  default: {
    ArrayBuffer: class {
      append() {}
      end() {
        return 'mocked-md5-hash';
      }
    },
  },
}));

// Mock JSZip
vi.mock('jszip');

describe('useDrop', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial state', () => {
    it('should initialize with empty state', () => {
      const { result } = renderHook(() => useDrop());

      expect(result.current.files).toEqual([]);
      expect(result.current.statusText).toBe('');
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.validationError).toBeNull();
      expect(result.current.hasChecksums).toBe(false);
    });

    it('should accept custom validation config', () => {
      const customConfig = {
        maxFileSize: 1024,
        maxTotalSize: 2048,
        maxFilesCount: 5,
      };

      const { result } = renderHook(() =>
        useDrop({ validation: customConfig })
      );

      expect(result.current.files).toEqual([]);
    });

    it('should accept callback options', () => {
      const onValidationError = vi.fn();
      const onFilesReady = vi.fn();

      const { result } = renderHook(() =>
        useDrop({ onValidationError, onFilesReady })
      );

      expect(result.current.files).toEqual([]);
    });
  });

  describe('processFiles - basic functionality', () => {
    it('should process single file successfully', async () => {
      const { result } = renderHook(() => useDrop());

      const file = createMockFile('test.txt', 'hello world');

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('test.txt');
      expect(result.current.files[0].status).toBe(FILE_STATUSES.READY);
      expect(result.current.files[0].md5).toBe('mocked-md5-hash');
      expect(result.current.validationError).toBeNull();
    });

    it('should process multiple files successfully', async () => {
      const { result } = renderHook(() => useDrop());

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
      const { result } = renderHook(() => useDrop());

      await act(async () => {
        await result.current.processFiles([]);
      });

      expect(result.current.files).toHaveLength(0);
      expect(result.current.statusText).toBe('No files selected.');
    });

    it('should call onFilesReady callback when files are valid', async () => {
      const onFilesReady = vi.fn();
      const { result } = renderHook(() =>
        useDrop({ onFilesReady })
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
      const onValidationError = vi.fn();
      const { result } = renderHook(() =>
        useDrop({
          config: { maxFilesCount: 2 },
          onValidationError,
        })
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

      expect(result.current.validationError).not.toBeNull();
      expect(result.current.validationError?.error).toBe('File Count Exceeded');
      expect(onValidationError).toHaveBeenCalled();
      expect(result.current.files).toHaveLength(3);
      result.current.files.forEach(file => {
        expect(file.status).toBe(FILE_STATUSES.VALIDATION_FAILED);
      });
    });

    it('should reject files exceeding individual file size limit', async () => {
      const onValidationError = vi.fn();
      const { result } = renderHook(() =>
        useDrop({
          config: { maxFileSize: 10 },
          onValidationError,
        })
      );

      const file = createMockFile('huge.txt', 'x'.repeat(100));

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.validationError).not.toBeNull();
      expect(result.current.validationError?.error).toBe('File Too Large');
      expect(onValidationError).toHaveBeenCalled();
    });

    it('should reject files when total size exceeds limit', async () => {
      const onValidationError = vi.fn();
      const { result } = renderHook(() =>
        useDrop({
          config: { maxTotalSize: 20 },
          onValidationError,
        })
      );

      const files = [
        createMockFile('file1.txt', 'x'.repeat(10)),
        createMockFile('file2.txt', 'x'.repeat(15)), // Total: 25 > 20
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.validationError).not.toBeNull();
      expect(result.current.validationError?.error).toBe('Total Size Exceeded');
      expect(onValidationError).toHaveBeenCalled();
    });

    it('should reject empty files (0 bytes)', async () => {
      const { result } = renderHook(() => useDrop());

      const file = createMockFile('empty.txt', '');

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.validationError?.error).toBe('Empty File');
      expect(result.current.files[0].status).toBe(FILE_STATUSES.EMPTY_FILE);
    });
  });

  describe('File management', () => {
    it('should remove file by ID', async () => {
      const { result } = renderHook(() => useDrop());

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

      const fileIdToRemove = result.current.files[0].id;

      act(() => {
        result.current.removeFile(fileIdToRemove);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('file2.txt');
    });

    it('should clear all files', async () => {
      const { result } = renderHook(() => useDrop());

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
      expect(result.current.statusText).toBe('');
      expect(result.current.validationError).toBeNull();
      expect(result.current.isProcessing).toBe(false);
    });

    it('should get only valid files', async () => {
      const { result } = renderHook(() =>
        useDrop({
          config: { maxFileSize: 10 },
        })
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

      const validFiles = result.current.getValidFiles();
      expect(validFiles).toHaveLength(1);
      expect(validFiles[0].name).toBe('small.txt');
      expect(validFiles[0].status).toBe(FILE_STATUSES.READY);
    });
  });

  describe('updateFileStatus', () => {
    it('should update file upload status', async () => {
      const { result } = renderHook(() => useDrop());

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

  describe('hasChecksums', () => {
    it('should return true when all valid files have MD5', async () => {
      const { result } = renderHook(() => useDrop());

      const file = createMockFile('test.txt');

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.hasChecksums).toBe(true);
    });

    it('should return false when no valid files exist', async () => {
      const { result } = renderHook(() => useDrop());

      expect(result.current.hasChecksums).toBe(false);
    });
  });

  describe('stripPrefix option', () => {
    it('should strip common prefix when stripPrefix=true (default)', async () => {
      const { result } = renderHook(() => useDrop());

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
      const { result } = renderHook(() => useDrop({ stripPrefix: false }));

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
      const { result } = renderHook(() => useDrop());

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
      const { result } = renderHook(() => useDrop());

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
      const { result } = renderHook(() => useDrop());

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
      const onValidationError = vi.fn();
      const { result } = renderHook(() =>
        useDrop({
          config: { maxFileSize: 1 }, // Very small limit
          onValidationError,
        })
      );

      const file = createMockFile('huge.txt', 'x'.repeat(1000));

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.validationError?.error).toBe('File Too Large');
      expect(result.current.files).toHaveLength(1);
      expect(result.current.getValidFiles()).toHaveLength(0);
    });

    it('should reset state when processFiles is called again', async () => {
      const { result } = renderHook(() => useDrop());

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
      const { result } = renderHook(() => useDrop());
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

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

      consoleWarnSpy.mockRestore();
    });

    it('should allow processFiles after previous call completes', async () => {
      const { result } = renderHook(() => useDrop());

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
      const { result } = renderHook(() => useDrop());

      // Create a mock file that will cause an error during processing
      const badFile = createMockFile('bad.txt');
      // Make arrayBuffer fail
      (badFile as any).arrayBuffer = () => Promise.reject(new Error('Read error'));

      await act(async () => {
        await result.current.processFiles([badFile]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      // Should have error
      expect(result.current.validationError).not.toBeNull();

      // Should be able to process new files after error
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
});
