/**
 * Test utilities for consumers of `useDrop`.
 *
 * ```typescript
 * import { createMockDrop } from '@shipstatic/drop/testing';
 * ```
 *
 * The whole subpath exists for one reason: a `DropReturn` has twenty fields, and
 * a component test that takes `drop` as a prop should not have to build them.
 * Everything else — spying, matching, asserting — belongs to your test framework,
 * so this file deliberately ships none of it.
 */

import { FileValidationStatus, type FileValidationStatusType } from '@shipstatic/types';
import type { ProcessedFile } from './types';
import type { DropReturn, DropzonePropsOptions } from './useDrop';

const noop = () => {};

/**
 * Build a `DropReturn` for rendering tests.
 *
 * Any field can be overridden, including with your own spies — which is how you
 * assert on interactions:
 *
 * ```tsx
 * const reset = vi.fn();
 * const drop = createMockDrop({ phase: 'ready', files: [...], reset });
 *
 * render(<DeployDropArea drop={drop} />);
 * await userEvent.click(screen.getByText('Clear'));
 *
 * expect(reset).toHaveBeenCalled();
 * ```
 *
 * The convenience booleans (`isProcessing`, `hasError`, `isInteractive`) and
 * `validFiles` are derived from `phase` and `files` unless you override them, so
 * the mock can never present a state the real hook could not reach by accident.
 */
export function createMockDrop(overrides: Partial<DropReturn> = {}): DropReturn {
  const phase = overrides.phase ?? 'idle';
  const files = overrides.files ?? [];
  const validFiles =
    overrides.validFiles ?? files.filter((f) => f.status === FileValidationStatus.READY);

  return {
    phase,
    isProcessing: phase === 'processing',
    isDragging: false,
    isInteractive: phase === 'idle' || phase === 'ready',
    hasError: phase === 'error',
    files,
    sourceName: '',
    status: null,
    needsBuild: false,

    getDropzoneProps: (options?: DropzonePropsOptions) => ({
      onDragOver: noop,
      onDragLeave: noop,
      onDrop: noop,
      ...(options?.clickable !== false && { onClick: noop }),
    }),
    getInputProps: () => ({
      ref: { current: null },
      type: 'file' as const,
      style: { display: 'none' },
      multiple: true,
      webkitdirectory: '',
      onChange: noop,
    }),

    open: noop,
    processFiles: async () => {},
    reset: noop,

    validFiles,
    getFilesForUpload: () => validFiles.map((f) => f.file),

    // Explicit values win over every derivation above.
    ...overrides,
  };
}

let mockFileIdCounter = 0;

/** Build a `ProcessedFile` backed by a real `File`. */
export function createMockProcessedFile(
  name: string,
  options: {
    path?: string;
    content?: string;
    type?: string;
    status?: FileValidationStatusType;
    statusMessage?: string;
  } = {},
): ProcessedFile {
  const {
    path = name,
    content = 'test content',
    type = 'text/plain',
    status = FileValidationStatus.READY,
    statusMessage,
  } = options;

  const file = new File([content], name, { type });

  return {
    id: `mock-file-${++mockFileIdCounter}`,
    file,
    path,
    name,
    size: file.size,
    type,
    lastModified: file.lastModified,
    status,
    statusMessage,
  };
}

/**
 * Build a real `File` carrying a folder-relative path, the way a browser
 * presents a folder drop. (`webkitRelativePath` is read-only, hence the
 * redefinition — the one part of this that is not a one-liner.)
 */
export function createMockFileWithPath(
  name: string,
  webkitRelativePath: string,
  content = 'test content',
  type = 'text/plain',
): File {
  const file = new File([content], name, { type });
  Object.defineProperty(file, 'webkitRelativePath', {
    value: webkitRelativePath,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  return file;
}
