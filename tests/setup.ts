/**
 * Global test setup for @shipstatic/assets
 * Runs before all tests to configure mocks and environment
 */

import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test (React Testing Library)
afterEach(() => {
  cleanup();
});

// Mock crypto.randomUUID if not available in test environment
if (typeof crypto === 'undefined' || !crypto.randomUUID) {
  global.crypto = {
    ...global.crypto,
    randomUUID: () => Math.random().toString(36).substring(2, 15),
  } as Crypto;
}

// Ensure File API is available and functional in jsdom
if (typeof File !== 'undefined') {
  // Always override File.prototype.arrayBuffer to use _testContent
  // This ensures consistent mocking behavior across all tests
  // _testContent === null signals a read error should be thrown
  File.prototype.arrayBuffer = async function (this: File & { _testContent?: string | null }) {
    // Check for error signal (null content)
    if (this._testContent === null) {
      throw new Error('Mocked file read error');
    }
    const content = this._testContent || '';
    return new TextEncoder().encode(content).buffer;
  };

  // Override File.prototype.text to work with our arrayBuffer mock
  File.prototype.text = async function (this: File & { _testContent?: string | null }) {
    const buffer = await this.arrayBuffer();
    return new TextDecoder().decode(buffer);
  };
}

// Mock Blob.prototype.arrayBuffer if not present
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = async function () {
    const text = await this.text();
    return new TextEncoder().encode(text).buffer;
  };
}
