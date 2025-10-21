/**
 * Path normalization sanity tests
 * Tests the normalizePath security utility to ensure proper path sanitization
 */
import { describe, it, expect } from 'vitest';
import { normalizePath } from '@/utils/zipExtractor';

describe('normalizePath', () => {
  describe('Basic normalization', () => {
    it('should preserve simple valid paths', () => {
      expect(normalizePath('file.txt')).toBe('file.txt');
      expect(normalizePath('folder/file.txt')).toBe('folder/file.txt');
      expect(normalizePath('a/b/c/file.txt')).toBe('a/b/c/file.txt');
    });

    it('should handle empty string', () => {
      expect(normalizePath('')).toBe('');
    });
  });

  describe('Directory traversal prevention (security)', () => {
    it('should remove .. segments (basic)', () => {
      expect(normalizePath('../file.txt')).toBe('file.txt');
      expect(normalizePath('folder/../file.txt')).toBe('file.txt');
      expect(normalizePath('a/b/../c/file.txt')).toBe('a/c/file.txt');
    });

    it('should handle multiple .. segments', () => {
      expect(normalizePath('../../file.txt')).toBe('file.txt');
      expect(normalizePath('a/b/c/../../file.txt')).toBe('a/file.txt');
      expect(normalizePath('a/../b/../c/file.txt')).toBe('c/file.txt');
    });

    it('should prevent traversal above root', () => {
      expect(normalizePath('../../../etc/passwd')).toBe('etc/passwd');
      expect(normalizePath('../../../../etc/passwd')).toBe('etc/passwd');
    });

    it('should handle complex traversal patterns', () => {
      expect(normalizePath('foo/./bar/../baz.txt')).toBe('foo/baz.txt');
      expect(normalizePath('./test/./file.txt')).toBe('test/file.txt');
      expect(normalizePath('a/./b/../c/./d/../e')).toBe('a/c/e');
    });

    it('should handle paths that resolve to empty', () => {
      expect(normalizePath('../../../')).toBe('');
      expect(normalizePath('../../..')).toBe('');
      expect(normalizePath('./../.')).toBe('');
    });
  });

  describe('Current directory (.) removal', () => {
    it('should remove single dot segments', () => {
      expect(normalizePath('./file.txt')).toBe('file.txt');
      expect(normalizePath('folder/./file.txt')).toBe('folder/file.txt');
      expect(normalizePath('./folder/./file.txt')).toBe('folder/file.txt');
    });

    it('should preserve dots in filenames', () => {
      expect(normalizePath('.gitignore')).toBe('.gitignore');
      expect(normalizePath('.env.local')).toBe('.env.local');
      expect(normalizePath('file.min.js')).toBe('file.min.js');
      expect(normalizePath('folder/.htaccess')).toBe('folder/.htaccess');
    });
  });

  describe('Slash handling', () => {
    it('should remove leading slashes', () => {
      expect(normalizePath('/file.txt')).toBe('file.txt');
      expect(normalizePath('/folder/file.txt')).toBe('folder/file.txt');
      expect(normalizePath('//folder/file.txt')).toBe('folder/file.txt');
      expect(normalizePath('/etc/passwd')).toBe('etc/passwd');
    });

    it('should collapse multiple slashes', () => {
      expect(normalizePath('folder//file.txt')).toBe('folder/file.txt');
      expect(normalizePath('folder///file.txt')).toBe('folder/file.txt');
      expect(normalizePath('a////b////c')).toBe('a/b/c');
    });

    it('should handle trailing slashes', () => {
      // Trailing slashes are removed by collapsing empty segments
      expect(normalizePath('folder/')).toBe('folder');
      expect(normalizePath('folder/subfolder/')).toBe('folder/subfolder');
    });

    it('should handle paths with only slashes', () => {
      expect(normalizePath('/')).toBe('');
      expect(normalizePath('//')).toBe('');
      expect(normalizePath('///')).toBe('');
    });
  });

  describe('Real-world malicious scenarios', () => {
    it('should sanitize ZIP slip vulnerability attempts', () => {
      expect(normalizePath('../../../../var/www/html/shell.php')).toBe('var/www/html/shell.php');
      expect(normalizePath('folder/../../../etc/cron.d/backdoor')).toBe('etc/cron.d/backdoor');
    });

    it('should handle absolute paths from malicious ZIPs', () => {
      expect(normalizePath('/absolute/path.txt')).toBe('absolute/path.txt');
      expect(normalizePath('/var/www/html/index.php')).toBe('var/www/html/index.php');
    });

    it('should normalize mixed traversal and absolute paths', () => {
      expect(normalizePath('/folder/../../../etc/passwd')).toBe('etc/passwd');
    });
  });

  describe('Unicode and special characters', () => {
    it('should preserve Unicode characters', () => {
      expect(normalizePath('文件夹/文件.txt')).toBe('文件夹/文件.txt');
      expect(normalizePath('папка/файл.txt')).toBe('папка/файл.txt');
      expect(normalizePath('dossier/fichier.txt')).toBe('dossier/fichier.txt');
    });

    it('should preserve spaces in paths', () => {
      expect(normalizePath('My Project/My File.txt')).toBe('My Project/My File.txt');
      expect(normalizePath('folder with spaces/file.txt')).toBe('folder with spaces/file.txt');
    });

    it('should preserve special characters in filenames', () => {
      expect(normalizePath('project-v1.0/file_name.txt')).toBe('project-v1.0/file_name.txt');
      expect(normalizePath('folder/file@2x.png')).toBe('folder/file@2x.png');
      expect(normalizePath('folder (1)/file.txt')).toBe('folder (1)/file.txt');
    });
  });

  describe('Edge cases', () => {
    it('should handle very deep paths', () => {
      const deepPath = 'a/'.repeat(50) + 'file.txt';
      const normalized = normalizePath(deepPath);
      expect(normalized).toBe(deepPath);
    });

    it('should handle paths with only dots', () => {
      expect(normalizePath('.')).toBe('');
      expect(normalizePath('..')).toBe('');
      expect(normalizePath('../..')).toBe('');
    });

    it('should be idempotent', () => {
      const path = 'folder//subfolder/../file.txt';
      const normalized = normalizePath(path);
      const normalizedAgain = normalizePath(normalized);
      expect(normalized).toBe(normalizedAgain);
      expect(normalized).toBe('folder/file.txt');
    });
  });

  describe('Integration scenarios', () => {
    it('should work well with junk file filtering', () => {
      // After normalization, junk files should still be detectable
      const path = './folder/.DS_Store';
      const normalized = normalizePath(path);
      expect(normalized).toBe('folder/.DS_Store');
      // This would then be caught by isJunkFile()
    });

    it('should normalize typical ZIP paths', () => {
      const paths = [
        'myProject/./index.html',
        'myProject/src/../app.js',
        './myProject/assets/style.css',
      ];

      const normalized = paths.map(normalizePath);
      expect(normalized).toEqual([
        'myProject/index.html',
        'myProject/app.js',
        'myProject/assets/style.css',
      ]);
    });

    it('should handle macOS ZIP artifacts', () => {
      expect(normalizePath('__MACOSX/./myProject/._file.txt')).toBe('__MACOSX/myProject/._file.txt');
      expect(normalizePath('./__MACOSX/resource')).toBe('__MACOSX/resource');
    });
  });
});
