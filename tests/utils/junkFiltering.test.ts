/**
 * Comprehensive junk file filtering tests
 * Based on old implementation tests to ensure robust filtering
 */
import { describe, it, expect } from 'vitest';
import { isJunkFile } from '@/utils/zipExtractor';

describe('isJunkFile', () => {
  describe('Basic junk files at root', () => {
    it('should filter .DS_Store at root', () => {
      expect(isJunkFile('.DS_Store')).toBe(true);
    });

    it('should filter Thumbs.db at root', () => {
      expect(isJunkFile('Thumbs.db')).toBe(true);
    });

    it('should filter desktop.ini at root', () => {
      expect(isJunkFile('desktop.ini')).toBe(true);
    });

    it('should filter ._.DS_Store (resource fork) at root', () => {
      expect(isJunkFile('._.DS_Store')).toBe(true);
    });
  });

  describe('Junk files in nested folders', () => {
    it('should filter .DS_Store in nested folders', () => {
      expect(isJunkFile('folder/.DS_Store')).toBe(true);
      expect(isJunkFile('folder/subfolder/.DS_Store')).toBe(true);
      expect(isJunkFile('a/b/c/d/.DS_Store')).toBe(true);
      expect(isJunkFile('some/folder/desktop.ini')).toBe(true);
      expect(isJunkFile('another/dir/.DS_Store')).toBe(true);
    });

    it('should filter Thumbs.db in nested folders', () => {
      expect(isJunkFile('folder/Thumbs.db')).toBe(true);
      expect(isJunkFile('assets/images/Thumbs.db')).toBe(true);
      expect(isJunkFile('myProject/src/nested_junk/Thumbs.db')).toBe(true);
    });

    it('should filter desktop.ini in nested folders', () => {
      expect(isJunkFile('folder/desktop.ini')).toBe(true);
      expect(isJunkFile('src/components/desktop.ini')).toBe(true);
    });

    it('should filter ._.DS_Store (resource fork) in nested folders', () => {
      expect(isJunkFile('folder/._.DS_Store')).toBe(true);
      expect(isJunkFile('myProject/._.DS_Store')).toBe(true);
    });
  });

  describe('__MACOSX directory filtering', () => {
    it('should filter all files in __MACOSX at root', () => {
      expect(isJunkFile('__MACOSX/foo/._bar.txt')).toBe(true);
      expect(isJunkFile('__MACOSX/._.DS_Store')).toBe(true);
      expect(isJunkFile('__MACOSX/some_other_file')).toBe(true);
      expect(isJunkFile('__MACOSX/file.txt')).toBe(true);
    });

    it('should filter __MACOSX with nested files', () => {
      expect(isJunkFile('__MACOSX/folder/file.txt')).toBe(true);
      expect(isJunkFile('__MACOSX/._resource.txt')).toBe(true);
      expect(isJunkFile('__MACOSX/._.DS_Store')).toBe(true);
    });

    it('should filter __MACOSX even with deep nesting', () => {
      expect(isJunkFile('__MACOSX/a/b/c/d/e/file')).toBe(true);
    });

    it('should NOT filter __MACOSX when nested in project folder (only filters at root)', () => {
      // Current implementation only checks path.startsWith('__MACOSX/')
      // So 'myProject/__MACOSX/...' won't be filtered
      expect(isJunkFile('myProject/__MACOSX/resource.txt')).toBe(false);
    });

    it('should filter __MACOSX case-insensitively', () => {
      expect(isJunkFile('__MACOSX/file.txt')).toBe(true);
      expect(isJunkFile('__macosx/file.txt')).toBe(true);
      expect(isJunkFile('__MacOSX/file.txt')).toBe(true);
      expect(isJunkFile('__MACOSX/nested/file.txt')).toBe(true);
    });

    it('should NOT filter files that merely contain MACOSX in name', () => {
      expect(isJunkFile('my__MACOSX_backup.txt')).toBe(false);
      expect(isJunkFile('folder/file__MACOSX.txt')).toBe(false);
      expect(isJunkFile('__MACOSX_copy/file.txt')).toBe(false); // Doesn't START with __MACOSX/
    });
  });

  describe('Valid files that should NOT be filtered (false positives)', () => {
    it('should not filter files with junk patterns in name', () => {
      expect(isJunkFile('mydsstore.txt')).toBe(false);
      expect(isJunkFile('thumb.db.backup')).toBe(false);
      expect(isJunkFile('desktop.ini.config')).toBe(false);
      expect(isJunkFile('.DS_Store.backup')).toBe(false);
    });

    it('should not filter normal hidden files', () => {
      expect(isJunkFile('.gitignore')).toBe(false);
      expect(isJunkFile('.env')).toBe(false);
      expect(isJunkFile('folder/.htaccess')).toBe(false);
      expect(isJunkFile('.eslintrc')).toBe(false);
    });

    it('should not filter regular files', () => {
      expect(isJunkFile('index.html')).toBe(false);
      expect(isJunkFile('app.js')).toBe(false);
      expect(isJunkFile('styles.css')).toBe(false);
      expect(isJunkFile('image.png')).toBe(false);
      expect(isJunkFile('valid.txt')).toBe(false);
    });

    it('should not filter files in nested directories', () => {
      expect(isJunkFile('src/components/Button.tsx')).toBe(false);
      expect(isJunkFile('assets/images/logo.png')).toBe(false);
      expect(isJunkFile('myProject/valid_subfile.txt')).toBe(false);
    });

    it('should not filter files with similar names to junk files', () => {
      expect(isJunkFile('DS_Store_backup.txt')).toBe(false);
      expect(isJunkFile('thumbs_database.sql')).toBe(false);
      expect(isJunkFile('desktop_ini_parser.py')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      expect(isJunkFile('')).toBe(false);
    });

    it('should handle paths with only junk filename', () => {
      expect(isJunkFile('.DS_Store')).toBe(true);
      expect(isJunkFile('Thumbs.db')).toBe(true);
    });

    it('should be case-insensitive for robust filtering', () => {
      // Windows file systems are case-insensitive, so we need to filter all variants
      expect(isJunkFile('.ds_store')).toBe(true); // lowercase
      expect(isJunkFile('.DS_Store')).toBe(true); // mixed case
      expect(isJunkFile('.DS_STORE')).toBe(true); // uppercase
      expect(isJunkFile('THUMBS.DB')).toBe(true); // uppercase
      expect(isJunkFile('thumbs.db')).toBe(true); // lowercase
      expect(isJunkFile('Thumbs.db')).toBe(true); // mixed case
      expect(isJunkFile('Desktop.ini')).toBe(true); // capitalized
      expect(isJunkFile('desktop.ini')).toBe(true); // lowercase
      expect(isJunkFile('DESKTOP.INI')).toBe(true); // uppercase
    });

    it('should handle paths with multiple slashes', () => {
      expect(isJunkFile('folder//.DS_Store')).toBe(true);
      expect(isJunkFile('folder///subfolder//.DS_Store')).toBe(true);
    });

    it('should handle trailing slashes', () => {
      // Paths with trailing slashes represent directories
      expect(isJunkFile('.DS_Store/')).toBe(false); // basename is empty string
      expect(isJunkFile('folder/.DS_Store/')).toBe(false); // basename is empty string
    });

    it('should handle __MACOSX with trailing slash', () => {
      expect(isJunkFile('__MACOSX/')).toBe(true);
    });
  });

  describe('Resource fork files (macOS)', () => {
    it('should filter ._.DS_Store resource fork', () => {
      expect(isJunkFile('._.DS_Store')).toBe(true);
      expect(isJunkFile('folder/._.DS_Store')).toBe(true);
    });

    it('should NOT filter generic resource fork patterns (only ._.DS_Store)', () => {
      // Only ._.DS_Store is explicitly in junk list
      expect(isJunkFile('._file.txt')).toBe(false);
      expect(isJunkFile('folder/._image.png')).toBe(false);
      expect(isJunkFile('._resource')).toBe(false);
    });
  });

  describe('Real-world scenarios from old tests', () => {
    it('should handle ZIP from macOS Finder', () => {
      const macOSZipFiles = [
        '__MACOSX/myProject/._index.html',
        '__MACOSX/myProject/._.DS_Store',
        'myProject/.DS_Store',
        'myProject/index.html',
        'myProject/src/app.js',
        'myProject/src/.DS_Store',
      ];

      const filtered = macOSZipFiles.filter((path) => !isJunkFile(path));
      expect(filtered).toEqual(['myProject/index.html', 'myProject/src/app.js']);
    });

    it('should handle ZIP from Windows', () => {
      const windowsZipFiles = [
        'myProject/Thumbs.db',
        'myProject/desktop.ini',
        'myProject/index.html',
        'myProject/images/photo.jpg',
        'myProject/images/Thumbs.db',
      ];

      const filtered = windowsZipFiles.filter((path) => !isJunkFile(path));
      expect(filtered).toEqual(['myProject/index.html', 'myProject/images/photo.jpg']);
    });

    it('should handle mixed Mac and Windows artifacts', () => {
      const mixedZipFiles = [
        '__MACOSX/project/._.DS_Store',
        'project/.DS_Store',
        'project/Thumbs.db',
        'project/desktop.ini',
        'project/README.md',
        'project/src/index.js',
        'project/src/.DS_Store',
        'project/src/Thumbs.db',
      ];

      const filtered = mixedZipFiles.filter((path) => !isJunkFile(path));
      expect(filtered).toEqual(['project/README.md', 'project/src/index.js']);
    });

    it('should handle complex mixed scenario with valid and junk files', () => {
      const files = [
        'myProject/__MACOSX/ignored_file', // Not filtered (doesn't start with __MACOSX/)
        'myProject/.DS_Store',
        'myProject/src/app.js',
        'myProject/src/nested_junk/Thumbs.db',
        'myProject/assets/icon.png',
        'desktop.ini',
      ];

      const filtered = files.filter((path) => !isJunkFile(path));
      // Note: myProject/__MACOSX/... is NOT filtered by current implementation
      // Only paths that START with __MACOSX/ are filtered
      expect(filtered).toEqual([
        'myProject/__MACOSX/ignored_file',
        'myProject/src/app.js',
        'myProject/assets/icon.png',
      ]);
    });

    it('should handle all junk files scenario', () => {
      const allJunk = [
        '.DS_Store',
        'some/Thumbs.db',
        '__MACOSX/another/file',
        'folder/._.DS_Store',
        'nested/desktop.ini',
      ];

      const filtered = allJunk.filter((path) => !isJunkFile(path));
      expect(filtered).toEqual([]);
    });

    it('should handle no junk files scenario', () => {
      const noJunk = ['document.pdf', 'image.png', 'folder/file.txt'];

      const filtered = noJunk.filter((path) => !isJunkFile(path));
      expect(filtered).toEqual(noJunk);
    });
  });

  describe('Specific basename matching edge cases', () => {
    it('should only match exact basename for junk files', () => {
      // These have junk files as part of the name but not as basename
      expect(isJunkFile('prefix_.DS_Store')).toBe(false);
      expect(isJunkFile('Thumbs.db_suffix')).toBe(false);
      expect(isJunkFile('_desktop.ini')).toBe(false);
    });

    it('should match junk files regardless of path depth', () => {
      expect(isJunkFile('a/.DS_Store')).toBe(true);
      expect(isJunkFile('a/b/.DS_Store')).toBe(true);
      expect(isJunkFile('a/b/c/.DS_Store')).toBe(true);
      expect(isJunkFile('a/b/c/d/e/f/g/.DS_Store')).toBe(true);
    });
  });

  describe('Integration with path normalization', () => {
    it('should work correctly with normalized paths', () => {
      // These paths would be normalized before junk check in real usage
      expect(isJunkFile('folder/.DS_Store')).toBe(true);
      expect(isJunkFile('folder/./subfolder/.DS_Store')).toBe(true);
      expect(isJunkFile('./folder/.DS_Store')).toBe(true);
    });
  });
});
