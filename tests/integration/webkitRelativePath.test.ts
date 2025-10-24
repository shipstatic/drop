/**
 * Integration tests for webkitRelativePath handling
 *
 * These tests document and verify correct path handling when files
 * have webkitRelativePath set (from folder drops).
 *
 * CRITICAL: These tests prevent path doubling bugs like "index.html/index.html"
 */
import { describe, it, expect } from 'vitest';
import { createProcessedFile, stripCommonPrefix } from '@/utils/fileProcessing';
import { createMockFile } from '../test-utils';

describe('webkitRelativePath handling', () => {
  describe('Path resolution priority', () => {
    it('should use webkitRelativePath when available', async () => {
      const file = createMockFile('test.txt', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: 'my-folder/test.txt',
        writable: false,
      });

      const processed = await createProcessedFile(file);

      expect(processed.path).toBe('my-folder/test.txt');
      expect(processed.name).toBe('test.txt');
    });

    it('should use file.name when webkitRelativePath is empty', async () => {
      const file = createMockFile('test.txt', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: '',
        writable: false,
      });

      const processed = await createProcessedFile(file);

      expect(processed.path).toBe('test.txt');
      expect(processed.name).toBe('test.txt');
    });

    it('should use custom path option over webkitRelativePath', async () => {
      const file = createMockFile('test.txt', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: 'wrong/path.txt',
        writable: false,
      });

      const processed = await createProcessedFile(file, { path: 'correct/path.txt' });

      expect(processed.path).toBe('correct/path.txt');
      expect(processed.name).toBe('path.txt');
    });
  });

  describe('Folder drop scenarios', () => {
    it('should handle flat folder structure', async () => {
      const files = [
        { name: 'index.html', path: 'my-site/index.html' },
        { name: 'style.css', path: 'my-site/style.css' },
        { name: 'script.js', path: 'my-site/script.js' },
      ];

      const processedFiles = await Promise.all(
        files.map(({ name, path }) => {
          const file = createMockFile(name, 'content');
          Object.defineProperty(file, 'webkitRelativePath', {
            value: path,
            writable: false,
          });
          return createProcessedFile(file);
        })
      );

      expect(processedFiles[0].path).toBe('my-site/index.html');
      expect(processedFiles[1].path).toBe('my-site/style.css');
      expect(processedFiles[2].path).toBe('my-site/script.js');

      // After stripping common prefix
      const stripped = stripCommonPrefix(processedFiles);
      expect(stripped[0].path).toBe('index.html');
      expect(stripped[1].path).toBe('style.css');
      expect(stripped[2].path).toBe('script.js');
    });

    it('should handle nested folder structure', async () => {
      const files = [
        { name: 'index.html', path: 'my-site/index.html' },
        { name: 'app.js', path: 'my-site/src/app.js' },
        { name: 'utils.js', path: 'my-site/src/utils.js' },
        { name: 'style.css', path: 'my-site/assets/style.css' },
      ];

      const processedFiles = await Promise.all(
        files.map(({ name, path }) => {
          const file = createMockFile(name, 'content');
          Object.defineProperty(file, 'webkitRelativePath', {
            value: path,
            writable: false,
          });
          return createProcessedFile(file);
        })
      );

      const stripped = stripCommonPrefix(processedFiles);
      expect(stripped[0].path).toBe('index.html');
      expect(stripped[1].path).toBe('src/app.js');
      expect(stripped[2].path).toBe('src/utils.js');
      expect(stripped[3].path).toBe('assets/style.css');
    });

    it('should handle deeply nested folder structure', async () => {
      const files = [
        { name: 'file.txt', path: 'project/src/components/Button/index.tsx' },
        { name: 'file.txt', path: 'project/src/components/Input/index.tsx' },
        { name: 'file.txt', path: 'project/src/utils/helpers.ts' },
      ];

      const processedFiles = await Promise.all(
        files.map(({ name, path }) => {
          const file = createMockFile(name, 'content');
          Object.defineProperty(file, 'webkitRelativePath', {
            value: path,
            writable: false,
          });
          return createProcessedFile(file);
        })
      );

      const stripped = stripCommonPrefix(processedFiles);
      expect(stripped[0].path).toBe('components/Button/index.tsx');
      expect(stripped[1].path).toBe('components/Input/index.tsx');
      expect(stripped[2].path).toBe('utils/helpers.ts');
    });
  });

  describe('Path doubling prevention (regression tests)', () => {
    it('should NOT double paths - correct behavior', async () => {
      // This is how webkitRelativePath should be set correctly
      const file = createMockFile('index.html', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: 'dist/index.html', // Correct: path includes folder AND filename
        writable: false,
      });

      const processed = await createProcessedFile(file);

      // Should be just the path as-is
      expect(processed.path).toBe('dist/index.html');
      expect(processed.name).toBe('index.html');

      // NOT 'dist/index.html/index.html' ❌
    });

    it('should handle already-doubled path gracefully (wrong but defensive)', async () => {
      // If consumer code incorrectly sets doubled path, we process it as-is
      const file = createMockFile('index.html', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: 'dist/index.html/index.html', // WRONG - but test documents behavior
        writable: false,
      });

      const processed = await createProcessedFile(file);

      // We take the path as-is - it's the consumer's responsibility to set it correctly
      expect(processed.path).toBe('dist/index.html/index.html');
      expect(processed.name).toBe('index.html'); // Name is still correct (last segment)
    });

    it('should detect path doubling in validation', async () => {
      // Document that weird paths with doubled segments are detectable
      const file = createMockFile('index.html', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: 'index.html/index.html',
        writable: false,
      });

      const processed = await createProcessedFile(file);

      // The path has suspicious doubling
      const segments = processed.path.split('/');
      const lastSegment = segments[segments.length - 1];
      const secondLastSegment = segments[segments.length - 2];

      // Doubled: last two segments are the same
      expect(lastSegment).toBe('index.html');
      expect(secondLastSegment).toBe('index.html');
    });
  });

  describe('Real-world folder drop patterns', () => {
    it('should handle root-level files in dropped folder', async () => {
      const files = [
        { name: 'index.html', path: 'my-site/index.html' },
        { name: 'README.md', path: 'my-site/README.md' },
      ];

      const processedFiles = await Promise.all(
        files.map(({ name, path }) => {
          const file = createMockFile(name, 'content');
          Object.defineProperty(file, 'webkitRelativePath', {
            value: path,
            writable: false,
          });
          return createProcessedFile(file);
        })
      );

      const stripped = stripCommonPrefix(processedFiles);
      expect(stripped[0].path).toBe('index.html');
      expect(stripped[1].path).toBe('README.md');
    });

    it('should handle single file drop (no webkitRelativePath)', async () => {
      // Single file drops typically don't have webkitRelativePath
      const file = createMockFile('index.html', 'content');

      const processed = await createProcessedFile(file);

      expect(processed.path).toBe('index.html');
      expect(processed.name).toBe('index.html');
    });

    it('should handle build output folder structure', async () => {
      const files = [
        { name: 'index.html', path: 'dist/index.html' },
        { name: 'main.js', path: 'dist/assets/main-abc123.js' },
        { name: 'style.css', path: 'dist/assets/style-def456.css' },
        { name: 'logo.png', path: 'dist/images/logo.png' },
      ];

      const processedFiles = await Promise.all(
        files.map(({ name, path }) => {
          const file = createMockFile(name, 'content');
          Object.defineProperty(file, 'webkitRelativePath', {
            value: path,
            writable: false,
          });
          return createProcessedFile(file);
        })
      );

      const stripped = stripCommonPrefix(processedFiles);
      expect(stripped[0].path).toBe('index.html');
      expect(stripped[1].path).toBe('assets/main-abc123.js');
      expect(stripped[2].path).toBe('assets/style-def456.css');
      expect(stripped[3].path).toBe('images/logo.png');
    });
  });

  describe('Edge cases', () => {
    it('should handle whitespace-only webkitRelativePath', async () => {
      const file = createMockFile('test.txt', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: '   ', // whitespace only
        writable: false,
      });

      const processed = await createProcessedFile(file);

      // Should fall back to file.name
      expect(processed.path).toBe('test.txt');
    });

    it('should handle very long paths', async () => {
      const longPath = 'a/'.repeat(50) + 'file.txt';
      const file = createMockFile('file.txt', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: longPath,
        writable: false,
      });

      const processed = await createProcessedFile(file);

      expect(processed.path).toBe(longPath);
      expect(processed.name).toBe('file.txt');
    });

    it('should handle paths with special characters', async () => {
      const file = createMockFile('my file.txt', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: 'my folder/sub folder/my file.txt',
        writable: false,
      });

      const processed = await createProcessedFile(file);

      expect(processed.path).toBe('my folder/sub folder/my file.txt');
      expect(processed.name).toBe('my file.txt');
    });

    it('should handle unicode in paths', async () => {
      const file = createMockFile('文件.txt', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: '文件夹/文件.txt',
        writable: false,
      });

      const processed = await createProcessedFile(file);

      expect(processed.path).toBe('文件夹/文件.txt');
      expect(processed.name).toBe('文件.txt');
    });
  });

  describe('Integration with stripCommonPrefix', () => {
    it('should work correctly with webkitRelativePath from folder drop', async () => {
      // Simulate what happens when user drops a folder
      const files = [
        { name: 'index.html', path: 'my-website/index.html' },
        { name: 'about.html', path: 'my-website/pages/about.html' },
        { name: 'contact.html', path: 'my-website/pages/contact.html' },
      ];

      const processedFiles = await Promise.all(
        files.map(({ name, path }) => {
          const file = createMockFile(name, 'content');
          Object.defineProperty(file, 'webkitRelativePath', {
            value: path,
            writable: false,
          });
          return createProcessedFile(file);
        })
      );

      // Verify paths are set correctly
      expect(processedFiles[0].path).toBe('my-website/index.html');
      expect(processedFiles[1].path).toBe('my-website/pages/about.html');
      expect(processedFiles[2].path).toBe('my-website/pages/contact.html');

      // After stripping, folder prefix should be removed
      const stripped = stripCommonPrefix(processedFiles);
      expect(stripped[0].path).toBe('index.html');
      expect(stripped[1].path).toBe('pages/about.html');
      expect(stripped[2].path).toBe('pages/contact.html');

      // Verify names are extracted correctly
      expect(stripped[0].name).toBe('index.html');
      expect(stripped[1].name).toBe('about.html');
      expect(stripped[2].name).toBe('contact.html');
    });
  });
});
