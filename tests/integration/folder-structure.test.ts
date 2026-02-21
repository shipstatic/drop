/**
 * Integration tests for folder structure preservation
 *
 * These tests verify that the package correctly preserves folder structure
 * when processing files with webkitRelativePath - a critical requirement
 * for Ship SDK deployments.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDrop } from '@/hooks/useDrop';
import { FILE_STATUSES } from '@/types';
import { createMockFile, createMockFileWithPath } from '../test-utils';
import type { Ship } from '@shipstatic/ship';

// Mock @shipstatic/ship
const mockGetConfig = vi.fn();
const mockValidateFiles = vi.fn();

// Mock @shipstatic/ship
vi.mock('@shipstatic/ship', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipstatic/ship')>();
  return {
    ...actual,
    validateFiles: (...args: any[]) => mockValidateFiles(...args),
    formatFileSize: actual.formatFileSize,
    getValidFiles: actual.getValidFiles,
    filterJunk: actual.filterJunk,
  };
});

// Helper to create mock Ship instance
const createMockShip = (): Ship => ({
  getConfig: mockGetConfig,
} as any);

describe('Folder Structure Preservation', () => {
  beforeEach(() => {
    // Console mocking is handled globally in setup.ts

    // Default mock config - relaxed limits for unit tests
    mockGetConfig.mockResolvedValue({
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 500 * 1024 * 1024,
      maxFilesCount: 10000,
    });

    // Default mock validation (all files valid)
    mockValidateFiles.mockImplementation((files) => ({
      files: files.map((f: any) => ({ ...f, status: FILE_STATUSES.READY, statusMessage: 'Ready for upload' })),
      validFiles: files.map((f: any) => ({ ...f, status: FILE_STATUSES.READY, statusMessage: 'Ready for upload' })),
      errors: [],
      warnings: [],
      canDeploy: true,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('webkitRelativePath support', () => {
    it('should preserve webkitRelativePath during processing', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship, stripPrefix: false }));

      const file = createMockFileWithPath(
        'app.js',
        'mysite/src/app.js',
        'console.log("Hello")'
      );

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].path).toBe('mysite/src/app.js');
      expect(result.current.files[0].name).toBe('app.js');
      expect(result.current.files[0].status).toBe(FILE_STATUSES.READY);
    });

    it('should use file.name when webkitRelativePath is empty', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const file = createMockFile('standalone.js', 'content');
      // webkitRelativePath exists but is empty string (standard browser behavior)
      Object.defineProperty(file, 'webkitRelativePath', {
        value: '',
        writable: false, configurable: true,
        enumerable: true,
      });

      await act(async () => {
        await result.current.processFiles([file]);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].path).toBe('standalone.js');
      expect(result.current.files[0].name).toBe('standalone.js');
    });

    it('should maintain folder structure for multiple files', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship, stripPrefix: false }));

      const files = [
        createMockFileWithPath('index.html', 'mysite/index.html', '<!DOCTYPE html>'),
        createMockFileWithPath('app.js', 'mysite/src/app.js', 'console.log()'),
        createMockFileWithPath('style.css', 'mysite/css/style.css', 'body {}'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(3);
      expect(result.current.files.map(f => f.path)).toEqual([
        'mysite/index.html',
        'mysite/src/app.js',
        'mysite/css/style.css',
      ]);
      expect(result.current.files.map(f => f.name)).toEqual([
        'index.html',
        'app.js',
        'style.css',
      ]);
    });

    it('should strip common prefix when stripPrefix=true (default)', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const files = [
        createMockFileWithPath('index.html', 'mysite/index.html', '<!DOCTYPE html>'),
        createMockFileWithPath('app.js', 'mysite/src/app.js', 'console.log()'),
        createMockFileWithPath('style.css', 'mysite/css/style.css', 'body {}'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(3);
      // Common prefix 'mysite/' should be stripped
      expect(result.current.files.map(f => f.path)).toEqual([
        'index.html',
        'src/app.js',
        'css/style.css',
      ]);
    });

    it('should handle nested folder structures', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship, stripPrefix: false }));

      const files = [
        createMockFileWithPath('index.js', 'project/src/components/Button/index.js'),
        createMockFileWithPath('styles.css', 'project/src/components/Button/styles.css'),
        createMockFileWithPath('test.js', 'project/src/components/Button/__tests__/test.js'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(3);
      expect(result.current.files[0].path).toBe('project/src/components/Button/index.js');
      expect(result.current.files[1].path).toBe('project/src/components/Button/styles.css');
      expect(result.current.files[2].path).toBe('project/src/components/Button/__tests__/test.js');
    });
  });

  describe('Mixed file sources', () => {
    it('should handle mix of files with and without webkitRelativePath', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship, stripPrefix: false }));

      const files = [
        // File from folder drag (has webkitRelativePath)
        createMockFileWithPath('app.js', 'src/app.js', 'folder file'),
        // File from individual file picker (no webkitRelativePath)
        createMockFile('standalone.txt', 'standalone file'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.files).toHaveLength(2);
      expect(result.current.files[0].path).toBe('src/app.js');
      expect(result.current.files[1].path).toBe('standalone.txt');
    });
  });

  describe('Ship SDK compatibility', () => {
    it('should return files in Ship SDK compatible format', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      const files = [
        createMockFileWithPath('index.html', 'dist/index.html', '<!DOCTYPE html>'),
        createMockFileWithPath('app.js', 'dist/app.js', 'console.log()'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      const validFiles = result.current.validFiles;

      // Verify format matches Ship SDK requirements
      validFiles.forEach(f => {
        expect(f).toHaveProperty('file'); // Original File object
        expect(f).toHaveProperty('path'); // Normalized path
        expect(f).toHaveProperty('size');
        expect(f.status).toBe(FILE_STATUSES.READY);
      });

      // Verify paths are correctly processed
      expect(validFiles[0].path).toBe('index.html'); // Prefix stripped
      expect(validFiles[1].path).toBe('app.js'); // Prefix stripped
    });

    it('should preserve path information for Ship SDK deploy() call', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship, stripPrefix: false }));

      const files = [
        createMockFileWithPath('index.html', 'public/index.html'),
        createMockFileWithPath('404.html', 'public/404.html'),
        createMockFileWithPath('app.js', 'public/js/app.js'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      const validFiles = result.current.validFiles;

      // Simulate Ship SDK deploy() call
      const staticFiles = validFiles.map(f => ({
        content: f.file,
        path: f.path, // This is what Ship SDK needs!
        size: f.size,
      }));

      // Verify Ship SDK would receive correct paths
      expect(staticFiles[0].path).toBe('public/index.html');
      expect(staticFiles[1].path).toBe('public/404.html');
      expect(staticFiles[2].path).toBe('public/js/app.js');
    });
  });
});
