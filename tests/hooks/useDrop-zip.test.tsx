/**
 * useDrop ZIP File Handling Tests
 *
 * Tests for ZIP file behavior in useDrop:
 * - Single ZIP extraction
 * - Multiple files with ZIP (no extraction)
 * - Multiple ZIPs (no extraction)
 *
 * For actual ZIP extraction logic tests, see tests/utils/zipExtractor.test.ts
 * and tests/integration/real-zip-extraction.test.ts
 *
 * Split from useDrop.test.ts for maintainability.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDrop } from '@/hooks/useDrop';
import { FILE_STATUSES } from '@/types';
import { createMockFile, DEFAULT_TEST_CONFIG } from '../test-utils';
import type { Ship } from '@shipstatic/ship';

// Mock @shipstatic/ship
const mockGetConfig = vi.fn();
const mockValidateFiles = vi.fn();

vi.mock('@shipstatic/ship', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipstatic/ship')>();
  return {
    ...actual,
    validateFiles: (...args: any[]) => mockValidateFiles(...args),
    getValidFiles: actual.getValidFiles,
    formatFileSize: actual.formatFileSize,
    filterJunk: actual.filterJunk,
  };
});

// Mock JSZip for unit tests
vi.mock('jszip');

// Helper to create mock Ship instance
const createMockShip = (): Ship => ({
  getConfig: mockGetConfig,
} as any);

describe('useDrop - ZIP File Handling', () => {
  beforeEach(() => {
    mockGetConfig.mockResolvedValue(DEFAULT_TEST_CONFIG);

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

  it('should strip folder prefix from extracted ZIP contents (e.g., dist/ folder)', async () => {
    /**
     * End-to-end test for common scenario:
     * User drops a ZIP like "site.zip" containing:
     *   dist/index.html
     *   dist/assets/app.js
     *   dist/assets/style.css
     *
     * After extraction + stripPrefix (default), paths should be:
     *   index.html
     *   assets/app.js
     *   assets/style.css
     */
    const ship = createMockShip();
    const { result } = renderHook(() => useDrop({ ship })); // stripPrefix=true by default

    // Mock extractZipToFiles to return files with dist/ prefix
    const extractSpy = vi.spyOn(await import('@/utils/zipExtractor'), 'extractZipToFiles');
    extractSpy.mockResolvedValue({
      files: [
        new File(['html'], 'dist/index.html', { type: 'text/html' }),
        new File(['js'], 'dist/assets/app.js', { type: 'application/javascript' }),
        new File(['css'], 'dist/assets/style.css', { type: 'text/css' }),
      ],
      errors: [],
    });

    // Drop a single ZIP file
    const zipFile = createMockFile('site.zip', 'zip content', 'application/zip');

    await act(async () => {
      await result.current.processFiles([zipFile]);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    // Verify extraction was called
    expect(extractSpy).toHaveBeenCalledWith(zipFile);

    // Verify files have stripped paths (dist/ prefix removed)
    expect(result.current.files).toHaveLength(3);
    expect(result.current.files.map(f => f.path).sort()).toEqual([
      'assets/app.js',
      'assets/style.css',
      'index.html',
    ]);

    // Source name should be from ZIP filename
    expect(result.current.sourceName).toBe('site');

    extractSpy.mockRestore();
  });

  it('should preserve folder prefix when stripPrefix=false', async () => {
    /**
     * Verify that stripPrefix=false preserves the original folder structure
     */
    const ship = createMockShip();
    const { result } = renderHook(() => useDrop({ ship, stripPrefix: false }));

    // Mock extractZipToFiles to return files with dist/ prefix
    const extractSpy = vi.spyOn(await import('@/utils/zipExtractor'), 'extractZipToFiles');
    extractSpy.mockResolvedValue({
      files: [
        new File(['html'], 'dist/index.html', { type: 'text/html' }),
        new File(['js'], 'dist/assets/app.js', { type: 'application/javascript' }),
      ],
      errors: [],
    });

    const zipFile = createMockFile('site.zip', 'zip content', 'application/zip');

    await act(async () => {
      await result.current.processFiles([zipFile]);
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });

    // Verify files retain original paths (dist/ prefix preserved)
    expect(result.current.files).toHaveLength(2);
    expect(result.current.files.map(f => f.path).sort()).toEqual([
      'dist/assets/app.js',
      'dist/index.html',
    ]);

    extractSpy.mockRestore();
  });
});
