import { FileValidationStatus } from '@shipstatic/types';
import { describe, expect, it, vi } from 'vitest';
import {
  createMockDrop,
  createMockFileWithPath,
  createMockProcessedFile,
  mockUseDrop,
} from '../src/testing';
import type { DropReturn } from '../src/useDrop';

/**
 * The published `/testing` subpath — three functions, and nothing that duplicates
 * a test framework.
 *
 * Every assertion here is also a TYPE assertion, and is gated by `pnpm typecheck`
 * for a reason: this subpath's whole job is to be correct in a CONSUMER's
 * typechecked test file. A published helper whose declared type disagrees with
 * what it returns is unusable there, and only a typechecked suite catches it.
 *
 * Interactions are asserted with the consumer's own `vi.fn()`, passed through
 * `createMockDrop` overrides — which is why no spy vocabulary ships here.
 */
describe('createMockDrop', () => {
  it('is a complete DropReturn with no arguments', () => {
    const drop: DropReturn = createMockDrop();

    expect(drop.phase).toBe('idle');
    expect(drop.isDragging).toBe(false);
    expect(drop.isProcessing).toBe(false);
    expect(drop.isInteractive).toBe(true);
    expect(drop.hasError).toBe(false);
    expect(drop.files).toEqual([]);
    expect(drop.validFiles).toEqual([]);
    expect(drop.sourceName).toBe('');
    expect(drop.status).toBeNull();
    expect(drop.needsBuild).toBe(false);
    expect(typeof drop.getDropzoneProps).toBe('function');
    expect(typeof drop.getInputProps).toBe('function');
    expect(typeof drop.open).toBe('function');
    expect(typeof drop.processFiles).toBe('function');
    expect(typeof drop.reset).toBe('function');
    expect(typeof drop.getFilesForUpload).toBe('function');
  });

  it('derives the convenience booleans from the phase', () => {
    expect(createMockDrop({ phase: 'processing' }).isProcessing).toBe(true);
    expect(createMockDrop({ phase: 'error' }).hasError).toBe(true);
    expect(createMockDrop({ phase: 'ready' }).isInteractive).toBe(true);
    expect(createMockDrop({ phase: 'processing' }).isInteractive).toBe(false);
    expect(createMockDrop({ phase: 'error' }).isInteractive).toBe(false);
  });

  it('derives validFiles from files', () => {
    const drop = createMockDrop({
      files: [
        createMockProcessedFile('index.html'),
        createMockProcessedFile('bad.exe', { status: FileValidationStatus.VALIDATION_FAILED }),
      ],
    });

    expect(drop.files).toHaveLength(2);
    expect(drop.validFiles.map((f) => f.name)).toEqual(['index.html']);
    expect(drop.getFilesForUpload()).toHaveLength(1);
  });

  it('takes isDragging independently of the phase', () => {
    const drop = createMockDrop({ phase: 'ready', isDragging: true });

    expect(drop.phase).toBe('ready');
    expect(drop.isDragging).toBe(true);
    expect(drop.isInteractive).toBe(true);
  });

  it('accepts the consumer’s own spies for any action', () => {
    // This is the whole interaction story: no bespoke spy vocabulary, just the
    // caller's `vi.fn()` with the caller's own matchers.
    const reset = vi.fn();
    const open = vi.fn();
    const processFiles = vi.fn();
    const drop = createMockDrop({ phase: 'ready', reset, open, processFiles });

    drop.reset();
    drop.open();
    drop.processFiles([]);

    expect(reset).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    expect(processFiles).toHaveBeenCalledWith([]);
  });

  it('lets an explicit override beat every derivation', () => {
    const drop = createMockDrop({
      phase: 'error',
      // A component might be handed a deliberately inconsistent state to check
      // that it renders defensively.
      isInteractive: true,
      validFiles: [createMockProcessedFile('index.html')],
    });

    expect(drop.hasError).toBe(true);
    expect(drop.isInteractive).toBe(true);
    expect(drop.validFiles).toHaveLength(1);
  });

  it('passes through sourceName, status and needsBuild', () => {
    const status = { title: 'Ready', details: '3 files ready' };
    const drop = createMockDrop({ sourceName: 'dist', status, needsBuild: true });

    expect(drop.sourceName).toBe('dist');
    expect(drop.status).toBe(status);
    expect(drop.needsBuild).toBe(true);
  });

  it('returns spreadable prop objects', () => {
    const drop = createMockDrop();

    expect(drop.getDropzoneProps().onClick).toBeDefined();
    expect(drop.getDropzoneProps({ clickable: false }).onClick).toBeUndefined();
    expect(drop.getInputProps().webkitdirectory).toBe('');
  });

  it('every default action and handler is callable without throwing', () => {
    // Consumers spread these onto real elements and React invokes them, so
    // "present" is not enough — a mock whose handlers throw is worse than none.
    const drop = createMockDrop();
    const dropzone = drop.getDropzoneProps();
    const event = {} as never;

    expect(() => dropzone.onDragOver(event)).not.toThrow();
    expect(() => dropzone.onDragLeave(event)).not.toThrow();
    expect(() => dropzone.onDrop(event)).not.toThrow();
    expect(() => dropzone.onClick?.()).not.toThrow();
    expect(() => drop.getInputProps().onChange(event)).not.toThrow();
    expect(() => drop.open()).not.toThrow();
    expect(() => drop.reset()).not.toThrow();
    expect(drop.getFilesForUpload()).toEqual([]);
  });

  it('resolves the default processFiles', async () => {
    await expect(createMockDrop().processFiles([])).resolves.toBeUndefined();
  });
});

