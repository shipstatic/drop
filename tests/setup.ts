/**
 * Global test setup for @shipstatic/drop
 * Runs before all tests to configure mocks and environment
 */

import { expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test (React Testing Library)
afterEach(() => {
  cleanup();
});

/**
 * Global console mocking
 *
 * By default, suppress console output to keep test output clean.
 * Tests that need to verify console calls should use:
 *   const spy = vi.spyOn(console, 'warn');
 *   // ... test ...
 *   expect(spy).toHaveBeenCalledWith(...);
 *
 * The spy will work because we're mocking with vi.fn(), not completely replacing.
 */
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Mock crypto.randomUUID if not available in test environment
if (typeof crypto === 'undefined' || !crypto.randomUUID) {
  global.crypto = {
    ...global.crypto,
    randomUUID: () => Math.random().toString(36).substring(2, 15),
  } as Crypto;
}

/**
 * File API mocking for test environment
 *
 * Most tests use mock files created with createMockFile() from test-utils.ts.
 * These use _testContent property to provide content without actual file I/O.
 *
 * For tests that need REAL file I/O (like real-zip-extraction.test.ts),
 * use the exported nativeFileArrayBuffer/nativeFileText functions.
 */

// Store native implementations BEFORE mocking (for tests that need real file I/O)
const _nativeBlobArrayBuffer = typeof Blob !== 'undefined' ? Blob.prototype.arrayBuffer : null;
const _nativeBlobText = typeof Blob !== 'undefined' ? Blob.prototype.text : null;

/**
 * Read a File using native (non-mocked) Blob implementation.
 * Use this in integration tests that work with real file buffers.
 */
export async function nativeFileArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (_nativeBlobArrayBuffer) {
    return _nativeBlobArrayBuffer.call(file);
  }
  // Fallback for environments without native Blob.arrayBuffer
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Read a File's text using native (non-mocked) Blob implementation.
 */
export async function nativeFileText(file: File): Promise<string> {
  if (_nativeBlobText) {
    return _nativeBlobText.call(file);
  }
  // Fallback using arrayBuffer
  const buffer = await nativeFileArrayBuffer(file);
  return new TextDecoder().decode(buffer);
}

// Ensure File API is available and functional in jsdom
if (typeof File !== 'undefined') {
  // Override File.prototype.arrayBuffer to use _testContent for mock files
  // This ensures consistent mocking behavior across unit tests
  // _testContent === null signals a read error should be thrown
  // Files WITHOUT _testContent property use native implementation
  File.prototype.arrayBuffer = async function (this: File & { _testContent?: string | null }) {
    // If this file has _testContent property, use the mock behavior
    if ('_testContent' in this) {
      if (this._testContent === null) {
        throw new Error('Mocked file read error');
      }
      const content = this._testContent || '';
      return new TextEncoder().encode(content).buffer;
    }
    // Otherwise, use native implementation (for real files)
    return nativeFileArrayBuffer(this);
  };

  // Override File.prototype.text to work with our arrayBuffer mock
  File.prototype.text = async function (this: File & { _testContent?: string | null }) {
    // If this file has _testContent property, use the mock behavior
    if ('_testContent' in this) {
      if (this._testContent === null) {
        throw new Error('Mocked file read error');
      }
      return this._testContent || '';
    }
    // Otherwise, use native implementation (for real files)
    return nativeFileText(this);
  };
}
