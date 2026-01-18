/**
 * Ship SDK Contract Tests
 *
 * These tests verify that drop's types and behavior remain compatible with
 * the Ship SDK. Unlike other tests that mock Ship functions, these use the
 * real implementations to catch breaking changes early.
 */
import { describe, it, expect } from 'vitest';
import {
  validateFiles,
  getValidFiles,
  filterJunk,
  formatFileSize,
} from '@shipstatic/ship';
import type { ValidatableFile, ConfigResponse } from '@shipstatic/types';
import { FILE_STATUSES, type ProcessedFile } from '@/types';
import { createProcessedFile } from '@/utils/fileProcessing';
import { PRODUCTION_CONFIG } from '../fixtures/config';

describe('Ship SDK Contract', () => {
  describe('ProcessedFile satisfies ValidatableFile interface', () => {
    it('should have all required ValidatableFile properties', async () => {
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      // Compile-time check: ProcessedFile must be assignable to ValidatableFile
      const validatable: ValidatableFile = processed;

      // Runtime checks for required properties
      expect(validatable).toHaveProperty('name');
      expect(validatable).toHaveProperty('size');
      expect(validatable).toHaveProperty('type');
      expect(typeof validatable.name).toBe('string');
      expect(typeof validatable.size).toBe('number');
      expect(typeof validatable.type).toBe('string');
    });

    it('should work with real validateFiles function', async () => {
      const file = new File(['hello world'], 'index.html', { type: 'text/html' });
      const processed = await createProcessedFile(file);

      // Use real validateFiles - not mocked
      const result = validateFiles([processed], PRODUCTION_CONFIG);

      expect(result).toHaveProperty('files');
      expect(result).toHaveProperty('validFiles');
      expect(result).toHaveProperty('error');
      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toHaveProperty('status');
      expect(result.files[0]).toHaveProperty('statusMessage');
    });

    it('should work with real getValidFiles function', async () => {
      const file = new File(['content'], 'app.js', { type: 'application/javascript' });
      const processed = await createProcessedFile(file);

      // First validate
      const validated = validateFiles([processed], PRODUCTION_CONFIG);

      // Then use real getValidFiles
      const valid = getValidFiles(validated.files);

      expect(Array.isArray(valid)).toBe(true);
      // All files should be valid in this case
      expect(valid.length).toBe(validated.validFiles.length);
    });

    it('should preserve ProcessedFile properties through validation', async () => {
      const file = new File(['css content'], 'styles.css', { type: 'text/css' });
      const processed = await createProcessedFile(file);

      // ProcessedFile-specific properties
      expect(processed).toHaveProperty('id');
      expect(processed).toHaveProperty('file');
      expect(processed).toHaveProperty('path');
      expect(processed).toHaveProperty('lastModified');

      const result = validateFiles([processed], PRODUCTION_CONFIG);

      // Properties should survive validation (generic T extends ValidatableFile)
      const validatedFile = result.files[0] as ProcessedFile;
      expect(validatedFile.id).toBe(processed.id);
      expect(validatedFile.path).toBe(processed.path);
      expect(validatedFile.file).toBe(processed.file);
    });
  });

  describe('filterJunk integration', () => {
    it('should work with paths from ProcessedFile', async () => {
      const files = [
        new File(['a'], 'index.html', { type: 'text/html' }),
        new File(['b'], '.DS_Store', { type: 'application/octet-stream' }),
        new File(['c'], 'app.js', { type: 'application/javascript' }),
      ];

      const processed = await Promise.all(files.map(f => createProcessedFile(f)));
      const paths = processed.map(p => p.path);

      // Use real filterJunk
      const cleanPaths = filterJunk(paths);

      expect(cleanPaths).toContain('index.html');
      expect(cleanPaths).toContain('app.js');
      expect(cleanPaths).not.toContain('.DS_Store');
    });

    it('should handle webkitRelativePath-style paths', () => {
      const paths = [
        'myproject/index.html',
        'myproject/__MACOSX/._index.html',
        'myproject/src/app.js',
        'myproject/.DS_Store',
      ];

      const cleanPaths = filterJunk(paths);

      expect(cleanPaths).toEqual([
        'myproject/index.html',
        'myproject/src/app.js',
      ]);
    });
  });

  describe('formatFileSize integration', () => {
    it('should format file sizes correctly', () => {
      // Verify drop can use ship's formatFileSize
      expect(formatFileSize(0)).toBe('0 Bytes');
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1024 * 1024)).toBe('1 MB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });
  });

  describe('Validation error handling', () => {
    it('should reject files with disallowed MIME types', async () => {
      // Use a MIME type that's NOT in the allowed categories
      // chemical/ is a valid mime-db category but not allowed for static hosting
      const file = new File(['molecule data'], 'molecule.xyz', { type: 'chemical/x-xyz' });
      const processed = await createProcessedFile(file);

      const result = validateFiles([processed], PRODUCTION_CONFIG);

      expect(result.error).not.toBeNull();
      expect(result.error?.error).toBe('Invalid File Type');
      expect(result.validFiles).toHaveLength(0);
      expect(result.files[0].status).toBe('validation_failed');
    });

    it('should accept audio and video files', async () => {
      const audioFile = new File(['audio content'], 'song.mp3', { type: 'audio/mpeg' });
      const videoFile = new File(['video content'], 'clip.mp4', { type: 'video/mp4' });

      const processed = await Promise.all([
        createProcessedFile(audioFile),
        createProcessedFile(videoFile),
      ]);

      const result = validateFiles(processed, PRODUCTION_CONFIG);

      expect(result.error).toBeNull();
      expect(result.validFiles).toHaveLength(2);
    });

    it('should accept TypeScript files with video/mp2t MIME type', async () => {
      // This is the key test: .ts files get video/mp2t from mime-db
      // but should still be accepted because video/ is allowed
      const tsFile = new File(['const x = 1;'], 'app.ts', { type: 'video/mp2t' });
      const processed = await createProcessedFile(tsFile);

      const result = validateFiles([processed], PRODUCTION_CONFIG);

      expect(result.error).toBeNull();
      expect(result.validFiles).toHaveLength(1);
    });

    it('should reject empty files', async () => {
      const file = new File([], 'empty.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      const result = validateFiles([processed], PRODUCTION_CONFIG);

      expect(result.error).not.toBeNull();
      expect(result.error?.error).toBe('Empty File');
      // Atomic validation marks all files as validation_failed
      expect(result.files[0].status).toBe('validation_failed');
    });

    it('should reject files exceeding size limit', async () => {
      const tinyConfig: ConfigResponse = {
        ...PRODUCTION_CONFIG,
        maxFileSize: 5, // 5 bytes
      };

      const file = new File(['this is more than 5 bytes'], 'big.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      const result = validateFiles([processed], tinyConfig);

      expect(result.error).not.toBeNull();
      expect(result.error?.error).toBe('File Too Large');
    });

    it('should handle atomic validation (all fail if one fails)', async () => {
      const tinyConfig: ConfigResponse = {
        ...PRODUCTION_CONFIG,
        maxFileSize: 100,
      };

      const files = [
        new File(['small'], 'small.txt', { type: 'text/plain' }),
        new File(['x'.repeat(200)], 'big.txt', { type: 'text/plain' }),
      ];

      const processed = await Promise.all(files.map(f => createProcessedFile(f)));
      const result = validateFiles(processed, tinyConfig);

      // Atomic: all files should be marked as failed
      expect(result.validFiles).toHaveLength(0);
      expect(result.files.every(f => f.status === 'validation_failed')).toBe(true);
    });
  });

  describe('Status constants alignment', () => {
    it('should use status values that Ship SDK recognizes', () => {
      // Verify FILE_STATUSES values match what Ship SDK expects
      expect(FILE_STATUSES.READY).toBe('ready');
      expect(FILE_STATUSES.PENDING).toBe('pending');
      expect(FILE_STATUSES.VALIDATION_FAILED).toBe('validation_failed');
      expect(FILE_STATUSES.EMPTY_FILE).toBe('empty_file');
      expect(FILE_STATUSES.PROCESSING_ERROR).toBe('processing_error');
    });
  });
});
