import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDrop } from '@/hooks/useDrop';
import { FILE_STATUSES } from '@/types';
import type { Ship } from '@shipstatic/ship';

// Mock @shipstatic/ship
const mockGetConfig = vi.fn();
const mockValidateFiles = vi.fn();

// Mock @shipstatic/ship
vi.mock('@shipstatic/ship', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shipstatic/ship')>();
    return {
        ...actual,
        validateFiles: (...args: any[]) => mockValidateFiles(...args),
        formatFileSize: actual.formatFileSize,
        getValidFiles: actual.getValidFiles,
        filterJunk: actual.filterJunk,
    };
});

// Helper to create mock Ship instance
const createMockShip = (): Ship => ({
    getConfig: mockGetConfig,
} as any);

// Mock FileSystemEntry and related interfaces
interface MockEntry {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    file?: (success: (f: File) => void) => void;
    createReader?: () => { readEntries: (success: (entries: MockEntry[]) => void) => void };
}

const createMockFileEntry = (name: string, content: string = ''): MockEntry => ({
    isFile: true,
    isDirectory: false,
    name,
    file: (success) => success(new File([content], name)),
});

const createMockDirectoryEntry = (name: string, children: MockEntry[]): MockEntry => {
    let called = false;
    return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: () => ({
            readEntries: (success) => {
                if (!called) {
                    called = true;
                    success(children);
                } else {
                    success([]);
                }
            },
        }),
    };
};

describe('useDrop - Reproduction Issue', () => {
    beforeEach(() => {
        mockGetConfig.mockResolvedValue({
            maxFileSize: 10 * 1024 * 1024,
            maxTotalSize: 100 * 1024 * 1024,
            maxFilesCount: 1000,
            allowedMimeTypes: ['text/', 'application/', 'image/'],
        });

        mockValidateFiles.mockImplementation((files) => ({
            files: files.map((f: any) => ({ ...f, status: FILE_STATUSES.READY })),
            validFiles: files.map((f: any) => ({ ...f, status: FILE_STATUSES.READY })),
            error: null,
        }));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should handle mixed files and folders drop correctly', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // Simulate dropping: index.html, robots.txt, assets/ (containing style.css)
        const indexEntry = createMockFileEntry('index.html');
        const robotsEntry = createMockFileEntry('robots.txt');
        const styleEntry = createMockFileEntry('style.css');
        const assetsEntry = createMockDirectoryEntry('assets', [styleEntry]);

        const mockDataTransferItems = [
            {
                kind: 'file',
                webkitGetAsEntry: () => indexEntry,
                getAsFile: () => new File([''], 'index.html')
            },
            {
                kind: 'file',
                webkitGetAsEntry: () => robotsEntry,
                getAsFile: () => new File([''], 'robots.txt')
            },
            {
                kind: 'file',
                webkitGetAsEntry: () => assetsEntry,
                getAsFile: () => null // Directory
            },
        ];

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                items: mockDataTransferItems,
                files: [], // Fallback not used when items are present
            },
        };

        const { onDrop } = result.current.getDropzoneProps();

        await act(async () => {
            await onDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(result.current.isProcessing).toBe(false);
        });

        const files = result.current.files;
        const paths = files.map(f => f.path).sort();

        console.log('Resulting paths:', paths);

        expect(paths).toEqual([
            'assets/style.css',
            'index.html',
            'robots.txt',
        ]);
    });

    it('should handle mixed files and folders drop correctly with nested structures', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // Simulate dropping:
        // - index.html
        // - assets/
        //   - style.css
        //   - images/
        //     - logo.png

        const indexEntry = createMockFileEntry('index.html');
        const styleEntry = createMockFileEntry('style.css');
        const logoEntry = createMockFileEntry('logo.png');

        const imagesEntry = createMockDirectoryEntry('images', [logoEntry]);
        const assetsEntry = createMockDirectoryEntry('assets', [styleEntry, imagesEntry]);

        const mockDataTransferItems = [
            {
                kind: 'file',
                webkitGetAsEntry: () => indexEntry,
                getAsFile: () => new File([''], 'index.html')
            },
            {
                kind: 'file',
                webkitGetAsEntry: () => assetsEntry,
                getAsFile: () => null
            },
        ];

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                items: mockDataTransferItems,
                files: [],
            },
        };

        const { onDrop } = result.current.getDropzoneProps();

        await act(async () => {
            await onDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(result.current.isProcessing).toBe(false);
        });

        const files = result.current.files;
        const paths = files.map(f => f.path).sort();

        console.log('Resulting paths:', paths);

        expect(paths).toEqual([
            'assets/images/logo.png',
            'assets/style.css',
            'index.html',
        ]);
    });
    it('should fallback to getAsFile when webkitGetAsEntry returns null', async () => {
        const ship = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // Simulate dropping:
        // - regular-file.txt (webkitGetAsEntry works)
        // - problem-file.txt (webkitGetAsEntry returns null)

        const regularEntry = createMockFileEntry('regular-file.txt');
        const problemFile = new File(['content'], 'problem-file.txt');

        const mockDataTransferItems = [
            {
                kind: 'file',
                webkitGetAsEntry: () => regularEntry,
                getAsFile: () => new File(['content'], 'regular-file.txt')
            },
            {
                kind: 'file',
                webkitGetAsEntry: () => null, // Simulate failure
                getAsFile: () => problemFile  // Fallback should use this
            },
        ];

        const mockEvent = {
            preventDefault: vi.fn(),
            dataTransfer: {
                items: mockDataTransferItems,
                files: [],
            },
        };

        const { onDrop } = result.current.getDropzoneProps();

        await act(async () => {
            await onDrop(mockEvent as any);
        });

        await waitFor(() => {
            expect(result.current.isProcessing).toBe(false);
        });

        const files = result.current.files;
        const paths = files.map(f => f.path).sort();

        console.log('Resulting paths:', paths);

        expect(paths).toEqual([
            'problem-file.txt',
            'regular-file.txt',
        ]);
    });
});
