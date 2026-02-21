/**
 * Tests for @shipstatic/drop/testing utilities
 */

import { describe, it, expect } from 'vitest';
import {
  createMockDrop,
  createMockDropWithSpies,
  createMockProcessedFile,
  createMockFile,
  createMockFileWithPath,
  createMockErrorStatus,
  createMockProcessingStatus,
  createMockReadyStatus,
} from '../src/testing';

describe('createMockDrop', () => {
  it('returns default idle state', () => {
    const drop = createMockDrop();

    expect(drop.phase).toBe('idle');
    expect(drop.isProcessing).toBe(false);
    expect(drop.isDragging).toBe(false);
    expect(drop.isInteractive).toBe(true);
    expect(drop.hasError).toBe(false);
    expect(drop.files).toEqual([]);
    expect(drop.validFiles).toEqual([]);
    expect(drop.sourceName).toBe('');
    expect(drop.status).toBeNull();
  });

  it('returns processing state correctly', () => {
    const drop = createMockDrop({ phase: 'processing' });

    expect(drop.phase).toBe('processing');
    expect(drop.isProcessing).toBe(true);
    expect(drop.isInteractive).toBe(false);
  });

  it('returns dragging state correctly', () => {
    const drop = createMockDrop({ phase: 'dragging' });

    expect(drop.phase).toBe('dragging');
    expect(drop.isDragging).toBe(true);
    expect(drop.isInteractive).toBe(true);
  });

  it('returns error state correctly', () => {
    const drop = createMockDrop({ phase: 'error' });

    expect(drop.phase).toBe('error');
    expect(drop.hasError).toBe(true);
    expect(drop.isInteractive).toBe(false);
  });

  it('returns ready state correctly', () => {
    const mockFile = createMockProcessedFile('index.html');
    const drop = createMockDrop({
      phase: 'ready',
      files: [mockFile],
    });

    expect(drop.phase).toBe('ready');
    expect(drop.isInteractive).toBe(true);
    expect(drop.files).toHaveLength(1);
    expect(drop.validFiles).toHaveLength(1);
  });

  it('filters validFiles based on status', () => {
    const readyFile = createMockProcessedFile('ready.html');
    const failedFile = createMockProcessedFile('failed.html', {
      status: 'validation_failed',
    });

    const drop = createMockDrop({
      phase: 'ready',
      files: [readyFile, failedFile],
    });

    expect(drop.files).toHaveLength(2);
    expect(drop.validFiles).toHaveLength(1);
    expect(drop.validFiles[0].name).toBe('ready.html');
  });

  it('provides working getDropzoneProps', () => {
    const drop = createMockDrop();
    const props = drop.getDropzoneProps();

    expect(props.onDragOver).toBeInstanceOf(Function);
    expect(props.onDragLeave).toBeInstanceOf(Function);
    expect(props.onDrop).toBeInstanceOf(Function);
    expect(props.onClick).toBeInstanceOf(Function);
  });

  it('respects clickable option in getDropzoneProps', () => {
    const drop = createMockDrop();

    const propsWithClick = drop.getDropzoneProps();
    const propsWithoutClick = drop.getDropzoneProps({ clickable: false });

    expect(propsWithClick.onClick).toBeDefined();
    expect(propsWithoutClick.onClick).toBeUndefined();
  });

  it('provides working getInputProps', () => {
    const drop = createMockDrop();
    const props = drop.getInputProps();

    expect(props.type).toBe('file');
    expect(props.multiple).toBe(true);
    expect(props.style).toEqual({ display: 'none' });
    expect(props.onChange).toBeInstanceOf(Function);
  });

  it('provides getFilesForUpload helper', () => {
    const mockFile = createMockProcessedFile('index.html');
    const drop = createMockDrop({
      phase: 'ready',
      files: [mockFile],
    });

    const files = drop.getFilesForUpload();
    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].name).toBe('index.html');
  });

  it('includes sourceName when provided', () => {
    const drop = createMockDrop({ sourceName: 'my-folder.zip' });
    expect(drop.sourceName).toBe('my-folder.zip');
  });

  it('includes status when provided', () => {
    const status = createMockErrorStatus('Validation Failed', 'Test error');
    const drop = createMockDrop({ status });

    expect(drop.status).toEqual(status);
  });
});

describe('createMockDropWithSpies', () => {
  it('returns drop and spies objects', () => {
    const { drop, spies } = createMockDropWithSpies();

    expect(drop).toBeDefined();
    expect(spies).toBeDefined();
    expect(spies.open).toBeInstanceOf(Function);
    expect(spies.processFiles).toBeInstanceOf(Function);
    expect(spies.reset).toBeInstanceOf(Function);
    expect(spies.getFilesForUpload).toBeInstanceOf(Function);
  });

  it('tracks open calls', () => {
    const { drop, spies } = createMockDropWithSpies();

    expect(spies.open.toHaveBeenCalled()).toBe(false);
    drop.open();
    expect(spies.open.toHaveBeenCalled()).toBe(true);
    expect(spies.open.calls()).toBe(1);

    drop.open();
    expect(spies.open.calls()).toBe(2);
  });

  it('tracks reset calls', () => {
    const { drop, spies } = createMockDropWithSpies();

    expect(spies.reset.toHaveBeenCalled()).toBe(false);
    drop.reset();
    expect(spies.reset.toHaveBeenCalled()).toBe(true);
    expect(spies.reset.calls()).toBe(1);
  });

  it('tracks processFiles calls with arguments', async () => {
    const { drop, spies } = createMockDropWithSpies();
    const files = [createMockFile('test.html')];

    expect(spies.processFiles.toHaveBeenCalled()).toBe(false);
    await drop.processFiles(files);
    expect(spies.processFiles.toHaveBeenCalled()).toBe(true);
    expect(spies.processFiles.calls()).toHaveLength(1);
    expect(spies.processFiles.toHaveBeenCalledWith(files)).toBe(true);
  });
});

