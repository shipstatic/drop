import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractZipToFiles, isZipFile } from '@/utils/zipExtractor';
import JSZip from 'jszip';

// Mock JSZip
vi.mock('jszip');

describe('zipExtractor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const createMockZipEntry = (
    name: string,
    content: string,
    isDir: boolean = false,
    date: Date = new Date()
  ) => ({
    name,
    dir: isDir,
    date,
    async: vi.fn().mockResolvedValue(new Blob([content], { type: 'text/plain' })),
  });

  describe('extractZipToFiles', () => {
    it('should extract files from ZIP and return File objects', async () => {
      const mockZip = {
        files: {
          'file1.txt': createMockZipEntry('file1.txt', 'content1'),
          'folder/file2.txt': createMockZipEntry('folder/file2.txt', 'content2'),
        },
      };

      vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(2);
      expect(result.errors).toHaveLength(0);

      expect(result.files[0].name).toBe('file1.txt');
      expect(result.files[1].name).toBe('folder/file2.txt');
    });

    it('should skip directories', async () => {
      const mockZip = {
        files: {
          'folder/': createMockZipEntry('folder/', '', true),
          'file.txt': createMockZipEntry('file.txt', 'content'),
        },
      };

      vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('file.txt');
    });

    it('should filter out junk files', async () => {
      const mockZip = {
        files: {
          '.DS_Store': createMockZipEntry('.DS_Store', ''),
          'Thumbs.db': createMockZipEntry('Thumbs.db', ''),
          'desktop.ini': createMockZipEntry('desktop.ini', ''),
          '__MACOSX/file.txt': createMockZipEntry('__MACOSX/file.txt', ''),
          'valid.txt': createMockZipEntry('valid.txt', 'content'),
        },
      };

      vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('valid.txt');
    });

    it('should handle ZIP loading errors', async () => {
      vi.mocked(JSZip.loadAsync).mockRejectedValue(new Error('Corrupt ZIP'));

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to load ZIP file');
      expect(result.errors[0]).toContain('Corrupt ZIP');
    });

    it('should handle individual file extraction errors', async () => {
      const failingEntry = createMockZipEntry('bad.txt', '');
      failingEntry.async.mockRejectedValue(new Error('Extraction failed'));

      const mockZip = {
        files: {
          'good.txt': createMockZipEntry('good.txt', 'content'),
          'bad.txt': failingEntry,
        },
      };

      vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('good.txt');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to extract bad.txt');
    });

    it('should set correct MIME types', async () => {
      const mockZip = {
        files: {
          'image.png': createMockZipEntry('image.png', 'png content'),
          'document.pdf': createMockZipEntry('document.pdf', 'pdf content'),
          'unknown.unknownext': createMockZipEntry('unknown.unknownext', 'content'),
        },
      };

      vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files[0].type).toBe('image/png');
      expect(result.files[1].type).toBe('application/pdf');
      expect(result.files[2].type).toBe('application/octet-stream');
    });

    it('should preserve file modification dates', async () => {
      const testDate = new Date('2023-01-15T10:30:00Z');
      const mockZip = {
        files: {
          'file.txt': createMockZipEntry('file.txt', 'content', false, testDate),
        },
      };

      vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files[0].lastModified).toBe(testDate.getTime());
    });

    it('should handle empty ZIP (only directories)', async () => {
      const mockZip = {
        files: {
          'folder1/': createMockZipEntry('folder1/', '', true),
          'folder2/': createMockZipEntry('folder2/', '', true),
        },
      };

      vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should use Date.now() when entry.date is null', async () => {
      const now = Date.now();
      const mockZip = {
        files: {
          'file.txt': createMockZipEntry('file.txt', 'content', false, undefined as any),
        },
      };

      // Make the entry.date undefined
      mockZip.files['file.txt'].date = undefined as any;

      vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      // Should be close to Date.now()
      expect(result.files[0].lastModified).toBeGreaterThanOrEqual(now);
      expect(result.files[0].lastModified).toBeLessThanOrEqual(Date.now() + 1000);
    });

    // Security tests for path traversal prevention
    describe('Path traversal security', () => {
      it('should sanitize directory traversal attacks (..)', async () => {
        const mockZip = {
          files: {
            '../../etc/passwd': createMockZipEntry('../../etc/passwd', 'malicious'),
            '../../../config.json': createMockZipEntry('../../../config.json', 'malicious'),
          },
        };

        vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

        const zipFile = new File(['dummy'], 'malicious.zip', { type: 'application/zip' });
        const result = await extractZipToFiles(zipFile);

        // Paths should be normalized, removing the traversal
        expect(result.files).toHaveLength(2);
        expect(result.files[0].name).toBe('etc/passwd');
        expect(result.files[1].name).toBe('config.json');
      });

      it('should handle complex path traversal patterns', async () => {
        const mockZip = {
          files: {
            'foo/./bar/../baz.txt': createMockZipEntry('foo/./bar/../baz.txt', 'content'),
            './test/./file.txt': createMockZipEntry('./test/./file.txt', 'content'),
          },
        };

        vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

        const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
        const result = await extractZipToFiles(zipFile);

        expect(result.files).toHaveLength(2);
        expect(result.files[0].name).toBe('foo/baz.txt');
        expect(result.files[1].name).toBe('test/file.txt');
      });

      it('should skip files that resolve to empty paths', async () => {
        const mockZip = {
          files: {
            '../../../': createMockZipEntry('../../../', 'content'),
            '../../..': createMockZipEntry('../../..', 'content'),
            'valid.txt': createMockZipEntry('valid.txt', 'content'),
          },
        };

        vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

        const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
        const result = await extractZipToFiles(zipFile);

        // Only the valid file should be extracted
        expect(result.files).toHaveLength(1);
        expect(result.files[0].name).toBe('valid.txt');
        // Should have error messages for skipped paths
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.includes('Skipped invalid path'))).toBe(true);
      });

      it('should normalize absolute paths', async () => {
        const mockZip = {
          files: {
            '/etc/passwd': createMockZipEntry('/etc/passwd', 'content'),
            '/var/log/system.log': createMockZipEntry('/var/log/system.log', 'content'),
          },
        };

        vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

        const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
        const result = await extractZipToFiles(zipFile);

        // Absolute paths should be converted to relative
        expect(result.files).toHaveLength(2);
        expect(result.files[0].name).toBe('etc/passwd');
        expect(result.files[1].name).toBe('var/log/system.log');
      });

      it('should handle mixed valid and malicious paths', async () => {
        const mockZip = {
          files: {
            'normal/file.txt': createMockZipEntry('normal/file.txt', 'good'),
            '../../malicious.txt': createMockZipEntry('../../malicious.txt', 'bad'),
            'another/normal.txt': createMockZipEntry('another/normal.txt', 'good'),
          },
        };

        vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

        const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
        const result = await extractZipToFiles(zipFile);

        expect(result.files).toHaveLength(3);
        expect(result.files[0].name).toBe('normal/file.txt');
        expect(result.files[1].name).toBe('malicious.txt'); // Sanitized
        expect(result.files[2].name).toBe('another/normal.txt');
      });
    });
  });

  describe('isZipFile', () => {
    it('should identify ZIP by MIME type', () => {
      const file1 = new File([''], 'test.zip', { type: 'application/zip' });
      const file2 = new File([''], 'test.zip', { type: 'application/x-zip-compressed' });

      expect(isZipFile(file1)).toBe(true);
      expect(isZipFile(file2)).toBe(true);
    });

    it('should identify ZIP by extension', () => {
      const file = new File([''], 'test.ZIP', { type: '' });
      expect(isZipFile(file)).toBe(true);
    });

    it('should reject non-ZIP files', () => {
      const file = new File([''], 'test.txt', { type: 'text/plain' });
      expect(isZipFile(file)).toBe(false);
    });
  });
});
