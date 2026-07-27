/**
 * The ONE fixture source.
 *
 * Two rules hold this file together:
 *
 * 1. **Files are real.** Every `File` here is a genuine platform `File` with
 *    genuine bytes, and every archive is packed by the real `fflate`. Nothing in
 *    this suite serves canned content in place of a byte.
 *
 * 2. **The entry-tree fake models the spec, not a convenient answer.** It is the
 *    one unavoidable fake here: a synthetic `DataTransfer` cannot produce real
 *    `webkitGetAsEntry()` directory entries in ANY browser, Chromium included, so
 *    directory traversal has no real-runtime tier available — see `dirEntry`.
 */
import type { Ship } from '@shipstatic/ship';
import type { PlatformLimits } from '@shipstatic/types';
import { strToU8, zipSync } from 'fflate';

// ============================================================================
// Platform limits
// ============================================================================

/**
 * Production free-plan limits. Mirrors `DEPLOYMENT` in
 * `cloudflare/api/src/lib/config.ts` and the SDK's `ACCOUNT_LIMITS.free`.
 */
export const PLATFORM_LIMITS: PlatformLimits = {
  maxFileSize: 20 * 1024 * 1024,
  maxFilesCount: 500,
  maxTotalSize: 50 * 1024 * 1024,
};

/** Generous limits for tests where caps are not the subject. */
export const GENEROUS_LIMITS: PlatformLimits = {
  maxFileSize: 100 * 1024 * 1024,
  maxFilesCount: 10_000,
  maxTotalSize: 500 * 1024 * 1024,
};

// ============================================================================
// Files — real bytes, no prototype patching
// ============================================================================

/** A real File with real bytes. */
export function file(name: string, content = 'test content', type = 'text/plain'): File {
  return new File([content], name, { type, lastModified: 0 });
}

/**
 * A real File carrying a folder-relative path, the way a browser presents a
 * folder drop or a `webkitdirectory` selection.
 */
export function fileAt(path: string, content = 'test content', type = 'text/plain'): File {
  const f = file(path.split('/').pop() || path, content, type);
  Object.defineProperty(f, 'webkitRelativePath', {
    value: path,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  return f;
}

/** A minimal built site: the entry point plus one asset. */
export function builtSite(prefix = ''): File[] {
  const at = (p: string) => (prefix ? `${prefix}/${p}` : p);
  return [
    fileAt(at('index.html'), '<html><body>hi</body></html>', 'text/html'),
    fileAt(at('app.js'), 'console.log(1)', 'text/javascript'),
  ];
}

/**
 * A REAL zip archive built from a path→content map.
 *
 * Real bytes, inflated by the real fflate — the suite never fakes an archive in a
 * package whose headline feature is reading one.
 */
export function zipOf(entries: Record<string, string>, name = 'my-site.zip'): File {
  const packed = zipSync(
    Object.fromEntries(Object.entries(entries).map(([path, body]) => [path, strToU8(body)])),
  );
  return new File([new Uint8Array(packed)], name, { type: 'application/zip' });
}

// ============================================================================
// Ship stub — the ONE collaborator a test cannot supply for real
// ============================================================================

/**
 * A Ship whose only reachable method is `getLimits()`.
 *
 * This is the suite's only stand-in for `@shipstatic/ship`, and it exists solely
 * because `getLimits()` is an HTTP call. `DropOptions.ship` is typed as
 * `Pick<Ship, 'getLimits'>`, so this needs no cast — the type says what drop
 * touches. Everything else drop uses from the SDK
 * — `validateFiles`, `filterJunk`, `optimizeDeployPaths`, `pluralize`,
 * `formatFileSize` — is a pure function and runs FOR REAL throughout this suite.
 * Faking a pure function is how a suite ends up asserting against a hand-written
 * twin that has silently drifted from the real thing.
 */
export function shipStub(limits: PlatformLimits = GENEROUS_LIMITS): Pick<Ship, 'getLimits'> {
  return { getLimits: async () => limits };
}

// ============================================================================
// FileSystemEntry tree — the recorded fake
// ============================================================================

/** Real Chromium returns at most this many entries per `readEntries` call. */
export const READ_ENTRIES_BATCH_SIZE = 100;

export interface EntrySpec {
  [name: string]: EntrySpec | string;
}

/** A `FileSystemFileEntry` that hands back a real File. */
export function fileEntry(name: string, content = 'test content'): FileSystemEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (onSuccess: (f: File) => void) => onSuccess(file(name, content)),
  } as unknown as FileSystemEntry;
}

