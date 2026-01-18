import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createProcessedFile,
  stripCommonPrefix,
  traverseFileTree,
} from '@/utils/fileProcessing';
import { getValidFiles, formatFileSize } from '@shipstatic/ship';
import { FILE_STATUSES } from '@/types';
import { createMockFile } from '../test-utils';

// Mock @shipstatic/ship
vi.mock('@shipstatic/ship', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipstatic/ship')>();
  return {
    ...actual,
    formatFileSize: actual.formatFileSize,
    getValidFiles: actual.getValidFiles,
    filterJunk: actual.filterJunk,
  };
});

describe('fileProcessing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 Bytes');
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.5 MB');
      expect(formatFileSize(500)).toBe('500 Bytes');
      expect(formatFileSize(1024 * 1024 * 1024 * 2.5)).toBe('2.5 GB');
    });

    it('should handle decimals parameter', () => {
      expect(formatFileSize(1024 * 1024 * 1.567, 0)).toBe('2 MB');
      expect(formatFileSize(1024 * 1024 * 1.567, 1)).toBe('1.6 MB');
      expect(formatFileSize(1024 * 1024 * 1.567, 3)).toBe('1.567 MB');
    });
  });

  describe('createProcessedFile', () => {
    it('should create ProcessedFile from File', () => {
      const file = createMockFile('test.txt', 'hello world');
      const processed = createProcessedFile(file);

      expect(processed.id).toBeTruthy();
      expect(processed.file).toBe(file);
      expect(processed.name).toBe('test.txt');
      expect(processed.path).toBe('test.txt');
      expect(processed.size).toBe(file.size);
      expect(processed.type).toBe('text/plain');
      expect(processed.status).toBe(FILE_STATUSES.PENDING);
      // MD5 is not calculated in Drop - handled by Ship SDK
      expect(processed.md5).toBeUndefined();
    });

    it('should support custom path', () => {
      const file = createMockFile('original.txt');
      const processed = createProcessedFile(file, { path: 'folder/custom.txt' });

      expect(processed.path).toBe('folder/custom.txt');
      expect(processed.name).toBe('custom.txt');
    });

    it('should determine MIME type from extension', () => {
      const file = createMockFile('document.pdf', 'pdf content', '');
      const processed = createProcessedFile(file);

      expect(processed.type).toBe('application/pdf');
    });

    it('should fall back to application/octet-stream for unknown types', () => {
      const file = createMockFile('unknown.unknownext', 'content', '');
      const processed = createProcessedFile(file);

      expect(processed.type).toBe('application/octet-stream');
    });
  });

  // Note: validateFiles is now handled by Ship SDK
  // Validation tests are in the Ship SDK package

  describe('getValidFiles', () => {
    it('should return only files with READY status', () => {
      const file1 = createProcessedFile(createMockFile('file1.txt'));
      const file2 = createProcessedFile(createMockFile('file2.txt'));

      file1.status = FILE_STATUSES.READY;
      file2.status = FILE_STATUSES.VALIDATION_FAILED;

      const valid = getValidFiles([file1, file2]);
      expect(valid).toHaveLength(1);
      expect(valid[0]).toBe(file1);
    });

    it('should return empty array for empty input', () => {
      const valid = getValidFiles([]);
      expect(valid).toEqual([]);
    });

    it('should return empty array when no files are READY', () => {
      const file1 = createProcessedFile(createMockFile('file1.txt'));
      file1.status = FILE_STATUSES.VALIDATION_FAILED;

      const valid = getValidFiles([file1]);
      expect(valid).toEqual([]);
    });
  });

  // Note: allValidFilesHaveChecksums removed - MD5 calculation now handled by Ship SDK

  describe('stripCommonPrefix', () => {
    it('should strip common directory prefix', () => {
      const files = [
        createProcessedFile(createMockFile('file.txt'), { path: 'myProject/index.html' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'myProject/src/app.js' }),
      ];

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('index.html');
      expect(result[1].path).toBe('src/app.js');
    });

    it('should not strip if no common prefix', () => {
      const files = [
        createProcessedFile(createMockFile('file.txt'), { path: 'projectA/file.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'projectB/file.txt' }),
      ];

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('projectA/file.txt');
      expect(result[1].path).toBe('projectB/file.txt');
    });

    it('should handle files at root', () => {
      const files = [
        createProcessedFile(createMockFile('file1.txt'), { path: 'file1.txt' }),
        createProcessedFile(createMockFile('file2.txt'), { path: 'file2.txt' }),
      ];

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('file2.txt');
    });

    it('should handle single file in folder', () => {
      const files = [
        createProcessedFile(createMockFile('file.txt'), { path: 'myProject/index.html' }),
      ];

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('index.html');
    });

    it('should handle empty array', () => {
      const result = stripCommonPrefix([]);
      expect(result).toEqual([]);
    });
  });

  describe('traverseFileTree', () => {
    it('should handle errors gracefully and log warning', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const files: File[] = [];

      // Create a mock entry that throws when accessed
      const mockEntry = {
        name: 'broken-entry',
        isFile: true,
        isDirectory: false,
        file: vi.fn((onSuccess, onError) => {
          onError(new Error('Permission denied'));
        }),
      } as unknown as FileSystemEntry;

      await traverseFileTree(mockEntry, files, '');

      expect(consoleWarn).toHaveBeenCalledWith(
        'Error traversing file tree for entry broken-entry:',
        expect.any(Error)
      );
      // No files should be added due to error
      expect(files).toEqual([]);

      consoleWarn.mockRestore();
    });

    it('should process file entries successfully', async () => {
      const files: File[] = [];
      const mockFile = createMockFile('test.txt', 'content');

      const mockEntry = {
        name: 'test.txt',
        isFile: true,
        isDirectory: false,
        file: vi.fn((onSuccess) => {
          onSuccess(mockFile);
        }),
      } as unknown as FileSystemEntry;

      await traverseFileTree(mockEntry, files, 'folder');

      expect(files).toHaveLength(1);
      expect((files[0] as any).webkitRelativePath).toBe('folder/test.txt');
    });

    it('should process directory entries recursively', async () => {
      const files: File[] = [];
      const mockFile = createMockFile('nested.txt', 'content');

      const mockFileEntry = {
        name: 'nested.txt',
        isFile: true,
        isDirectory: false,
        file: vi.fn((onSuccess) => {
          onSuccess(mockFile);
        }),
      } as unknown as FileSystemEntry;

      // Track read calls per instance
      let readCount = 0;
      const mockDirEntry = {
        name: 'subdir',
        isFile: false,
        isDirectory: true,
        createReader: () => ({
          readEntries: vi.fn((onSuccess) => {
            // First call returns entries, second call returns empty (signals done)
            if (readCount === 0) {
              readCount++;
              onSuccess([mockFileEntry]);
            } else {
              onSuccess([]);
            }
          }),
        }),
      } as unknown as FileSystemEntry;

      // Note: In actual usage, the directory name is passed as currentPath
      // (see useDrop.ts: entriesToTraverse.push({ entry, path: entry.name }))
      await traverseFileTree(mockDirEntry, files, 'subdir');

      expect(files).toHaveLength(1);
      expect((files[0] as any).webkitRelativePath).toBe('subdir/nested.txt');
    });
  });
});