describe('createMockProcessedFile', () => {
  it('creates a ProcessedFile with defaults', () => {
    const file = createMockProcessedFile('index.html');

    expect(file.name).toBe('index.html');
    expect(file.path).toBe('index.html');
    expect(file.status).toBe('ready');
    expect(file.type).toBe('text/plain');
    expect(file.file).toBeInstanceOf(File);
    expect(file.id).toMatch(/^mock-file-\d+$/);
  });

  it('accepts custom path', () => {
    const file = createMockProcessedFile('index.html', {
      path: 'dist/index.html',
    });

    expect(file.name).toBe('index.html');
    expect(file.path).toBe('dist/index.html');
  });

  it('accepts custom content', () => {
    const file = createMockProcessedFile('index.html', {
      content: '<h1>Hello</h1>',
    });

    expect(file.size).toBe(14); // '<h1>Hello</h1>'.length
  });

  it('accepts custom type', () => {
    const file = createMockProcessedFile('index.html', {
      type: 'text/html',
    });

    expect(file.type).toBe('text/html');
  });

  it('accepts custom status', () => {
    const file = createMockProcessedFile('bad.exe', {
      status: 'validation_failed',
      statusMessage: 'File extension not allowed',
    });

    expect(file.status).toBe('validation_failed');
    expect(file.statusMessage).toBe('File extension not allowed');
  });

  it('generates unique ids', () => {
    const file1 = createMockProcessedFile('a.html');
    const file2 = createMockProcessedFile('b.html');

    expect(file1.id).not.toBe(file2.id);
  });
});

describe('createMockFile', () => {
  it('creates a File with defaults', () => {
    const file = createMockFile('test.txt');

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('test.txt');
    expect(file.type).toBe('text/plain');
    expect(file.size).toBe('test content'.length);
  });

  it('accepts custom content', () => {
    const file = createMockFile('data.json', '{"key": "value"}');

    expect(file.size).toBe('{"key": "value"}'.length);
  });

  it('accepts custom type', () => {
    const file = createMockFile('data.json', '{}', 'application/json');

    expect(file.type).toBe('application/json');
  });
});

describe('createMockFileWithPath', () => {
  it('creates a File with webkitRelativePath set', () => {
    const file = createMockFileWithPath(
      'index.html',
      'my-project/dist/index.html'
    );

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('index.html');
    expect(file.webkitRelativePath).toBe('my-project/dist/index.html');
  });

  it('webkitRelativePath is read-only', () => {
    const file = createMockFileWithPath(
      'index.html',
      'my-project/index.html'
    );

    // Should throw or be silently ignored in strict mode
    expect(() => {
      // @ts-expect-error - testing that the property is read-only
      file.webkitRelativePath = 'changed';
    }).toThrow();
  });
});

describe('createMockErrorStatus', () => {
  it('creates error status with defaults', () => {
    const status = createMockErrorStatus();

    expect(status.title).toBe('Validation Failed');
    expect(status.details).toBe('One or more files failed validation');
    expect(status.errors).toEqual([]);
  });

  it('accepts custom values', () => {
    const status = createMockErrorStatus(
      'Upload Failed',
      'Network error occurred',
      ['File too large', 'Connection timeout']
    );

    expect(status.title).toBe('Upload Failed');
    expect(status.details).toBe('Network error occurred');
    expect(status.errors).toEqual(['File too large', 'Connection timeout']);
  });
});

describe('createMockProcessingStatus', () => {
  it('creates processing status with defaults', () => {
    const status = createMockProcessingStatus();

    expect(status.title).toBe('Processing...');
    expect(status.details).toBe('Validating and preparing files.');
  });

  it('accepts custom values', () => {
    const status = createMockProcessingStatus(
      'Extracting ZIP...',
      'Please wait while we extract your files.'
    );

    expect(status.title).toBe('Extracting ZIP...');
    expect(status.details).toBe('Please wait while we extract your files.');
  });
});

describe('createMockReadyStatus', () => {
  it('creates ready status with file count', () => {
    const status = createMockReadyStatus(5);

    expect(status.title).toBe('Ready');
    expect(status.details).toBe('5 file(s) are ready.');
  });

  it('handles singular file count', () => {
    const status = createMockReadyStatus(1);

    expect(status.details).toBe('1 file(s) are ready.');
  });
});
