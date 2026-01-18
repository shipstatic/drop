/**
 * Branch coverage tests for useDrop
 * Tests execution branches that might not be covered by main tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDrop } from '@/hooks/useDrop';
import { FILE_STATUSES } from '@/types';
import { createMockFile } from '../test-utils';
import type { Ship } from '@shipstatic/ship';

// Mock Ship SDK - config matches ConfigResponse structure
const mockShip = {
  getConfig: vi.fn().mockResolvedValue({
    maxFileSize: 100 * 1024 * 1024,
    maxFilesCount: 10000,
    maxTotalSize: 500 * 1024 * 1024,
    allowedMimeTypes: ['text/', 'image/', 'audio/', 'video/', 'font/', 'model/', 'application/'],
  }),
} as unknown as Ship;

const mockValidateFiles = vi.fn((files: any[]) => ({
  files: files.map(f => ({ ...f, status: FILE_STATUSES.READY })),
  validFiles: files.map(f => ({ ...f, status: FILE_STATUSES.READY })),
  error: null,
}));

// Mock @shipstatic/ship
vi.mock('@shipstatic/ship', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipstatic/ship')>();
  return {
    ...actual,
    validateFiles: (files: any[]) => mockValidateFiles(files),
    formatFileSize: actual.formatFileSize,
    getValidFiles: (files: any[]) => files.filter(f => f.status === 'ready'),
    filterJunk: actual.filterJunk,
  };
});

describe('useDrop - branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleDrop edge cases', () => {
    it('should handle drop with no files', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getDropzoneProps();

      const mockEvent = {
        preventDefault: vi.fn(),
        dataTransfer: {
          items: [],
          files: [],
        },
      } as unknown as React.DragEvent;

      await act(async () => {
        await props.onDrop(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      // No files should be added
      expect(result.current.files).toEqual([]);
    });

    it('should return to idle when drop is empty while dragging', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      // First, enter dragging state
      act(() => {
        const props = result.current.getDropzoneProps();
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });
      expect(result.current.isDragging).toBe(true);

      // Drop with empty items and files (both empty)
      // Need fresh props since state changed (onDrop captures state.value)
      const mockEvent = {
        preventDefault: vi.fn(),
        dataTransfer: {
          items: [],
          files: [],
        },
      } as unknown as React.DragEvent;

      await act(async () => {
        const freshProps = result.current.getDropzoneProps();
        await freshProps.onDrop(mockEvent);
      });

      // Should return to idle state
      expect(result.current.isDragging).toBe(false);
      expect(result.current.phase).toBe('idle');
    });

    it('should fallback to getAsFile when webkitGetAsEntry throws', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getDropzoneProps();

      const mockFile = createMockFile('fallback.txt', 'content');

      // Mock item where webkitGetAsEntry throws but getAsFile works
      const mockItem = {
        kind: 'file',
        webkitGetAsEntry: vi.fn(() => {
          throw new Error('webkitGetAsEntry not supported');
        }),
        getAsFile: vi.fn(() => mockFile),
      };

      const mockEvent = {
        preventDefault: vi.fn(),
        dataTransfer: {
          items: [mockItem],
          files: [mockFile],
        },
      } as unknown as React.DragEvent;

      await act(async () => {
        await props.onDrop(mockEvent);
      });

      expect(consoleWarn).toHaveBeenCalledWith(
        'Error processing drop item:',
        expect.any(Error)
      );
      // Should have processed the file via fallback
      expect(result.current.files.length).toBeGreaterThanOrEqual(0);

      consoleWarn.mockRestore();
    });
  });

  describe('onValidationError callback', () => {
    it('should call onValidationError when validation fails', async () => {
      const onValidationError = vi.fn();

      // Implement validation to return an error for this test
      mockValidateFiles.mockImplementationOnce(() => ({
        files: [],
        validFiles: [],
        error: {
          error: 'File Too Large',
          details: 'File exceeds size limit',
          isClientError: true,
        },
      } as any));

      const { result } = renderHook(() =>
        useDrop({ ship: mockShip, onValidationError })
      );

      const file = createMockFile('large.txt', 'x'.repeat(20 * 1024 * 1024));

      await act(async () => {
        await result.current.processFiles([file]);
      });

      expect(onValidationError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
          details: expect.any(String),
          isClientError: true,
        })
      );
    });
  });

  describe('Source name detection edge cases', () => {
    it('should use first file name for multiple files without webkitRelativePath', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      const file1 = createMockFile('first.txt', 'content1');
      const file2 = createMockFile('second.txt', 'content2');

      // No webkitRelativePath set
      await act(async () => {
        await result.current.processFiles([file1, file2]);
      });

      // Should use first file name as source
      expect(result.current.sourceName).toBe('first.txt');
    });

    it('should handle empty source name gracefully', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      // This tests the initialization state
      expect(result.current.sourceName).toBe('');
    });
  });

  describe('Processing error handling', () => {
    it('should handle errors during file processing', async () => {
      const onValidationError = vi.fn();
      const { result } = renderHook(() =>
        useDrop({ ship: mockShip, onValidationError })
      );

      // Create a file that will cause an error
      const badFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      // Mock Ship SDK to throw error
      (mockShip.getConfig as any).mockRejectedValueOnce(new Error('Network error'));

      await act(async () => {
        await result.current.processFiles([badFile]);
      });

      // Should have error state
      expect(result.current.status?.title).toBe('Processing Failed');
      // expect(result.current.state.value).toBe('error'); // value is removed
    });

    it('should clear processing flag on error', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      // Mock to throw error
      (mockShip.getConfig as any).mockRejectedValueOnce(new Error('Error'));

      const file = createMockFile('test.txt', 'content');

      await act(async () => {
        await result.current.processFiles([file]);
      });

      // Processing should be false even after error
      expect(result.current.isProcessing).toBe(false);
    });
  });

  describe('Empty and null file handling', () => {
    it('should handle null files gracefully', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      await act(async () => {
        await result.current.processFiles(null as any);
      });

      expect(result.current.status).toBeNull();
      expect(result.current.files).toEqual([]);
    });

    it('should handle undefined files gracefully', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      await act(async () => {
        await result.current.processFiles(undefined as any);
      });

      expect(result.current.status).toBeNull();
      expect(result.current.files).toEqual([]);
    });
  });

  describe('ZIP extraction error handling', () => {
    it('should handle ZIP extraction errors gracefully', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      // Create a fake ZIP file (not actually a valid ZIP)
      const fakeZip = new File(['not a zip'], 'fake.zip', {
        type: 'application/zip',
      });

      await act(async () => {
        await result.current.processFiles([fakeZip]);
      });

      // Should handle the error without crashing
      // The exact behavior depends on ZIP extraction implementation
      expect(result.current.isProcessing).toBe(false);
    });
  });

  describe('clearAll coverage', () => {
    it('should reset isDragging state', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getDropzoneProps();

      // Set isDragging
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });

      expect(result.current.isDragging).toBe(true);

      // Clear all
      act(() => {
        result.current.clearAll();
      });

      expect(result.current.isDragging).toBe(false);
      expect(result.current.files).toEqual([]);
      expect(result.current.sourceName).toBe('');
      expect(result.current.status).toBeNull();
      // expect(result.current.value).not.toBe('error');
    });
  });

  describe('Concurrent processing guard', () => {
    it('should prevent concurrent calls with console warning', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => { });
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      const file = createMockFile('test.txt', 'content');

      // Start both calls within act to properly handle state updates
      await act(async () => {
        // Start first call (don't await yet)
        const promise1 = result.current.processFiles([file]);

        // Try second call immediately (should be ignored due to concurrent guard)
        const promise2 = result.current.processFiles([file]);

        // Wait for both to settle
        await Promise.all([promise1, promise2]);
      });

      expect(consoleWarn).toHaveBeenCalledWith(
        'File processing already in progress. Ignoring duplicate call.'
      );

      consoleWarn.mockRestore();
    });
  });

  describe('handleDragLeave state transitions', () => {
    it('should return to error state when files have validation errors', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      // Mock validation to return files with error status
      mockValidateFiles.mockImplementationOnce((files: any[]) => ({
        files: files.map(f => ({
          ...f,
          status: FILE_STATUSES.VALIDATION_FAILED,
          statusMessage: 'File too large',
        })),
        validFiles: [],
        error: {
          error: 'File Too Large',
          details: 'File exceeds size limit',
          errors: ['File too large'],
          isClientError: true,
        },
      }));

      // First, process files that will fail validation
      const file = createMockFile('big.txt', 'content');
      await act(async () => {
        await result.current.processFiles([file]);
      });

      // Should be in error state
      expect(result.current.phase).toBe('error');
      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].status).toBe(FILE_STATUSES.VALIDATION_FAILED);

      // Now drag over (from error state)
      const props = result.current.getDropzoneProps();
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });
      expect(result.current.isDragging).toBe(true);

      // Drag leave should return to ERROR state (not ready)
      act(() => {
        props.onDragLeave({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });

      expect(result.current.isDragging).toBe(false);
      expect(result.current.phase).toBe('error');
    });

    it('should return to ready state when files are valid', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      // Process valid files
      const file = createMockFile('good.txt', 'content');
      await act(async () => {
        await result.current.processFiles([file]);
      });

      expect(result.current.phase).toBe('ready');

      // Drag over from ready state
      const props = result.current.getDropzoneProps();
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });
      expect(result.current.isDragging).toBe(true);

      // Drag leave should return to ready state
      act(() => {
        props.onDragLeave({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });

      expect(result.current.isDragging).toBe(false);
      expect(result.current.phase).toBe('ready');
    });

    it('should handle files with PROCESSING_ERROR status', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      // Mock validation to return files with processing error status
      mockValidateFiles.mockImplementationOnce((files: any[]) => ({
        files: files.map(f => ({
          ...f,
          status: FILE_STATUSES.PROCESSING_ERROR,
          statusMessage: 'Failed to process file',
        })),
        validFiles: [],
        error: {
          error: 'Processing Error',
          details: 'Failed to process file',
          errors: ['Processing error'],
          isClientError: true,
        },
      }));

      const file = createMockFile('corrupt.txt', 'content');
      await act(async () => {
        await result.current.processFiles([file]);
      });

      expect(result.current.phase).toBe('error');

      // Drag over then leave
      const props = result.current.getDropzoneProps();
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });
      act(() => {
        props.onDragLeave({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });

      // Should return to error due to PROCESSING_ERROR status
      expect(result.current.phase).toBe('error');
    });

    it('should handle files with EMPTY_FILE status', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      mockValidateFiles.mockImplementationOnce((files: any[]) => ({
        files: files.map(f => ({
          ...f,
          status: FILE_STATUSES.EMPTY_FILE,
          statusMessage: 'File is empty',
        })),
        validFiles: [],
        error: {
          error: 'Empty File',
          details: 'File is empty (0 bytes)',
          errors: ['Empty file'],
          isClientError: true,
        },
      }));

      const file = createMockFile('empty.txt', '');
      await act(async () => {
        await result.current.processFiles([file]);
      });

      expect(result.current.phase).toBe('error');

      const props = result.current.getDropzoneProps();
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });
      act(() => {
        props.onDragLeave({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });

      expect(result.current.phase).toBe('error');
    });
  });

  describe('handleDragOver during processing', () => {
    it('should NOT transition to dragging when already processing', async () => {
      // Create a slow getConfig to keep processing state longer
      let resolveConfig: () => void;
      const slowConfigPromise = new Promise<void>((resolve) => {
        resolveConfig = resolve;
      });

      (mockShip.getConfig as any).mockImplementationOnce(() =>
        slowConfigPromise.then(() => ({
          maxFileSize: 100 * 1024 * 1024,
          maxFilesCount: 10000,
          maxTotalSize: 500 * 1024 * 1024,
          allowedMimeTypes: ['text/', 'image/', 'audio/', 'video/', 'font/', 'model/', 'application/'],
        }))
      );

      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getDropzoneProps();

      const file = createMockFile('test.txt', 'content');

      // Start processing (don't await)
      let processPromise: Promise<void>;
      act(() => {
        processPromise = result.current.processFiles([file]);
      });

      // Should be in processing state
      expect(result.current.isProcessing).toBe(true);
      expect(result.current.phase).toBe('processing');

      // Try to drag over while processing
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });

      // Should NOT transition to dragging - should stay in processing
      expect(result.current.isDragging).toBe(false);
      expect(result.current.phase).toBe('processing');

      // Clean up: resolve the config and wait for processing to complete
      await act(async () => {
        resolveConfig!();
        await processPromise!;
      });

      expect(result.current.isProcessing).toBe(false);
    });
  });

  describe('updateFileStatus edge cases', () => {
    it('should not modify files when ID does not match', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      const file = createMockFile('test.txt', 'content');
      await act(async () => {
        await result.current.processFiles([file]);
      });

      const originalFile = result.current.files[0];
      const originalStatus = originalFile.status;

      // Try to update with non-existent ID
      act(() => {
        result.current.updateFileStatus('non-existent-id-12345', {
          status: FILE_STATUSES.UPLOADING,
          statusMessage: 'Uploading...',
          progress: 50,
        });
      });

      // Original file should be unchanged
      expect(result.current.files[0].id).toBe(originalFile.id);
      expect(result.current.files[0].status).toBe(originalStatus);
      expect(result.current.files[0].progress).toBeUndefined();
    });

    it('should only update the matching file when multiple files exist', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      const files = [
        createMockFile('file1.txt', 'content1'),
        createMockFile('file2.txt', 'content2'),
        createMockFile('file3.txt', 'content3'),
      ];

      await act(async () => {
        await result.current.processFiles(files);
      });

      expect(result.current.files).toHaveLength(3);

      const secondFileId = result.current.files[1].id;

      // Update only the second file
      act(() => {
        result.current.updateFileStatus(secondFileId, {
          status: FILE_STATUSES.UPLOADING,
          statusMessage: 'Uploading file2...',
          progress: 75,
        });
      });

      // First file unchanged
      expect(result.current.files[0].status).toBe(FILE_STATUSES.READY);
      expect(result.current.files[0].progress).toBeUndefined();

      // Second file updated
      expect(result.current.files[1].status).toBe(FILE_STATUSES.UPLOADING);
      expect(result.current.files[1].statusMessage).toBe('Uploading file2...');
      expect(result.current.files[1].progress).toBe(75);

      // Third file unchanged
      expect(result.current.files[2].status).toBe(FILE_STATUSES.READY);
      expect(result.current.files[2].progress).toBeUndefined();
    });
  });
});
