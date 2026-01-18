/**
 * Unicode and Special Character Filename Tests
 *
 * Tests file processing with international characters, emojis,
 * and edge-case filenames to ensure proper handling.
 */
import { describe, it, expect } from 'vitest';
import { createProcessedFile, stripCommonPrefix } from '@/utils/fileProcessing';
import { getMimeType } from '@/utils/mimeType';
import { filterJunk } from '@shipstatic/ship';

describe('Unicode and Special Character Filenames', () => {
  describe('createProcessedFile with unicode names', () => {
    it('should handle Chinese characters', async () => {
      const file = new File(['内容'], '文件.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('文件.txt');
      expect(processed.path).toBe('文件.txt');
    });

    it('should handle Japanese characters', async () => {
      const file = new File(['コンテンツ'], 'ファイル.html', { type: 'text/html' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('ファイル.html');
      expect(processed.path).toBe('ファイル.html');
    });

    it('should handle Korean characters', async () => {
      const file = new File(['콘텐츠'], '파일.css', { type: 'text/css' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('파일.css');
      expect(processed.path).toBe('파일.css');
    });

    it('should handle Cyrillic characters', async () => {
      const file = new File(['содержимое'], 'файл.js', { type: 'application/javascript' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('файл.js');
      expect(processed.path).toBe('файл.js');
    });

    it('should handle Arabic characters', async () => {
      const file = new File(['محتوى'], 'ملف.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('ملف.txt');
      expect(processed.path).toBe('ملف.txt');
    });

    it('should handle Hebrew characters', async () => {
      const file = new File(['תוכן'], 'קובץ.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('קובץ.txt');
      expect(processed.path).toBe('קובץ.txt');
    });

    it('should handle emoji in filenames', async () => {
      const file = new File(['emoji content'], '🔥fire🔥.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('🔥fire🔥.txt');
      expect(processed.path).toBe('🔥fire🔥.txt');
    });

    it('should handle mixed unicode and ASCII', async () => {
      const file = new File(['mixed'], 'hello_世界_файл.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('hello_世界_файл.txt');
      expect(processed.path).toBe('hello_世界_файл.txt');
    });

    it('should handle accented Latin characters', async () => {
      const file = new File(['café content'], 'café_naïve_résumé.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('café_naïve_résumé.txt');
      expect(processed.path).toBe('café_naïve_résumé.txt');
    });

    it('should handle Greek characters', async () => {
      const file = new File(['περιεχόμενο'], 'αρχείο.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('αρχείο.txt');
      expect(processed.path).toBe('αρχείο.txt');
    });
  });

  describe('Unicode paths with webkitRelativePath', () => {
    it('should handle unicode folder names', async () => {
      const file = new File(['content'], 'file.txt', { type: 'text/plain' });
      Object.defineProperty(file, 'webkitRelativePath', {
        value: '日本語フォルダ/file.txt',
        writable: false,
      });

      const processed = await createProcessedFile(file);

      expect(processed.path).toBe('日本語フォルダ/file.txt');
      expect(processed.name).toBe('file.txt');
    });

    it('should handle deeply nested unicode paths', async () => {
      const file = new File(['content'], '文件.txt', { type: 'text/plain' });
      Object.defineProperty(file, 'webkitRelativePath', {
        value: '项目/源代码/组件/文件.txt',
        writable: false,
      });

      const processed = await createProcessedFile(file);

      expect(processed.path).toBe('项目/源代码/组件/文件.txt');
      expect(processed.name).toBe('文件.txt');
    });

    it('should handle emoji in folder names', async () => {
      const file = new File(['content'], 'readme.md', { type: 'text/markdown' });
      Object.defineProperty(file, 'webkitRelativePath', {
        value: '📁docs/📄readme.md',
        writable: false,
      });

      const processed = await createProcessedFile(file);

      expect(processed.path).toBe('📁docs/📄readme.md');
    });
  });

  describe('stripCommonPrefix with unicode', () => {
    it('should strip common unicode prefix', async () => {
      const files = await Promise.all([
        createProcessedFile(
          Object.assign(new File(['a'], 'index.html', { type: 'text/html' }), {
            webkitRelativePath: '项目/index.html',
          }) as unknown as File
        ),
        createProcessedFile(
          Object.assign(new File(['b'], 'style.css', { type: 'text/css' }), {
            webkitRelativePath: '项目/css/style.css',
          }) as unknown as File
        ),
      ]);

      // Manually set paths since Object.assign doesn't work well with File
      files[0] = { ...files[0], path: '项目/index.html' };
      files[1] = { ...files[1], path: '项目/css/style.css' };

      const stripped = stripCommonPrefix(files);

      expect(stripped[0].path).toBe('index.html');
      expect(stripped[1].path).toBe('css/style.css');
    });
  });

  describe('filterJunk with unicode', () => {
    it('should not filter valid unicode filenames', () => {
      const paths = [
        '文件.txt',
        'файл.js',
        '🔥emoji.html',
        'café.css',
      ];

      const filtered = filterJunk(paths);

      expect(filtered).toEqual(paths);
    });

    it('should still filter junk files in unicode folders', () => {
      const paths = [
        '日本語/.DS_Store',
        '日本語/index.html',
        '日本語/Thumbs.db',
        '日本語/app.js',
      ];

      const filtered = filterJunk(paths);

      expect(filtered).toEqual([
        '日本語/index.html',
        '日本語/app.js',
      ]);
    });
  });

  describe('getMimeType with unicode extensions', () => {
    it('should detect MIME type from unicode filename', () => {
      expect(getMimeType('文件.html')).toBe('text/html');
      expect(getMimeType('файл.css')).toBe('text/css');
      expect(getMimeType('αρχείο.js')).toBe('application/javascript');
      expect(getMimeType('🔥fire🔥.json')).toBe('application/json');
    });
  });

  describe('Edge case filenames', () => {
    it('should handle very long unicode filenames', async () => {
      const longName = '这是一个非常长的文件名'.repeat(10) + '.txt';
      const file = new File(['content'], longName, { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe(longName);
    });

    it('should handle filenames with spaces', async () => {
      const file = new File(['content'], 'my file name.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('my file name.txt');
      expect(processed.path).toBe('my file name.txt');
    });

    it('should handle filenames with multiple dots', async () => {
      const file = new File(['content'], 'archive.tar.gz', { type: 'application/gzip' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('archive.tar.gz');
    });

    it('should handle hidden files (dot prefix)', async () => {
      const file = new File(['content'], '.gitignore', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('.gitignore');
      expect(processed.path).toBe('.gitignore');
    });

    it('should handle filenames with underscores and hyphens', async () => {
      const file = new File(['content'], 'my_file-name_v2.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('my_file-name_v2.txt');
    });

    it('should handle filenames with numbers only', async () => {
      const file = new File(['content'], '12345.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('12345.txt');
    });

    it('should handle filenames with mixed case', async () => {
      const file = new File(['content'], 'MyFile.TXT', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('MyFile.TXT');
    });

    it('should handle zero-width characters (potential security issue)', async () => {
      // Zero-width space: \u200B
      const file = new File(['content'], 'file\u200Bname.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      // The file should be processed - validation happens elsewhere
      expect(processed.name).toBe('file\u200Bname.txt');
    });

    it('should handle right-to-left override character', async () => {
      // RLO: \u202E - this is a security concern but processing should still work
      const file = new File(['content'], 'file\u202Ename.txt', { type: 'text/plain' });
      const processed = await createProcessedFile(file);

      expect(processed.name).toBe('file\u202Ename.txt');
    });
  });
});
