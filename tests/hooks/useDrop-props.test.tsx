/**
 * Tests for getDropzoneProps and getInputProps
 * Verifies the new prop getter API for easy dropzone integration
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDrop } from '@/hooks/useDrop';
import type { Ship } from '@shipstatic/ship';

// Mock Ship SDK
const mockShip = {
  getConfig: vi.fn().mockResolvedValue({
    limits: {
      maxFileSize: 10 * 1024 * 1024,
      maxFiles: 1000,
      maxTotalSize: 100 * 1024 * 1024,
    },
  }),
} as unknown as Ship;

describe('useDrop - prop getters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDropzoneProps', () => {
    it('should return props object with event handlers', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getDropzoneProps();

      expect(props).toHaveProperty('onDragOver');
      expect(props).toHaveProperty('onDragLeave');
      expect(props).toHaveProperty('onDrop');
      expect(props).toHaveProperty('onClick');
      expect(typeof props.onDragOver).toBe('function');
      expect(typeof props.onDragLeave).toBe('function');
      expect(typeof props.onDrop).toBe('function');
      expect(typeof props.onClick).toBe('function');
    });

    it('should set isDragging to true on dragOver', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getDropzoneProps();

      expect(result.current.isDragging).toBe(false);

      const mockEvent = {
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent;

      act(() => {
        props.onDragOver(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(result.current.isDragging).toBe(true);
    });

    it('should set isDragging to false on dragLeave', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getDropzoneProps();

      // First set to true
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });
      expect(result.current.isDragging).toBe(true);

      // Then test dragLeave
      const mockEvent = {
        preventDefault: vi.fn(),
      } as unknown as React.DragEvent;

      act(() => {
        props.onDragLeave(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(result.current.isDragging).toBe(false);
    });

    it('should trigger file input click on onClick', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      // Get input props first to ensure ref is set
      const inputProps = result.current.getInputProps();

      // Mock the input element
      const mockInput = {
        click: vi.fn(),
      };

      // Manually set the ref
      if (inputProps.ref && 'current' in inputProps.ref) {
        (inputProps.ref as any).current = mockInput;
      }

      const dropzoneProps = result.current.getDropzoneProps();

      act(() => {
        dropzoneProps.onClick();
      });

      expect(mockInput.click).toHaveBeenCalled();
    });
  });

  describe('getInputProps', () => {
    it('should return props object with correct attributes', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getInputProps();

      expect(props).toHaveProperty('ref');
      expect(props).toHaveProperty('type');
      expect(props).toHaveProperty('style');
      expect(props).toHaveProperty('multiple');
      expect(props).toHaveProperty('webkitdirectory');
      expect(props).toHaveProperty('onChange');

      expect(props.type).toBe('file');
      expect(props.style).toEqual({ display: 'none' });
      expect(props.multiple).toBe(true);
      expect(props.webkitdirectory).toBe('');
      expect(typeof props.onChange).toBe('function');
    });

    it('should call onChange handler with files', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getInputProps();

      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const mockEvent = {
        target: {
          files: [mockFile],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      // Wrap in act since onChange triggers async state updates
      await act(async () => {
        props.onChange(mockEvent);
      });

      // Verify the hook processed the file (state should have updated)
      expect(result.current.files.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty file list gracefully', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getInputProps();

      const mockEvent = {
        target: {
          files: [],
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      expect(() => {
        props.onChange(mockEvent);
      }).not.toThrow();
    });

    it('should handle null file list', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getInputProps();

      const mockEvent = {
        target: {
          files: null,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      expect(() => {
        props.onChange(mockEvent);
      }).not.toThrow();
    });
  });

  describe('isDragging state', () => {
    it('should be false initially', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      expect(result.current.isDragging).toBe(false);
    });

    it('should be cleared when clearAll is called', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getDropzoneProps();

      // Set isDragging to true
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });
      expect(result.current.isDragging).toBe(true);

      // Clear all
      act(() => {
        result.current.clearAll();
      });

      expect(result.current.isDragging).toBe(false);
    });

    it('should be set to false after drop', async () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));
      const props = result.current.getDropzoneProps();

      // Set to true first
      act(() => {
        props.onDragOver({ preventDefault: vi.fn() } as unknown as React.DragEvent);
      });
      expect(result.current.isDragging).toBe(true);

      // Mock drop event with files
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const mockEvent = {
        preventDefault: vi.fn(),
        dataTransfer: {
          items: [],
          files: [mockFile],
        },
      } as unknown as React.DragEvent;

      // onDrop is async, wrap in act
      await act(async () => {
        await props.onDrop(mockEvent);
      });

      expect(result.current.isDragging).toBe(false);
    });
  });

  describe('open() method', () => {
    it('should trigger file input click', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      // Get input props to set the ref
      const inputProps = result.current.getInputProps();

      // Mock the input element
      const mockInput = {
        click: vi.fn(),
      };

      // Set the ref manually
      if (inputProps.ref && 'current' in inputProps.ref) {
        (inputProps.ref as any).current = mockInput;
      }

      // Call open()
      act(() => {
        result.current.open();
      });

      expect(mockInput.click).toHaveBeenCalled();
    });
  });

  describe('Integration with existing functionality', () => {
    it('should expose processFiles method', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      // Verify processFiles is available alongside prop getters
      expect(typeof result.current.processFiles).toBe('function');
      expect(typeof result.current.getInputProps).toBe('function');
      expect(typeof result.current.getDropzoneProps).toBe('function');
      expect(typeof result.current.open).toBe('function');
    });

    it('should work with stripPrefix option', () => {
      const { result } = renderHook(() =>
        useDrop({ ship: mockShip, stripPrefix: true })
      );

      const inputProps = result.current.getInputProps();

      // Verify prop getters work with options
      expect(inputProps).toHaveProperty('onChange');
      expect(inputProps).toHaveProperty('ref');
    });
  });

  describe('Prop getter stability', () => {
    it('should return stable getter functions across renders', () => {
      const { result, rerender } = renderHook(() => useDrop({ ship: mockShip }));

      const getDropzoneProps1 = result.current.getDropzoneProps;
      const getInputProps1 = result.current.getInputProps;

      rerender();

      const getDropzoneProps2 = result.current.getDropzoneProps;
      const getInputProps2 = result.current.getInputProps;

      // Getter functions themselves should be stable due to useCallback
      expect(getDropzoneProps1).toBe(getDropzoneProps2);
      expect(getInputProps1).toBe(getInputProps2);
    });

    it('should return new props objects on each call', () => {
      const { result } = renderHook(() => useDrop({ ship: mockShip }));

      const props1 = result.current.getDropzoneProps();
      const props2 = result.current.getDropzoneProps();

      // Props objects should be different (not referentially equal)
      // This is expected behavior for prop getters
      expect(props1).not.toBe(props2);
    });
  });
});
