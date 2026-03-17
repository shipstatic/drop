import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractZipToFiles, isZipFile } from '@/utils/zipExtractor';
import { unzipSync } from 'fflate';

vi.mock('fflate');

const encode = (s: string) => new TextEncoder().encode(s);

describe('zipExtractor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('extractZipToFiles', () => {
    it('should extract files from ZIP and return File objects', async () => {
      vi.mocked(unzipSync).mockReturnValue({
        'file1.txt': encode('content1'),
        'folder/file2.txt': encode('content2'),
      });

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(2);
      expect(result.errors).toHaveLength(0);

      expect(result.files[0].name).toBe('file1.txt');
      expect(result.files[1].name).toBe('folder/file2.txt');
    });

    it('should skip directories', async () => {
      vi.mocked(unzipSync).mockReturnValue({
        'folder/': new Uint8Array(0),
        'file.txt': encode('content'),
      });

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('file.txt');
    });

    it('should extract all files (junk filtering happens at higher level)', async () => {
      vi.mocked(unzipSync).mockReturnValue({
        '.DS_Store': encode(''),
        'Thumbs.db': encode(''),
        'desktop.ini': encode(''),
        '__MACOSX/file.txt': encode(''),
        'valid.txt': encode('content'),
      });

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(5);
      const fileNames = result.files.map(f => f.name).sort();
      expect(fileNames).toEqual([
        '.DS_Store',
        'Thumbs.db',
        '__MACOSX/file.txt',
        'desktop.ini',
        'valid.txt',
      ]);
    });

    it('should handle ZIP loading errors', async () => {
      vi.mocked(unzipSync).mockImplementation(() => {
        throw new Error('Corrupt ZIP');
      });

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to load ZIP file');
      expect(result.errors[0]).toContain('Corrupt ZIP');
    });

    it('should set correct MIME types', async () => {
      vi.mocked(unzipSync).mockReturnValue({
        'image.png': encode('png content'),
        'document.pdf': encode('pdf content'),
        'unknown.unknownext': encode('content'),
      });

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files[0].type).toBe('image/png');
      expect(result.files[1].type).toBe('application/pdf');
      expect(result.files[2].type).toBe(''); // Unknown extension returns empty string
    });

    it('should handle empty ZIP (only directories)', async () => {
      vi.mocked(unzipSync).mockReturnValue({
        'folder1/': new Uint8Array(0),
        'folder2/': new Uint8Array(0),
      });

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    // Security tests for path traversal prevention
    describe('Path traversal security', () => {
      it('should sanitize directory traversal attacks (..)', async () => {
        vi.mocked(unzipSync).mockReturnValue({
          '../../etc/passwd': encode('malicious'),
          '../../../config.json': encode('malicious'),
        });

        const zipFile = new File(['dummy'], 'malicious.zip', { type: 'application/zip' });
        const result = await extractZipToFiles(zipFile);

        expect(result.files).toHaveLength(2);
        expect(result.files[0].name).toBe('etc/passwd');
        expect(result.files[1].name).toBe('config.json');
      });

      it('should handle complex path traversal patterns', async () => {
        vi.mocked(unzipSync).mockReturnValue({
          'foo/./bar/../baz.txt': encode('content'),
          './test/./file.txt': encode('content'),
        });

        const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
        const result = await extractZipToFiles(zipFile);

        expect(result.files).toHaveLength(2);
        expect(result.files[0].name).toBe('foo/baz.txt');
        expect(result.files[1].name).toBe('test/file.txt');
      });

      it('should skip files that resolve to empty paths', async () => {
        vi.mocked(unzipSync).mockReturnValue({
          '../../../': new Uint8Array(0),
          '../../..': encode('content'),
          'valid.txt': encode('content'),
        });

        const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
        const result = await extractZipToFiles(zipFile);

        // '../../../' is a directory (ends with / + empty) → skipped by directory check
        // '../../..' normalizes to '' → skipped with error
        // 'valid.txt' extracts fine
        expect(result.files).toHaveLength(1);
        expect(result.files[0].name).toBe('valid.txt');
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.includes('Skipped invalid path'))).toBe(true);
      });

      it('should normalize absolute paths', async () => {
        vi.mocked(unzipSync).mockReturnValue({
          '/etc/passwd': encode('content'),
          '/var/log/system.log': encode('content'),
        });

        const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
        const result = await extractZipToFiles(zipFile);

        expect(result.files).toHaveLength(2);
        expect(result.files[0].name).toBe('etc/passwd');
        expect(result.files[1].name).toBe('var/log/system.log');
      });

      it('should handle mixed valid and malicious paths', async () => {
        vi.mocked(unzipSync).mockReturnValue({
          'normal/file.txt': encode('good'),
          '../../malicious.txt': encode('bad'),
          'another/normal.txt': encode('good'),
        });

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

  describe('Error message branch coverage', () => {
    it('should handle non-Error objects in ZIP loading failure', async () => {
      vi.mocked(unzipSync).mockImplementation(() => {
        throw 'string error';
      });

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to load ZIP file');
      expect(result.errors[0]).toContain('string error');
    });

    it('should handle null/undefined rejection in ZIP loading', async () => {
      vi.mocked(unzipSync).mockImplementation(() => {
        throw null;
      });

      const zipFile = new File(['dummy'], 'test.zip', { type: 'application/zip' });
      const result = await extractZipToFiles(zipFile);

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('null');
    });
  });
});
