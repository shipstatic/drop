import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateMD5,
  formatFileSize,
  createProcessedFile,
  validateFiles,
  getValidFiles,
  allValidFilesHaveChecksums,
  stripCommonPrefix,
} from '@/utils/fileProcessing';
import { FILE_STATUSES, type ValidationConfig } from '@/types';
import { createMockFile } from '../test-utils';

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

describe('fileProcessing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('calculateMD5', () => {
    it('should calculate MD5 hash from ArrayBuffer', async () => {
      const buffer = new TextEncoder().encode('test content').buffer;
      const result = await calculateMD5(buffer);
      expect(result).toBe('mocked-md5-hash');
    });
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
    it('should create ProcessedFile from File', async () => {
      const file = createMockFile('test.txt', 'hello world');
      const processed = await createProcessedFile(file);

      expect(processed.id).toBeTruthy();
      expect(processed.file).toBe(file);
      expect(processed.name).toBe('test.txt');
      expect(processed.path).toBe('test.txt');
      expect(processed.size).toBe(file.size);
      expect(processed.type).toBe('text/plain');
      expect(processed.status).toBe(FILE_STATUSES.PENDING);
      expect(processed.md5).toBe('mocked-md5-hash');
    });

    it('should support custom path', async () => {
      const file = createMockFile('original.txt');
      const processed = await createProcessedFile(file, { path: 'folder/custom.txt' });

      expect(processed.path).toBe('folder/custom.txt');
      expect(processed.name).toBe('custom.txt');
    });

    it('should skip MD5 calculation when requested', async () => {
      const file = createMockFile('test.txt');
      const processed = await createProcessedFile(file, { calculateMD5: false });

      expect(processed.md5).toBeUndefined();
    });

    it('should determine MIME type from extension', async () => {
      const file = createMockFile('document.pdf', 'pdf content', '');
      const processed = await createProcessedFile(file);

      expect(processed.type).toBe('application/pdf');
    });

    it('should fall back to application/octet-stream for unknown types', async () => {
      const file = createMockFile('unknown.unknownext', 'content', '');
      const processed = await createProcessedFile(file);

      expect(processed.type).toBe('application/octet-stream');
    });

    it('should mark file as PROCESSING_ERROR if MD5 calculation fails', async () => {
      // Use null content to signal the global mock to throw an error
      const file = createMockFile('test.txt', null);

      const processed = await createProcessedFile(file);

      expect(processed.status).toBe(FILE_STATUSES.PROCESSING_ERROR);
      expect(processed.statusMessage).toContain('Failed to calculate checksum');
      expect(processed.statusMessage).toContain('Mocked file read error');
      expect(processed.md5).toBeUndefined();
    });
  });

  describe('validateFiles', () => {
    const config: ValidationConfig = {
      maxFileSize: 5 * 1024 * 1024, // 5MB
      maxTotalSize: 25 * 1024 * 1024, // 25MB
      maxFilesCount: 100,
    };

    it('should mark all files as valid when within limits', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file1.txt', 'a'.repeat(1024))),
        createProcessedFile(createMockFile('file2.txt', 'b'.repeat(2048))),
      ]);

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(2);
      expect(result.error).toBeNull();
      result.files.forEach(f => {
        expect(f.status).toBe(FILE_STATUSES.READY);
        expect(f.statusMessage).toBe('Ready for upload');
      });
    });

    it('should reject when file count exceeds limit', async () => {
      const files = await Promise.all(
        Array.from({ length: 101 }, (_, i) =>
          createProcessedFile(createMockFile(`file${i}.txt`))
        )
      );

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('File Count Exceeded');
      result.files.forEach(f => {
        expect(f.status).toBe(FILE_STATUSES.VALIDATION_FAILED);
      });
    });

    it('should reject empty files', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('empty.txt', '')),
        createProcessedFile(createMockFile('valid.txt', 'content')),
      ]);

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(1);
      expect(result.error?.error).toBe('Empty File');
      expect(result.files[0].status).toBe(FILE_STATUSES.EMPTY_FILE);
      expect(result.files[1].status).toBe(FILE_STATUSES.READY);
    });

    it('should reject files exceeding individual size limit', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('huge.txt', 'x'.repeat(6 * 1024 * 1024))),
        createProcessedFile(createMockFile('ok.txt', 'content')),
      ]);

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(1);
      expect(result.error?.error).toBe('File Too Large');
      expect(result.files[0].status).toBe(FILE_STATUSES.VALIDATION_FAILED);
    });

    it('should reject when total size exceeds limit (last file)', async () => {
      const smallConfig: ValidationConfig = {
        maxFileSize: 15 * 1024 * 1024, // Allow files up to 15MB individually
        maxTotalSize: 25 * 1024 * 1024, // 25MB total
        maxFilesCount: 100,
      };

      const files = await Promise.all([
        createProcessedFile(createMockFile('file1.txt', 'x'.repeat(10 * 1024 * 1024))), // 10MB
        createProcessedFile(createMockFile('file2.txt', 'x'.repeat(10 * 1024 * 1024))), // 10MB - total 20MB (ok)
        createProcessedFile(createMockFile('file3.txt', 'x'.repeat(6 * 1024 * 1024))), // 6MB - total 26MB (exceeds)
      ]);

      const result = validateFiles(files, smallConfig);

      expect(result.validFiles).toHaveLength(2);
      expect(result.error?.error).toBe('Total Size Exceeded');
      expect(result.files[0].status).toBe(FILE_STATUSES.READY);
      expect(result.files[1].status).toBe(FILE_STATUSES.READY);
      expect(result.files[2].status).toBe(FILE_STATUSES.VALIDATION_FAILED);
    });

    it('should reject file that breaches total size limit in the middle of the list', async () => {
      const config: ValidationConfig = {
        maxFileSize: 20 * 1024 * 1024, // Allow files up to 20MB individually
        maxTotalSize: 25 * 1024 * 1024, // 25MB total
        maxFilesCount: 100,
      };

      const files = await Promise.all([
        createProcessedFile(createMockFile('file1.txt', 'x'.repeat(10 * 1024 * 1024))), // 10MB - total 10MB (ok)
        createProcessedFile(createMockFile('file2.txt', 'x'.repeat(16 * 1024 * 1024))), // 16MB - total 26MB (exceeds!)
        createProcessedFile(createMockFile('file3.txt', 'x'.repeat(4 * 1024 * 1024))),  // 4MB - never evaluated
      ]);

      const result = validateFiles(files, config);

      // Only the first file should be valid
      expect(result.validFiles).toHaveLength(1);
      expect(result.validFiles[0].name).toBe('file1.txt');
      expect(result.error?.error).toBe('Total Size Exceeded');

      // First file is valid
      expect(result.files[0].status).toBe(FILE_STATUSES.READY);
      expect(result.files[0].statusMessage).toBe('Ready for upload');

      // Second file is the one that triggered the limit - should be marked as failed
      expect(result.files[1].status).toBe(FILE_STATUSES.VALIDATION_FAILED);
      expect(result.files[1].statusMessage).toContain('Total size would exceed limit');

      // Third file also gets marked as failed (loop continues)
      expect(result.files[2].status).toBe(FILE_STATUSES.VALIDATION_FAILED);
      expect(result.files[2].statusMessage).toContain('Total size would exceed limit');
    });

    it('should preserve PROCESSING_ERROR status from createProcessedFile', async () => {
      const failedFile = await createProcessedFile(createMockFile('test.txt'));

      // Manually set it to PROCESSING_ERROR to simulate MD5 failure
      failedFile.status = FILE_STATUSES.PROCESSING_ERROR;
      failedFile.statusMessage = 'Failed to calculate checksum: test error';

      const goodFile = await createProcessedFile(createMockFile('good.txt'));

      const result = validateFiles([failedFile, goodFile], config);

      expect(result.validFiles).toHaveLength(1);
      expect(result.validFiles[0].name).toBe('good.txt');
      expect(result.error?.error).toBe('Processing Error');
      expect(result.files[0].status).toBe(FILE_STATUSES.PROCESSING_ERROR);
      expect(result.files[0].statusMessage).toContain('Failed to calculate checksum');
    });
  });

  describe('getValidFiles', () => {
    it('should return only files with READY status', async () => {
      const file1 = await createProcessedFile(createMockFile('file1.txt'));
      const file2 = await createProcessedFile(createMockFile('file2.txt'));

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

    it('should return empty array when no files are READY', async () => {
      const file1 = await createProcessedFile(createMockFile('file1.txt'));
      file1.status = FILE_STATUSES.VALIDATION_FAILED;

      const valid = getValidFiles([file1]);
      expect(valid).toEqual([]);
    });
  });

  describe('allValidFilesHaveChecksums', () => {
    it('should return true when all valid files have MD5', async () => {
      const file1 = await createProcessedFile(createMockFile('file1.txt'));
      const file2 = await createProcessedFile(createMockFile('file2.txt'));

      file1.status = FILE_STATUSES.READY;
      file2.status = FILE_STATUSES.READY;

      const result = allValidFilesHaveChecksums([file1, file2]);
      expect(result).toBe(true);
    });

    it('should return false when no valid files exist', async () => {
      const file1 = await createProcessedFile(createMockFile('file1.txt'));
      file1.status = FILE_STATUSES.VALIDATION_FAILED;

      const result = allValidFilesHaveChecksums([file1]);
      expect(result).toBe(false);
    });

    it('should return false for empty array', () => {
      const result = allValidFilesHaveChecksums([]);
      expect(result).toBe(false);
    });

    it('should return false when some valid files lack MD5', async () => {
      const file1 = await createProcessedFile(createMockFile('file1.txt'));
      const file2 = await createProcessedFile(createMockFile('file2.txt'));

      file1.status = FILE_STATUSES.READY;
      file2.status = FILE_STATUSES.READY;
      file2.md5 = undefined; // Simulate MD5 calculation failure

      const result = allValidFilesHaveChecksums([file1, file2]);
      expect(result).toBe(false);
    });
  });

  describe('stripCommonPrefix', () => {
    it('should strip common directory prefix', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'myProject/index.html' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'myProject/src/app.js' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('index.html');
      expect(result[1].path).toBe('src/app.js');
    });

    it('should not strip if no common prefix', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'projectA/file.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'projectB/file.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('projectA/file.txt');
      expect(result[1].path).toBe('projectB/file.txt');
    });

    it('should handle files at root', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file1.txt'), { path: 'file1.txt' }),
        createProcessedFile(createMockFile('file2.txt'), { path: 'file2.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('file2.txt');
    });

    it('should handle single file in folder', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'myProject/index.html' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('index.html');
    });

    it('should handle empty array', () => {
      const result = stripCommonPrefix([]);
      expect(result).toEqual([]);
    });
  });
});
