/**
 * Shared test utilities for creating mock data across all test files
 */
import { FILE_STATUSES, type ProcessedFile } from '../src/types';

/**
 * Creates a mock File object with arrayBuffer support for testing
 * Used for testing file processing logic
 *
 * Relies on the global File.prototype.arrayBuffer mock in tests/setup.ts
 * which reads from the _testContent property
 *
 * @param name - File name
 * @param content - File content (use null to simulate read error)
 * @param type - MIME type
 */
export const createMockFile = (
  name: string,
  content: string | null = 'test content',
  type: string = 'text/plain'
): File => {
  const file = new File([content || ''], name, { type, lastModified: Date.now() });
  // Signal to global mock: null content means throw error
  (file as any)._testContent = content;
  return file;
};

/**
 * Creates a mock File object with webkitRelativePath set
 * Used for testing folder structure preservation
 */
export const createMockFileWithPath = (
  name: string,
  webkitRelativePath: string,
  content: string = 'test content',
  type: string = 'text/plain'
): File => {
  const file = createMockFile(name, content, type);
  // Set webkitRelativePath (read-only property)
  Object.defineProperty(file, 'webkitRelativePath', {
    value: webkitRelativePath,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  return file;
};

/**
 * Creates a complete ProcessedFile object for component testing
 * Used for testing UI components that display processed files
 */
export const createMockProcessedFile = (
  overrides: Partial<ProcessedFile> = {}
): ProcessedFile => ({
  id: crypto.randomUUID(),
  file: new File(['content'], overrides.name || 'test.txt'),
  name: 'test.txt',
  path: 'test.txt',
  size: 1024,
  type: 'text/plain',
  lastModified: Date.now(),
  status: FILE_STATUSES.READY,
  md5: 'mocked-md5-hash',
  ...overrides,
});
