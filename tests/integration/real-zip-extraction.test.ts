/**
 * Real ZIP Extraction Integration Tests
 *
 * These tests use actual ZIP files to verify that ZIP extraction
 * works correctly end-to-end.
 *
 * This catches issues that mocked tests might miss:
 * - Real ZIP file format edge cases
 * - Binary data handling
 *
 * Note: Files created from real buffers (without _testContent property)
 * automatically use native Blob implementations via setup.ts.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { extractZipToFiles, isZipFile } from '@/utils/zipExtractor';
import * as fs from 'fs';
import * as path from 'path';

describe('Real ZIP Extraction', () => {
  // Load the test fixture
  const fixturePath = path.join(__dirname, '../fixtures/test-site.zip');
  let zipBuffer: Buffer;

  beforeAll(() => {
    // Read the fixture once
    zipBuffer = fs.readFileSync(fixturePath);
  });

  let zipFile: File;

  beforeEach(() => {
    // Create a fresh File for each test
    zipFile = new File([zipBuffer], 'test-site.zip', { type: 'application/zip' });
  });

  describe('extractZipToFiles with real ZIP', () => {
    // The test fixture has files under test-site/ directory
    const PREFIX = 'test-site/';

    it('should extract files from a real ZIP archive', async () => {
      const result = await extractZipToFiles(zipFile);

      // If there are errors, throw them so we can see them
      if (result.errors.length > 0) {
        throw new Error('ZIP extraction errors: ' + result.errors.join(', '));
      }

      // Should have no errors
      expect(result.errors).toHaveLength(0);

      // Should extract all files (not directories)
      expect(result.files.length).toBeGreaterThanOrEqual(3);

      // webkitRelativePath holds the full path (including test-site/ prefix from the fixture)
      const filePaths = result.files.map(f => f.webkitRelativePath).sort();
      expect(filePaths).toContain(PREFIX + 'index.html');
      expect(filePaths).toContain(PREFIX + 'style.css');
      expect(filePaths).toContain(PREFIX + 'assets/app.js');

      // file.name is just the bare filename
      const fileNames = result.files.map(f => f.name).sort();
      expect(fileNames).toContain('index.html');
      expect(fileNames).toContain('style.css');
      expect(fileNames).toContain('app.js');
    });

    it('should preserve file content from real ZIP', async () => {
      const result = await extractZipToFiles(zipFile);

      // Find index.html by path and verify content
      const indexFile = result.files.find(f => f.webkitRelativePath === PREFIX + 'index.html');
      expect(indexFile).toBeDefined();

      const content = await indexFile!.text();
      expect(content).toContain('<!DOCTYPE html>');
      expect(content).toContain('Hello');
    });

    it('should set correct MIME types for extracted files', async () => {
      const result = await extractZipToFiles(zipFile);

      const indexFile = result.files.find(f => f.webkitRelativePath === PREFIX + 'index.html');
      const cssFile = result.files.find(f => f.webkitRelativePath === PREFIX + 'style.css');
      const jsFile = result.files.find(f => f.webkitRelativePath === PREFIX + 'assets/app.js');

      expect(indexFile?.type).toBe('text/html');
      expect(cssFile?.type).toBe('text/css');
      expect(jsFile?.type).toBe('application/javascript');
    });

    it('should correctly identify real ZIP file', () => {
      expect(isZipFile(zipFile)).toBe(true);
    });

    it('should handle real ZIP with nested directories', async () => {
      const result = await extractZipToFiles(zipFile);

      // Should have files in nested directories
      const nestedFiles = result.files.filter(f => f.webkitRelativePath.includes('/'));
      expect(nestedFiles.length).toBeGreaterThan(0);

      // Nested file should have correct path
      const appJs = result.files.find(f => f.webkitRelativePath === PREFIX + 'assets/app.js');
      expect(appJs).toBeDefined();
    });
  });

  describe('Error handling with invalid ZIP', () => {
    it('should handle non-ZIP file gracefully', async () => {
      const notZip = new File(['this is not a zip'], 'fake.zip', {
        type: 'application/zip',
      });

      const result = await extractZipToFiles(notZip);

      expect(result.files).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to load ZIP file');
    });

    it('should handle empty file', async () => {
      const emptyZip = new File([], 'empty.zip', {
        type: 'application/zip',
      });

      const result = await extractZipToFiles(emptyZip);

      expect(result.files).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
