/**
 * Comprehensive State Machine Transition Tests for useDrop
 *
 * Tests all valid and invalid state transitions to ensure correctness
 * and prevent regressions in the state machine logic.
 *
 * State Machine:
 * idle → dragging → idle (drag leave)
 * idle → processing → ready (success)
 * idle → processing → error (failed)
 * ready → dragging → ready (drag leave)
 * error → dragging → error (drag leave)
 * processing → processing (blocked - concurrent guard)
 *
 * Invalid transitions (should be blocked):
 * - processing → dragging (should stay processing)
 * - processing → idle (should complete or error)
 * - error → ready (requires reset)
 * - ready → error (requires new files)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDrop } from '@/hooks/useDrop';
import { FILE_STATUSES } from '@/types';
import { createMockFile } from '../test-utils';
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
    filterJunk: actual.filterJunk,
  };
});

vi.mock('jszip');

const createMockShip = (): Ship => ({
  getConfig: mockGetConfig,
} as any);

describe('State Machine - Comprehensive Transition Tests', () => {
  beforeEach(() => {
    mockGetConfig.mockResolvedValue({
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 500 * 1024 * 1024,
      maxFilesCount: 10000,
      allowedMimeTypes: ['text/', 'image/', 'application/'],
    });

    mockValidateFiles.mockImplementation((files) => ({
      files: files.map((f: any) => ({
        ...f,
        status: FILE_STATUSES.READY,
        statusMessage: 'Ready for upload'
      })),
      validFiles: files.map((f: any) => ({
        ...f,
        status: FILE_STATUSES.READY,
        statusMessage: 'Ready for upload'
      })),
      errors: [],
      warnings: [],
      canDeploy: true,
    }));
  });

  describe('Valid State Transitions', () => {
    describe('idle → dragging → idle', () => {
      it('should transition from idle to dragging on drag over', () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        expect(result.current.phase).toBe('idle');
        expect(result.current.isDragging).toBe(false);

        const props = result.current.getDropzoneProps();
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
        });

        expect(result.current.phase).toBe('dragging');
        expect(result.current.isDragging).toBe(true);
      });

      it('should transition from dragging back to idle on drag leave', () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        const props = result.current.getDropzoneProps();

        // Enter dragging
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
        });
        expect(result.current.phase).toBe('dragging');

        // Leave dragging
        act(() => {
          props.onDragLeave({ preventDefault: vi.fn() } as any);
        });
        expect(result.current.phase).toBe('idle');
        expect(result.current.isDragging).toBe(false);
      });

      it('should remain in dragging state on multiple drag over events', () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        const props = result.current.getDropzoneProps();

        // Multiple drag overs
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
          props.onDragOver({ preventDefault: vi.fn() } as any);
          props.onDragOver({ preventDefault: vi.fn() } as any);
        });

        expect(result.current.phase).toBe('dragging');
        expect(result.current.isDragging).toBe(true);
      });
    });

    describe('idle → processing → ready', () => {
      it('should transition from idle to processing when files are added', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        expect(result.current.phase).toBe('idle');

        const file = createMockFile('test.txt', 'content');

        // Start processing
        act(() => {
          result.current.processFiles([file]);
        });

        // Should immediately be in processing state
        expect(result.current.phase).toBe('processing');
        expect(result.current.isProcessing).toBe(true);
      });

      it('should transition from processing to ready on successful validation', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        const file = createMockFile('test.txt', 'content');

        await act(async () => {
          await result.current.processFiles([file]);
        });

        await waitFor(() => {
          expect(result.current.isProcessing).toBe(false);
        });

        expect(result.current.phase).toBe('ready');
        expect(result.current.files).toHaveLength(1);
        expect(result.current.validFiles).toHaveLength(1);
      });

      it('should set status message during processing state', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        const file = createMockFile('test.txt', 'content');

        act(() => {
          result.current.processFiles([file]);
        });

        expect(result.current.phase).toBe('processing');
        expect(result.current.status).not.toBeNull();
        expect(result.current.status?.title).toBe('Processing...');
      });
    });

    describe('idle → processing → error', () => {
      it('should transition from processing to error on validation failure', async () => {
        const ship = createMockShip();

        // Mock validation failure
        mockValidateFiles.mockImplementationOnce((files) => ({
          files: files.map((f: any) => ({
            ...f,
            status: FILE_STATUSES.VALIDATION_FAILED,
            statusMessage: 'File too large',
          })),
          validFiles: [],
          errors: [{
            file: 'big.txt',
            message: 'File too large',
          }],
          warnings: [],
          canDeploy: false,
        }));

        const { result } = renderHook(() => useDrop({ ship }));

        const file = createMockFile('big.txt', 'huge content');

        await act(async () => {
          await result.current.processFiles([file]);
        });

        await waitFor(() => {
          expect(result.current.isProcessing).toBe(false);
        });

        expect(result.current.phase).toBe('error');
        expect(result.current.hasError).toBe(true);
        expect(result.current.validFiles).toHaveLength(0);
      });

      it('should set error status with details on validation failure', async () => {
        const ship = createMockShip();

        mockValidateFiles.mockImplementationOnce((files) => ({
          files: files.map((f: any) => ({
            ...f,
            status: FILE_STATUSES.VALIDATION_FAILED,
            statusMessage: 'Invalid MIME type',
          })),
          validFiles: [],
          errors: [{
            file: 'bad.exe',
            message: 'Invalid MIME type',
          }],
          warnings: [],
          canDeploy: false,
        }));

        const { result } = renderHook(() => useDrop({ ship }));

        await act(async () => {
          await result.current.processFiles([createMockFile('bad.exe', 'content')]);
        });

        await waitFor(() => {
          expect(result.current.phase).toBe('error');
        });

        expect(result.current.status).not.toBeNull();
        expect(result.current.status?.title).toContain('Failed');
        expect(result.current.status?.errors).toBeDefined();
        expect(result.current.status?.errors?.length).toBeGreaterThan(0);
      });
    });

    describe('ready → dragging → ready', () => {
      it('should allow dragging from ready state', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // Get to ready state
        await act(async () => {
          await result.current.processFiles([createMockFile('test.txt', 'content')]);
        });

        await waitFor(() => {
          expect(result.current.phase).toBe('ready');
        });

        // Enter dragging from ready
        const props = result.current.getDropzoneProps();
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
        });

        expect(result.current.phase).toBe('dragging');
        expect(result.current.isDragging).toBe(true);
        expect(result.current.files).toHaveLength(1); // Files preserved
      });

      it('should return to ready state after drag leave', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // Get to ready state
        await act(async () => {
          await result.current.processFiles([createMockFile('test.txt', 'content')]);
        });

        await waitFor(() => {
          expect(result.current.phase).toBe('ready');
        });

        const props = result.current.getDropzoneProps();

        // Drag over and leave
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
          props.onDragLeave({ preventDefault: vi.fn() } as any);
        });

        expect(result.current.phase).toBe('ready');
        expect(result.current.isDragging).toBe(false);
        expect(result.current.files).toHaveLength(1); // Files preserved
      });
    });

    describe('error → dragging → error', () => {
      it('should allow dragging from error state', async () => {
        const ship = createMockShip();

        mockValidateFiles.mockImplementationOnce((files) => ({
          files: files.map((f: any) => ({
            ...f,
            status: FILE_STATUSES.VALIDATION_FAILED,
          })),
          validFiles: [],
          errors: [{ file: 'bad.txt', message: 'Error' }],
          warnings: [],
          canDeploy: false,
        }));

        const { result } = renderHook(() => useDrop({ ship }));

        // Get to error state
        await act(async () => {
          await result.current.processFiles([createMockFile('bad.txt', 'content')]);
        });

        await waitFor(() => {
          expect(result.current.phase).toBe('error');
        });

        // Enter dragging from error
        const props = result.current.getDropzoneProps();
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
        });

        expect(result.current.phase).toBe('dragging');
        expect(result.current.isDragging).toBe(true);
      });

      it('should return to error state after drag leave', async () => {
        const ship = createMockShip();

        mockValidateFiles.mockImplementationOnce((files) => ({
          files: files.map((f: any) => ({
            ...f,
            status: FILE_STATUSES.VALIDATION_FAILED,
          })),
          validFiles: [],
          errors: [{ file: 'bad.txt', message: 'Error' }],
          warnings: [],
          canDeploy: false,
        }));

        const { result } = renderHook(() => useDrop({ ship }));

        // Get to error state
        await act(async () => {
          await result.current.processFiles([createMockFile('bad.txt', 'content')]);
        });

        await waitFor(() => {
          expect(result.current.phase).toBe('error');
        });

        const props = result.current.getDropzoneProps();

        // Drag over and leave
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
          props.onDragLeave({ preventDefault: vi.fn() } as any);
        });

        expect(result.current.phase).toBe('error');
        expect(result.current.isDragging).toBe(false);
        expect(result.current.hasError).toBe(true);
      });
    });

    describe('any state → idle (via reset)', () => {
      it('should reset from ready state to idle', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // Get to ready state
        await act(async () => {
          await result.current.processFiles([createMockFile('test.txt', 'content')]);
        });

        await waitFor(() => {
          expect(result.current.phase).toBe('ready');
        });

        // Reset
        act(() => {
          result.current.reset();
        });

        expect(result.current.phase).toBe('idle');
        expect(result.current.files).toHaveLength(0);
        expect(result.current.status).toBeNull();
      });

      it('should reset from error state to idle', async () => {
        const ship = createMockShip();

        mockValidateFiles.mockImplementationOnce((files) => ({
          files: files.map((f: any) => ({
            ...f,
            status: FILE_STATUSES.VALIDATION_FAILED,
          })),
          validFiles: [],
          errors: [{ file: 'bad.txt', message: 'Error' }],
          warnings: [],
          canDeploy: false,
        }));

        const { result } = renderHook(() => useDrop({ ship }));

        // Get to error state
        await act(async () => {
          await result.current.processFiles([createMockFile('bad.txt', 'content')]);
        });

        await waitFor(() => {
          expect(result.current.phase).toBe('error');
        });

        // Reset
        act(() => {
          result.current.reset();
        });

        expect(result.current.phase).toBe('idle');
        expect(result.current.files).toHaveLength(0);
        expect(result.current.status).toBeNull();
        expect(result.current.hasError).toBe(false);
      });

      it('should reset from dragging state to idle', () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // Enter dragging
        const props = result.current.getDropzoneProps();
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
        });
        expect(result.current.phase).toBe('dragging');

        // Reset
        act(() => {
          result.current.reset();
        });

        expect(result.current.phase).toBe('idle');
        expect(result.current.isDragging).toBe(false);
      });
    });
  });

  describe('Invalid/Blocked State Transitions', () => {
    describe('Concurrent processing guard', () => {
      it('should block concurrent processFiles calls', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const file1 = createMockFile('file1.txt', 'content1');
        const file2 = createMockFile('file2.txt', 'content2');

        // Start first process (don't await)
        act(() => {
          result.current.processFiles([file1]);
        });

        expect(result.current.isProcessing).toBe(true);

        // Attempt concurrent process
        await act(async () => {
          await result.current.processFiles([file2]);
        });

        // Should have warned about concurrent call
        expect(consoleWarn).toHaveBeenCalledWith(
          expect.stringContaining('already in progress')
        );

        consoleWarn.mockRestore();
      });

      it('should allow processing after first process completes', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // First process
        await act(async () => {
          await result.current.processFiles([createMockFile('file1.txt', 'content1')]);
        });

        await waitFor(() => {
          expect(result.current.isProcessing).toBe(false);
        });

        expect(result.current.files).toHaveLength(1);

        // Second process (should work now)
        await act(async () => {
          await result.current.processFiles([createMockFile('file2.txt', 'content2')]);
        });

        await waitFor(() => {
          expect(result.current.isProcessing).toBe(false);
        });

        expect(result.current.files).toHaveLength(1); // Replaced, not added
        expect(result.current.files[0].name).toBe('file2.txt');
      });
    });

    describe('Drag over during processing', () => {
      it('should NOT transition to dragging when processing', async () => {
        let resolveConfig: any;
        const slowConfig = new Promise((resolve) => {
          resolveConfig = resolve;
        });

        mockGetConfig.mockImplementationOnce(() =>
          slowConfig.then(() => ({
            maxFileSize: 100 * 1024 * 1024,
            maxTotalSize: 500 * 1024 * 1024,
            maxFilesCount: 10000,
            allowedMimeTypes: ['text/', 'image/', 'application/'],
          }))
        );

        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        const file = createMockFile('test.txt', 'content');

        // Start processing (slow)
        act(() => {
          result.current.processFiles([file]);
        });

        expect(result.current.phase).toBe('processing');

        // Try to drag over while processing
        const props = result.current.getDropzoneProps();
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
        });

        // Should still be in processing state
        expect(result.current.phase).toBe('processing');
        expect(result.current.isDragging).toBe(false);
        expect(result.current.isInteractive).toBe(false);

        // Cleanup: resolve the slow config
        act(() => {
          resolveConfig();
        });
      });
    });

    describe('State preservation during drag', () => {
      it('should preserve files when dragging from ready state', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // Process files to ready state
        await act(async () => {
          await result.current.processFiles([
            createMockFile('file1.txt', 'content1'),
            createMockFile('file2.txt', 'content2'),
          ]);
        });

        await waitFor(() => {
          expect(result.current.phase).toBe('ready');
        });

        const filesBefore = result.current.files;
        const validFilesBefore = result.current.validFiles;

        // Drag over
        const props = result.current.getDropzoneProps();
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
        });

        expect(result.current.phase).toBe('dragging');
        expect(result.current.files).toEqual(filesBefore);
        expect(result.current.validFiles).toEqual(validFilesBefore);

        // Drag leave
        act(() => {
          props.onDragLeave({ preventDefault: vi.fn() } as any);
        });

        expect(result.current.phase).toBe('ready');
        expect(result.current.files).toEqual(filesBefore);
        expect(result.current.validFiles).toEqual(validFilesBefore);
      });

      it('should preserve error state when dragging from error', async () => {
        const ship = createMockShip();

        mockValidateFiles.mockImplementationOnce((files) => ({
          files: files.map((f: any) => ({
            ...f,
            status: FILE_STATUSES.VALIDATION_FAILED,
          })),
          validFiles: [],
          errors: [{ file: 'bad.txt', message: 'Error' }],
          warnings: [],
          canDeploy: false,
        }));

        const { result } = renderHook(() => useDrop({ ship }));

        // Get to error state
        await act(async () => {
          await result.current.processFiles([createMockFile('bad.txt', 'content')]);
        });

        await waitFor(() => {
          expect(result.current.phase).toBe('error');
        });

        const statusBefore = result.current.status;

        // Drag over and leave
        const props = result.current.getDropzoneProps();
        act(() => {
          props.onDragOver({ preventDefault: vi.fn() } as any);
          props.onDragLeave({ preventDefault: vi.fn() } as any);
        });

        expect(result.current.phase).toBe('error');
        expect(result.current.status).toEqual(statusBefore);
        expect(result.current.hasError).toBe(true);
      });
    });
  });

  describe('Convenience Booleans Consistency', () => {
    it('should have consistent isProcessing boolean', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      expect(result.current.isProcessing).toBe(false);
      expect(result.current.phase).toBe('idle');

      act(() => {
        result.current.processFiles([createMockFile('test.txt', 'content')]);
      });

      expect(result.current.isProcessing).toBe(true);
      expect(result.current.phase).toBe('processing');

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });

      expect(result.current.phase).toBe('ready');
    });

    it('should have consistent isDragging boolean', () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      expect(result.current.isDragging).toBe(false);

      const props = result.current.getDropzoneProps();
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as any);
      });

      expect(result.current.isDragging).toBe(true);
      expect(result.current.phase).toBe('dragging');

      act(() => {
        props.onDragLeave({ preventDefault: vi.fn() } as any);
      });

      expect(result.current.isDragging).toBe(false);
    });

    it('should have consistent hasError boolean', async () => {
      const ship = createMockShip();

      mockValidateFiles.mockImplementationOnce((files) => ({
        files: files.map((f: any) => ({
          ...f,
          status: FILE_STATUSES.VALIDATION_FAILED,
        })),
        validFiles: [],
        errors: [{ file: 'bad.txt', message: 'Error' }],
        warnings: [],
        canDeploy: false,
      }));

      const { result } = renderHook(() => useDrop({ ship }));

      expect(result.current.hasError).toBe(false);

      await act(async () => {
        await result.current.processFiles([createMockFile('bad.txt', 'content')]);
      });

      await waitFor(() => {
        expect(result.current.hasError).toBe(true);
      });

      expect(result.current.phase).toBe('error');

      act(() => {
        result.current.reset();
      });

      expect(result.current.hasError).toBe(false);
      expect(result.current.phase).toBe('idle');
    });

    it('should have consistent isInteractive boolean', async () => {
      const ship = createMockShip();
      const { result } = renderHook(() => useDrop({ ship }));

      // Idle - interactive
      expect(result.current.isInteractive).toBe(true);
      expect(result.current.phase).toBe('idle');

      // Dragging - interactive
      const props = result.current.getDropzoneProps();
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as any);
      });
      expect(result.current.isInteractive).toBe(true);
      expect(result.current.phase).toBe('dragging');

      // Back to idle
      act(() => {
        props.onDragLeave({ preventDefault: vi.fn() } as any);
      });

      // Processing - NOT interactive
      act(() => {
        result.current.processFiles([createMockFile('test.txt', 'content')]);
      });
      expect(result.current.isInteractive).toBe(false);
      expect(result.current.phase).toBe('processing');

      await waitFor(() => {
        expect(result.current.phase).toBe('ready');
      });

      // Ready - interactive
      expect(result.current.isInteractive).toBe(true);
    });
  });
});
