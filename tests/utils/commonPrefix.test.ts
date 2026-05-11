/**
 * Comprehensive common prefix stripping tests
 *
 * Tests edge cases for finding and removing common directory prefixes
 * from file paths in ZIP archives and folder drag-and-drop
 */
import { describe, it, expect } from 'vitest';
import { stripCommonPrefix, createProcessedFile } from '@/utils/fileProcessing';
import { createMockFile } from '../test-utils';

describe('Common Prefix Stripping', () => {
  describe('Basic common prefix scenarios', () => {
    it('should strip simple common directory prefix', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'project/index.html' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'project/src/app.js' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('index.html');
      expect(result[1].path).toBe('src/app.js');
    });

    it('should strip deep common directory prefix', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'a/b/c/file1.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'a/b/c/file2.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'a/b/c/d/file3.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('file2.txt');
      expect(result[2].path).toBe('d/file3.txt');
    });

    it('should not strip if no common prefix', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'projectA/file.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'projectB/file.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('projectA/file.txt');
      expect(result[1].path).toBe('projectB/file.txt');
    });
  });

  describe('Trailing slash handling', () => {
    it('should handle paths with trailing slashes', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'project/folder/' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'project/file.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      // Should strip 'project/' from both
      expect(result[0].path).toBe('folder/');
      expect(result[1].path).toBe('file.txt');
    });

    it('should handle all paths with trailing slashes', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'project/folderA/' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'project/folderB/' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('folderA/');
      expect(result[1].path).toBe('folderB/');
    });
  });

  describe('Mixed files and directories', () => {
    it('should handle mix of files and directories', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'root/index.html' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'root/src/' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'root/assets/img.png' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('index.html');
      expect(result[1].path).toBe('src/');
      expect(result[2].path).toBe('assets/img.png');
    });

    it('should handle files at root level mixed with nested files', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'project/index.html' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'project/README.md' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'project/src/app.js' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('index.html');
      expect(result[1].path).toBe('README.md');
      expect(result[2].path).toBe('src/app.js');
    });
  });

  describe('Empty and single file scenarios', () => {
    it('should handle empty array', () => {
      const result = stripCommonPrefix([]);
      expect(result).toEqual([]);
    });

    it('should handle single file with path', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'project/index.html' }),
      ]);

      const result = stripCommonPrefix(files);

      // Single file in folder should strip the folder prefix
      expect(result[0].path).toBe('index.html');
    });

    it('should handle single file at root', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'index.html' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('index.html');
    });

    it('should handle single deeply nested file', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'a/b/c/d/file.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      // Should strip all directory levels for single file
      expect(result[0].path).toBe('file.txt');
    });
  });

  describe('Identical path handling', () => {
    it('should handle files with identical paths', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file1.txt'), { path: 'project/file.txt' }),
        createProcessedFile(createMockFile('file2.txt'), { path: 'project/file.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      // Both should have prefix stripped
      expect(result[0].path).toBe('file.txt');
      expect(result[1].path).toBe('file.txt');
    });

    it('should handle directories with identical paths', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'root/folder/' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'root/folder/' }),
      ]);

      const result = stripCommonPrefix(files);

      // Trailing-slash inputs are pathological — Ship's path optimizer falls
      // back to the original path rather than emitting an empty deploy path.
      expect(result[0].path).toBe('root/folder/');
      expect(result[1].path).toBe('root/folder/');
    });
  });

  describe('Partial prefix scenarios', () => {
    it('should not strip when common is only filename prefix', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'component.tsx' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'component.test.tsx' }),
      ]);

      const result = stripCommonPrefix(files);

      // Should not strip 'component' as it's not a directory
      expect(result[0].path).toBe('component.tsx');
      expect(result[1].path).toBe('component.test.tsx');
    });

    it('should handle one file at root, others nested', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'README.md' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'src/app.js' }),
      ]);

      const result = stripCommonPrefix(files);

      // No common directory prefix
      expect(result[0].path).toBe('README.md');
      expect(result[1].path).toBe('src/app.js');
    });
  });

  describe('Deep structure scenarios', () => {
    it('should strip partial common prefix for diverging paths', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'root/a/b/c/file1.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'root/a/b/d/file2.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'root/a/x/file3.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      // Should only strip 'root/a/' which is common to all
      expect(result[0].path).toBe('b/c/file1.txt');
      expect(result[1].path).toBe('b/d/file2.txt');
      expect(result[2].path).toBe('x/file3.txt');
    });

    it('should handle very deep common structure', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), {
          path: 'a/b/c/d/e/f/g/file1.txt',
        }),
        createProcessedFile(createMockFile('file.txt'), {
          path: 'a/b/c/d/e/f/g/file2.txt',
        }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('file2.txt');
    });
  });

  describe('Leading slash handling', () => {
    it('should handle paths with leading slash', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: '/project/file1.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: '/project/file2.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      // Should strip '/project/' including leading slash
      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('file2.txt');
    });

    it('should handle mix of paths with and without leading slash', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: '/project/file1.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'project/file2.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      // Ship's optimizer normalizes the leading slash, so both paths share the
      // 'project/' prefix and get stripped consistently.
      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('file2.txt');
    });
  });

  describe('Special characters and case sensitivity', () => {
    it('should handle paths with special characters', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'my-project_v1/file1.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'my-project_v1/file2.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('file2.txt');
    });

    it('should handle paths with spaces', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'My Project/file1.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'My Project/file2.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('file2.txt');
    });

    it('should be case-sensitive when finding common prefix', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'Project/file1.txt' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'project/file2.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      // No common prefix due to case mismatch
      expect(result[0].path).toBe('Project/file1.txt');
      expect(result[1].path).toBe('project/file2.txt');
    });
  });

  describe('Real-world ZIP scenarios', () => {
    it('should handle typical macOS ZIP structure', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), {
          path: 'my-website-v2/index.html',
        }),
        createProcessedFile(createMockFile('file.txt'), {
          path: 'my-website-v2/assets/style.css',
        }),
        createProcessedFile(createMockFile('file.txt'), {
          path: 'my-website-v2/assets/images/logo.png',
        }),
        createProcessedFile(createMockFile('file.txt'), {
          path: 'my-website-v2/js/app.js',
        }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('index.html');
      expect(result[1].path).toBe('assets/style.css');
      expect(result[2].path).toBe('assets/images/logo.png');
      expect(result[3].path).toBe('js/app.js');
    });

    it('should handle ZIP with multiple root directories', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'src/index.js' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'dist/bundle.js' }),
        createProcessedFile(createMockFile('file.txt'), { path: 'README.md' }),
      ]);

      const result = stripCommonPrefix(files);

      // No common prefix - files should remain unchanged
      expect(result[0].path).toBe('src/index.js');
      expect(result[1].path).toBe('dist/bundle.js');
      expect(result[2].path).toBe('README.md');
    });

    it('should handle GitHub ZIP download structure', async () => {
      // GitHub ZIPs come as: repo-name-branch/files
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), {
          path: 'my-repo-main/package.json',
        }),
        createProcessedFile(createMockFile('file.txt'), {
          path: 'my-repo-main/src/index.ts',
        }),
        createProcessedFile(createMockFile('file.txt'), {
          path: 'my-repo-main/README.md',
        }),
      ]);

      const result = stripCommonPrefix(files);

      expect(result[0].path).toBe('package.json');
      expect(result[1].path).toBe('src/index.ts');
      expect(result[2].path).toBe('README.md');
    });
  });

  describe('Edge cases with empty paths', () => {
    it('should handle files with empty string paths', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file1.txt'), { path: 'file1.txt' }),
        createProcessedFile(createMockFile('file2.txt'), { path: 'project/file.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      // No common directory prefix between root file and nested file
      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('project/file.txt');
    });

    it('should handle all root-level files', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file1.txt'), { path: 'file1.txt' }),
        createProcessedFile(createMockFile('file2.txt'), { path: 'file2.txt' }),
      ]);

      const result = stripCommonPrefix(files);

      // No directory prefix to strip
      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('file2.txt');
    });
  });

  describe('Preservation of file identity', () => {
    it('should preserve all file properties except path', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('test.txt', 'content1'), {
          path: 'project/test.txt',
        }),
      ]);

      const originalId = files[0].id;
      const originalSize = files[0].size;
      const originalType = files[0].type;
      const originalMd5 = files[0].md5;

      const result = stripCommonPrefix(files);

      expect(result[0].id).toBe(originalId);
      expect(result[0].size).toBe(originalSize);
      expect(result[0].type).toBe(originalType);
      expect(result[0].md5).toBe(originalMd5);
      expect(result[0].path).toBe('test.txt'); // Only path should change
      expect(result[0].name).toBe('test.txt'); // Name stays as original filename
    });

    it('should return new objects, not mutate originals', async () => {
      const files = await Promise.all([
        createProcessedFile(createMockFile('file.txt'), { path: 'project/file.txt' }),
      ]);

      const originalPath = files[0].path;
      const result = stripCommonPrefix(files);

      expect(files[0].path).toBe(originalPath); // Original unchanged
      expect(result[0].path).toBe('file.txt'); // New object has stripped path
      expect(result[0]).not.toBe(files[0]); // Different object reference
    });
  });
});
