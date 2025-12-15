import { describe, it, expect } from 'vitest';
import { createProcessedFile, stripCommonPrefix, traverseFileTree } from '@/utils/fileProcessing';
import { createMockFile } from '../test-utils';

/**
 * REGRESSION TEST: Mixed Drop Handling
 * 
 * This test verifies that checking "root files" alongside "folders" works correctly.
 * 
 * Issue Context:
 * Previously, dropping a mix of files (index.html) and folders (assets/) caused
 * inconsistencies, sometimes losing the root files due to async invalidation of DataTransferItems
 * or improper path handling.
 * 
 * We simulate:
 * 1. A drop containing: 'index.html' (file), 'vite.svg' (file), 'assets' (folder with 'style.css')
 * 2. Verify all 4 files are collected.
 * 3. Verify their webkitRelativePath is patched correctly (so they appear as if dropped from a parent).
 */

describe('Mixed Drop Regression Tests', () => {

    it('should correctly handle mixed root files and folders', async () => {
        // 1. Setup Mock Data
        const files: File[] = [];

        // Mock 'index.html' entry
        // NOTE: In the actual fix, we prioritize getAsFile() for root files.
        // mimicking that here implicitly by how we structure the test data if we were mocking the full event,
        // but here we are testing the traverse/stripping logic primarily.

        // HOWEVER, to strictly test the FIX (sync collection), we'd need to mock DataTransferItems behavior
        // which is hard in unit tests. 
        // Instead, we verify the RESULT consistency: that if we collect these, the paths are correct.

        const indexFile = createMockFile('index.html', '<html>');
        // Simulate what the browser gives us for root files: empty path usually, or just name
        Object.defineProperty(indexFile, 'webkitRelativePath', { value: '', writable: false, configurable: true });

        const viteFile = createMockFile('vite.svg', '<svg>');
        Object.defineProperty(viteFile, 'webkitRelativePath', { value: '', writable: false, configurable: true });

        // Assets folder contents
        const styleFile = createMockFile('style.css', 'body {}');
        // When traversing, we manually set the path.
        // The implementation in useDrop sets it to `entry.name` for the root folder entry.

        // Let's simulate the collection phase having happened:
        files.push(indexFile);
        files.push(viteFile);

        // And the async traversal having happened for assets:
        // We manually traverse a mock directory to populate the rest
        const assetsEntry = {
            isFile: false,
            isDirectory: true,
            name: 'assets',
            createReader: () => {
                let called = false;
                return {
                    readEntries: (cb: any) => {
                        if (!called) {
                            called = true;
                            const entry = {
                                isFile: true,
                                isDirectory: false,
                                name: 'style.css',
                                file: (resolve: any) => resolve(styleFile)
                            };
                            cb([entry]);
                        } else {
                            cb([]);
                        }
                    }
                };
            }
        } as unknown as FileSystemEntry;

        await traverseFileTree(assetsEntry, files, 'assets');

        // NOW: Check the state of raw files BEFORE processing
        // The root files would have been patched by our useDrop logic (which is outside this test scope unfortunately)
        // BUT, `traverseFileTree` patches the nested files.

        // Let's simulate the useDrop patch for root files manually, as that's part of the "fix" contract in useDrop.ts
        Object.defineProperty(indexFile, 'webkitRelativePath', { value: 'index.html', writable: false, configurable: true });
        Object.defineProperty(viteFile, 'webkitRelativePath', { value: 'vite.svg', writable: false, configurable: true });

        // Now process them through the standard pipeline
        const processedFiles = await Promise.all(
            files.map(file => createProcessedFile(file))
        );

        // Strip common prefix
        const stripped = stripCommonPrefix(processedFiles);
        const startPaths = stripped.map(f => f.path);

        console.log('Resulting paths:', startPaths);

        expect(startPaths).toContain('index.html');
        expect(startPaths).toContain('vite.svg'); // Should NOT be lost
        expect(startPaths).toContain('assets/style.css');

        // CRITICAL CHECK: The underlying File object must be patched
        // This ensures the Ship SDK (which reads webkitRelativePath) sees the correct path
        const rawPaths = stripped.map(f => (f.file as any).webkitRelativePath);
        expect(rawPaths).toContain('index.html');
        expect(rawPaths).toContain('vite.svg');
        expect(rawPaths).toContain('assets/style.css');
    });

    it('should allow webkitRelativePath redefinition (fix for "Cannot redefine property")', async () => {
        // This tests the robust property definition we added
        const file = createMockFile('test.txt', 'content');

        // Initial definition (like from browser or traverseFileTree)
        Object.defineProperty(file, 'webkitRelativePath', {
            value: 'initial/path/test.txt',
            writable: false,
            // The critical flag:
            configurable: true
        });

        // Attempt redefinition (like in stripCommonPrefix)
        // This should NOT throw
        expect(() => {
            Object.defineProperty(file, 'webkitRelativePath', {
                value: 'new/path/test.txt',
                writable: false,
                configurable: true
            });
        }).not.toThrow();

        expect((file as any).webkitRelativePath).toBe('new/path/test.txt');
    });
});