describe('createMockProcessedFile', () => {
  it('builds a ready file backed by a real File', () => {
    const processed = createMockProcessedFile('index.html');

    expect(processed.name).toBe('index.html');
    expect(processed.path).toBe('index.html');
    expect(processed.status).toBe(FileValidationStatus.READY);
    expect(processed.file).toBeInstanceOf(File);
    expect(processed.size).toBeGreaterThan(0);
  });

  it('accepts overrides', () => {
    const processed = createMockProcessedFile('app.css', {
      path: 'css/app.css',
      content: 'body{}',
      type: 'text/css',
      status: FileValidationStatus.EXCLUDED,
      statusMessage: 'empty',
    });

    expect(processed.path).toBe('css/app.css');
    expect(processed.type).toBe('text/css');
    expect(processed.status).toBe(FileValidationStatus.EXCLUDED);
    expect(processed.statusMessage).toBe('empty');
    expect(processed.size).toBe(6);
  });

  it('gives distinct ids', () => {
    const ids = ['a', 'b', 'c'].map((n) => createMockProcessedFile(n).id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('createMockFileWithPath', () => {
  it('builds a real File carrying a folder-relative path', async () => {
    const file = createMockFileWithPath('index.html', 'dist/index.html', '<html>', 'text/html');

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('index.html');
    expect(file.webkitRelativePath).toBe('dist/index.html');
    expect(file.type).toBe('text/html');
    await expect(file.text()).resolves.toBe('<html>');
  });
});

describe('mockUseDrop', () => {
  it('returns a useDrop replacement built from createMockDrop', () => {
    const useDrop = mockUseDrop({ phase: 'ready', sourceName: 'dist' });
    const drop = useDrop();

    expect(drop.phase).toBe('ready');
    expect(drop.sourceName).toBe('dist');
    // A complete DropReturn, so the mock cannot describe a hook drop does not have
    expect(typeof drop.getDropzoneProps).toBe('function');
    expect(typeof drop.getFilesForUpload).toBe('function');
  });

  it('takes no arguments and still yields a usable idle hook', () => {
    expect(mockUseDrop()().phase).toBe('idle');
  });

  it('returns a fresh object per call, so tests cannot leak state', () => {
    const useDrop = mockUseDrop({ phase: 'ready' });
    expect(useDrop()).not.toBe(useDrop());
  });
});