/**
 * A `FileSystemDirectoryEntry` that reads like the real thing.
 *
 * Two spec behaviors are modeled deliberately, because a fake that skips them
 * hides real bugs:
 *
 * - **Batching.** `readEntries` yields at most 100 entries per call and signals
 *   the end with an EMPTY batch. A fake that returns everything in one call lets
 *   a single-call implementation pass while silently truncating every folder
 *   over 100 files in production.
 * - **Reader independence.** `createReader()` returns a FRESH cursor each call,
 *   so re-reading a directory works. The previous fake latched on a per-entry
 *   `hasBeenRead` boolean, so a second read of the same directory yielded
 *   nothing.
 */
export function dirEntry(name: string, children: FileSystemEntry[]): FileSystemEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let cursor = 0;
      return {
        readEntries: (onSuccess: (entries: FileSystemEntry[]) => void) => {
          const batch = children.slice(cursor, cursor + READ_ENTRIES_BATCH_SIZE);
          cursor += batch.length;
          onSuccess(batch);
        },
      };
    },
  } as unknown as FileSystemEntry;
}

/** Build an entry tree from a nested spec: `{ dist: { 'index.html': '<html>' } }`. */
export function entryTree(spec: EntrySpec): FileSystemEntry[] {
  return Object.entries(spec).map(([name, value]) =>
    typeof value === 'string' ? fileEntry(name, value) : dirEntry(name, entryTree(value)),
  );
}

/** A directory entry whose reader fails — an unreadable folder. */
export function unreadableDirEntry(name: string, message = 'permission denied'): FileSystemEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (_ok: unknown, onError?: (e: Error) => void) => onError?.(new Error(message)),
    }),
  } as unknown as FileSystemEntry;
}

/** A file entry whose `file()` callback fails — an unreadable file. */
export function unreadableFileEntry(name: string, message = 'read error'): FileSystemEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (_ok: unknown, onError?: (e: Error) => void) => onError?.(new Error(message)),
  } as unknown as FileSystemEntry;
}

// ============================================================================
// Drag & drop events
// ============================================================================

export interface ItemSpec {
  /** The entry `webkitGetAsEntry()` returns; null models a browser that has none */
  entry?: FileSystemEntry | null;
  /** The File `getAsFile()` returns */
  asFile?: File | null;
  /** Make `webkitGetAsEntry()` throw */
  throws?: boolean;
  /** Omit `webkitGetAsEntry` entirely — an older browser */
  noEntryApi?: boolean;
  kind?: string;
}

export function dataTransferItem(spec: ItemSpec): DataTransferItem {
  const { entry = null, asFile = null, throws = false, noEntryApi = false, kind = 'file' } = spec;
  return {
    kind,
    ...(noEntryApi
      ? {}
      : {
          webkitGetAsEntry: () => {
            if (throws) throw new Error('webkitGetAsEntry not supported');
            return entry;
          },
        }),
    getAsFile: () => asFile,
  } as unknown as DataTransferItem;
}

/** A React DragEvent carrying items and/or a plain file list. */
export function dropEvent(
  options: { items?: DataTransferItem[]; files?: File[] } = {},
): React.DragEvent {
  const { items = [], files = [] } = options;
  return {
    preventDefault: () => {},
    dataTransfer: { items, files },
  } as unknown as React.DragEvent;
}

/** A React ChangeEvent for the hidden file input, with a settable `value`. */
export function inputChangeEvent(files: File[]): React.ChangeEvent<HTMLInputElement> {
  let value = files.length > 0 ? `C:\\fakepath\\${files[0].name}` : '';
  return {
    target: {
      files,
      get value() {
        return value;
      },
      set value(next: string) {
        value = next;
      },
    },
  } as unknown as React.ChangeEvent<HTMLInputElement>;
}
