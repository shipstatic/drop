/**
 * Integration tests for folder drop functionality
 * Tests the traverseFileTree logic that's now built into useDrop
 */
import { describe, it, expect } from 'vitest';
import { createProcessedFile, stripCommonPrefix } from '@/utils/fileProcessing';
import { createMockFile } from '../test-utils';

describe('Folder drop integration', () => {
  describe('Path handling from traverseFileTree', () => {
    it('should handle files with webkitRelativePath from folder drop', async () => {
      // Simulate what traverseFileTree does: sets webkitRelativePath on files
      const files = [
        { name: 'index.html', relativePath: 'my-site/index.html' },
        { name: 'app.js', relativePath: 'my-site/src/app.js' },
        { name: 'style.css', relativePath: 'my-site/assets/style.css' },
      ].map(({ name, relativePath }) => {
        const file = createMockFile(name, 'content');
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          writable: false,
        });
        return file;
      });

      const processedFiles = await Promise.all(
        files.map(file => createProcessedFile(file))
      );

      // Paths should be preserved from webkitRelativePath
      expect(processedFiles[0].path).toBe('my-site/index.html');
      expect(processedFiles[1].path).toBe('my-site/src/app.js');
      expect(processedFiles[2].path).toBe('my-site/assets/style.css');

      // After stripping common prefix
      const stripped = stripCommonPrefix(processedFiles);
      expect(stripped[0].path).toBe('index.html');
      expect(stripped[1].path).toBe('src/app.js');
      expect(stripped[2].path).toBe('assets/style.css');
    });

    it('should handle nested folder structures correctly', async () => {
      const files = [
        { name: 'index.tsx', relativePath: 'project/src/components/Button/index.tsx' },
        { name: 'styles.css', relativePath: 'project/src/components/Button/styles.css' },
        { name: 'index.tsx', relativePath: 'project/src/components/Input/index.tsx' },
        { name: 'utils.ts', relativePath: 'project/src/utils.ts' },
      ].map(({ name, relativePath }) => {
        const file = createMockFile(name, 'content');
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          writable: false,
        });
        return file;
      });

      const processedFiles = await Promise.all(
        files.map(file => createProcessedFile(file))
      );

      const stripped = stripCommonPrefix(processedFiles);

      // Should strip 'project/src/' which is common to all
      expect(stripped[0].path).toBe('components/Button/index.tsx');
      expect(stripped[1].path).toBe('components/Button/styles.css');
      expect(stripped[2].path).toBe('components/Input/index.tsx');
      expect(stripped[3].path).toBe('utils.ts');
    });

    it('should NOT double paths (regression test)', async () => {
      // This tests the bug fix: traverseFileTree should NOT append filename twice
      const file = createMockFile('index.html', 'content');

      // Correct behavior: webkitRelativePath includes the full path
      Object.defineProperty(file, 'webkitRelativePath', {
        value: 'dist/index.html',
        writable: false,
      });

      const processed = await createProcessedFile(file);

      // Should be exactly as provided, NOT doubled
      expect(processed.path).toBe('dist/index.html');
      expect(processed.path).not.toBe('dist/index.html/index.html'); // ❌ Wrong
    });

    it('should handle root-level files in dropped folder', async () => {
      const files = [
        { name: 'index.html', relativePath: 'my-site/index.html' },
        { name: 'README.md', relativePath: 'my-site/README.md' },
        { name: 'package.json', relativePath: 'my-site/package.json' },
      ].map(({ name, relativePath }) => {
        const file = createMockFile(name, 'content');
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          writable: false,
        });
        return file;
      });

      const processedFiles = await Promise.all(
        files.map(file => createProcessedFile(file))
      );

      const stripped = stripCommonPrefix(processedFiles);

      // All files are at root level after stripping folder name
      expect(stripped[0].path).toBe('index.html');
      expect(stripped[1].path).toBe('README.md');
      expect(stripped[2].path).toBe('package.json');
    });

    it('should handle build output folder structure', async () => {
      const files = [
        { name: 'index.html', relativePath: 'dist/index.html' },
        { name: 'main.js', relativePath: 'dist/assets/main-abc123.js' },
        { name: 'vendor.js', relativePath: 'dist/assets/vendor-def456.js' },
        { name: 'style.css', relativePath: 'dist/assets/style-ghi789.css' },
        { name: 'logo.png', relativePath: 'dist/images/logo.png' },
        { name: 'favicon.ico', relativePath: 'dist/favicon.ico' },
      ].map(({ name, relativePath }) => {
        const file = createMockFile(name, 'content');
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          writable: false,
        });
        return file;
      });

      const processedFiles = await Promise.all(
        files.map(file => createProcessedFile(file))
      );

      const stripped = stripCommonPrefix(processedFiles);

      expect(stripped[0].path).toBe('index.html');
      expect(stripped[1].path).toBe('assets/main-abc123.js');
      expect(stripped[2].path).toBe('assets/vendor-def456.js');
      expect(stripped[3].path).toBe('assets/style-ghi789.css');
      expect(stripped[4].path).toBe('images/logo.png');
      expect(stripped[5].path).toBe('favicon.ico');
    });

    it('should handle deeply nested single file', async () => {
      const file = createMockFile('config.json', 'content');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: 'project/src/config/environments/production/config.json',
        writable: false,
      });

      const processed = await createProcessedFile(file);
      expect(processed.path).toBe('project/src/config/environments/production/config.json');

      // Single file should strip all parent directories
      const stripped = stripCommonPrefix([processed]);
      expect(stripped[0].path).toBe('config.json');
    });

    it('should preserve folder structure with different depths', async () => {
      const files = [
        { name: 'index.html', relativePath: 'site/index.html' },
        { name: 'deep.js', relativePath: 'site/a/b/c/d/deep.js' },
        { name: 'mid.css', relativePath: 'site/a/b/mid.css' },
      ].map(({ name, relativePath }) => {
        const file = createMockFile(name, 'content');
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          writable: false,
        });
        return file;
      });

      const processedFiles = await Promise.all(
        files.map(file => createProcessedFile(file))
      );

      const stripped = stripCommonPrefix(processedFiles);

      // Common prefix 'site/' is stripped
      expect(stripped[0].path).toBe('index.html');
      expect(stripped[1].path).toBe('a/b/c/d/deep.js');
      expect(stripped[2].path).toBe('a/b/mid.css');
    });
  });

  describe('Special characters in folder names', () => {
    it('should handle spaces in folder names', async () => {
      const files = [
        { name: 'doc.txt', relativePath: 'My Project/docs/doc.txt' },
        { name: 'file.js', relativePath: 'My Project/src/file.js' },
      ].map(({ name, relativePath }) => {
        const file = createMockFile(name, 'content');
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          writable: false,
        });
        return file;
      });

      const processedFiles = await Promise.all(
        files.map(file => createProcessedFile(file))
      );

      const stripped = stripCommonPrefix(processedFiles);

      expect(stripped[0].path).toBe('docs/doc.txt');
      expect(stripped[1].path).toBe('src/file.js');
    });

    it('should handle special characters in folder names', async () => {
      const files = [
        { name: 'file.txt', relativePath: 'my-project_v2.0/file.txt' },
        { name: 'data.json', relativePath: 'my-project_v2.0/data/data.json' },
      ].map(({ name, relativePath }) => {
        const file = createMockFile(name, 'content');
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          writable: false,
        });
        return file;
      });

      const processedFiles = await Promise.all(
        files.map(file => createProcessedFile(file))
      );

      const stripped = stripCommonPrefix(processedFiles);

      expect(stripped[0].path).toBe('file.txt');
      expect(stripped[1].path).toBe('data/data.json');
    });

    it('should handle unicode in folder names', async () => {
      const files = [
        { name: '文件.txt', relativePath: '文件夹/子文件夹/文件.txt' },
        { name: 'file.txt', relativePath: '文件夹/file.txt' },
      ].map(({ name, relativePath }) => {
        const file = createMockFile(name, 'content');
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          writable: false,
        });
        return file;
      });

      const processedFiles = await Promise.all(
        files.map(file => createProcessedFile(file))
      );

      const stripped = stripCommonPrefix(processedFiles);

      expect(stripped[0].path).toBe('子文件夹/文件.txt');
      expect(stripped[1].path).toBe('file.txt');
    });
  });

  describe('Empty directories and edge cases', () => {
    it('should handle single file at root (no folder drop)', async () => {
      // When user drops a single file (not a folder), there's no webkitRelativePath
      const file = createMockFile('standalone.txt', 'content');

      const processed = await createProcessedFile(file);

      expect(processed.path).toBe('standalone.txt');
      expect(processed.name).toBe('standalone.txt');
    });

    it('should handle mixed: some with paths, some without', async () => {
      // Edge case: mixing folder drops and individual files (shouldn't happen in practice)
      const file1 = createMockFile('file1.txt', 'content');
      Object.defineProperty(file1, 'webkitRelativePath', {
        value: 'folder/file1.txt',
        writable: false,
      });

      const file2 = createMockFile('file2.txt', 'content');
      // No webkitRelativePath

      const processedFiles = await Promise.all([
        createProcessedFile(file1),
        createProcessedFile(file2),
      ]);

      // No common prefix due to different structures
      const stripped = stripCommonPrefix(processedFiles);

      expect(stripped[0].path).toBe('folder/file1.txt');
      expect(stripped[1].path).toBe('file2.txt');
    });
  });
});
