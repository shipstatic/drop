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
      const processed = createProcessedFile(file);

      // Compile-time check: ProcessedFile must be assignable to ValidatableFile
      const validatable: ValidatableFile = processed;

      // Runtime checks for required properties
      expect(validatable).toHaveProperty('name');
      expect(validatable).toHaveProperty('size');
      expect(typeof validatable.name).toBe('string');
      expect(typeof validatable.size).toBe('number');
    });

    it('should work with real validateFiles function', async () => {
      const file = new File(['hello world'], 'index.html', { type: 'text/html' });
      const processed = createProcessedFile(file);

      // Use real validateFiles - not mocked
      const result = validateFiles([processed], PRODUCTION_CONFIG);

      expect(result).toHaveProperty('files');
      expect(result).toHaveProperty('validFiles');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('canDeploy');
      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toHaveProperty('status');
      expect(result.files[0]).toHaveProperty('statusMessage');
    });

    it('should work with real getValidFiles function', async () => {
      const file = new File(['content'], 'app.js', { type: 'application/javascript' });
      const processed = createProcessedFile(file);

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
      const processed = createProcessedFile(file);

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
    it('should reject files with blocked extensions', async () => {
      const file = new File(['malicious'], 'payload.exe', { type: 'application/octet-stream' });
      const processed = createProcessedFile(file);

      const result = validateFiles([processed], PRODUCTION_CONFIG);

      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('not allowed');
      expect(result.validFiles).toHaveLength(0);
      expect(result.files[0].status).toBe('validation_failed');
    });

    it('should accept any non-blocked extension', async () => {
      const files = [
        new File(['audio content'], 'song.mp3'),
        new File(['video content'], 'clip.mp4'),
        new File(['molecule data'], 'molecule.xyz'),
        new File(['const x = 1;'], 'app.ts'),
      ];

      const processed = files.map(f => createProcessedFile(f));
      const result = validateFiles(processed, PRODUCTION_CONFIG);

      expect(result.canDeploy).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validFiles).toHaveLength(4);
    });

    it('should reject empty files', async () => {
      const file = new File([], 'empty.txt', { type: 'text/plain' });
      const processed = createProcessedFile(file);

      const result = validateFiles([processed], PRODUCTION_CONFIG);

      expect(result.canDeploy).toBe(true); // No errors, but no valid files
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1); // Empty files generate warnings
      expect(result.warnings[0].message).toContain('empty');
      expect(result.validFiles).toHaveLength(0); // No valid files to deploy
      // Empty files are marked as excluded, not validation_failed
      expect(result.files[0].status).toBe('excluded');
    });

    it('should reject files exceeding size limit', async () => {
      const tinyConfig: ConfigResponse = {
        ...PRODUCTION_CONFIG,
        maxFileSize: 5, // 5 bytes
      };

      const file = new File(['this is more than 5 bytes'], 'big.txt', { type: 'text/plain' });
      const processed = createProcessedFile(file);

      const result = validateFiles([processed], tinyConfig);

      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('exceeds limit');
    });

    it('should handle atomic validation (all fail if one fails)', async () => {
      // Atomic validation: if ANY file fails, ALL files marked as failed
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

      // Atomic: all files should be marked as failed when any error occurs
      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
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
      expect(FILE_STATUSES.EXCLUDED).toBe('excluded'); // Changed from EMPTY_FILE
      expect(FILE_STATUSES.PROCESSING_ERROR).toBe('processing_error');
    });
  });
});
