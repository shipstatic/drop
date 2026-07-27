import { FileValidationStatus } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import {
  applyStatus,
  createProcessedFile,
  filePath,
  setRelativePath,
  stripCommonPrefix,
} from '../src/files';
import {
  dirEntry,
  entryTree,
  file,
  fileAt,
  fileEntry,
  READ_ENTRIES_BATCH_SIZE,
  unreadableDirEntry,
  unreadableFileEntry,
} from './fixtures/builders';

describe('setRelativePath', () => {
  it('sets webkitRelativePath on a File', () => {
    const f = file('index.html');
    setRelativePath(f, 'dist/index.html');
    expect(f.webkitRelativePath).toBe('dist/index.html');
  });

  it('re-patches an already-patched path (configurable, not one-shot)', () => {
    const f = fileAt('dist/index.html');
    setRelativePath(f, 'index.html');
    expect(f.webkitRelativePath).toBe('index.html');
  });
});

describe('filePath', () => {
  it('prefers webkitRelativePath', () => {
    expect(filePath(fileAt('dist/app.js'))).toBe('dist/app.js');
  });

  it('falls back to the bare name when there is no relative path', () => {
    expect(filePath(file('app.js'))).toBe('app.js');
  });

  it('treats a whitespace-only relative path as absent', () => {
    const f = file('app.js');
    setRelativePath(f, '   ');
    expect(filePath(f)).toBe('app.js');
  });
});

describe('createProcessedFile', () => {
  it('derives path, display name and size from the File', () => {
    const processed = createProcessedFile(fileAt('assets/img/logo.png', 'bytes'));

    expect(processed.path).toBe('assets/img/logo.png');
    expect(processed.name).toBe('logo.png');
    expect(processed.size).toBe(5);
    expect(processed.status).toBe(FileValidationStatus.PENDING);
    expect(processed.id).toBeTruthy();
  });

  it('honours an explicit path override', () => {
    expect(createProcessedFile(file('a.txt'), { path: 'nested/a.txt' }).path).toBe('nested/a.txt');
  });

  it('reports the browser MIME type verbatim', () => {
    // The platform derives Content-Type server-side from the path, so this field
    // is UI metadata only — no MIME database is bundled to second-guess it.
    expect(createProcessedFile(file('s.css', 'x', 'text/css')).type).toBe('text/css');
    expect(createProcessedFile(file('app.map', 'x', '')).type).toBe('');
  });

  it('gives each file a distinct id', () => {
    const ids = [file('a'), file('b'), file('c')].map((f) => createProcessedFile(f).id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('stripCommonPrefix', () => {
  it('removes a shared root directory and re-derives the display name', () => {
    const result = stripCommonPrefix(
      [fileAt('dist/index.html'), fileAt('dist/css/app.css')].map((f) => createProcessedFile(f)),
    );

    expect(result.map((f) => f.path)).toEqual(['index.html', 'css/app.css']);
    expect(result.map((f) => f.name)).toEqual(['index.html', 'app.css']);
  });

  it('mutates the underlying File so the SDK reads the stripped path', () => {
    // Ship reads webkitRelativePath off the raw File objects, so the stripped
    // path has to land there too — this is the drop→SDK handoff.
    const files = [fileAt('site/index.html'), fileAt('site/app.js')];
    stripCommonPrefix(files.map((f) => createProcessedFile(f)));
    expect(files.map((f) => f.webkitRelativePath)).toEqual(['index.html', 'app.js']);
  });

  it('leaves paths alone when there is no common prefix', () => {
    const result = stripCommonPrefix(
      [fileAt('index.html'), fileAt('app.js')].map((f) => createProcessedFile(f)),
    );
    expect(result.map((f) => f.path)).toEqual(['index.html', 'app.js']);
  });

  it('returns the same array for an empty input', () => {
    const empty: ReturnType<typeof createProcessedFile>[] = [];
    expect(stripCommonPrefix(empty)).toBe(empty);
  });
});

describe('applyStatus', () => {
  it('stamps a status across the set without a message', () => {
    const files = [file('a'), file('b')].map((f) => createProcessedFile(f));
    const result = applyStatus(files, FileValidationStatus.READY);

    expect(result.every((f) => f.status === FileValidationStatus.READY)).toBe(true);
    expect(result.every((f) => !('statusMessage' in f))).toBe(true);
  });

  it('attaches a message when given one', () => {
    const result = applyStatus(
      [createProcessedFile(file('a'))],
      FileValidationStatus.VALIDATION_FAILED,
      'too big',
    );
    expect(result[0].statusMessage).toBe('too big');
  });

  it('does not mutate its input', () => {
    const files = [createProcessedFile(file('a'))];
    applyStatus(files, FileValidationStatus.READY);
    expect(files[0].status).toBe(FileValidationStatus.PENDING);
  });
});
