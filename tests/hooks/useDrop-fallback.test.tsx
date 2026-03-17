/**
 * Regression tests for useDrop edge cases and bug fixes
 *
 * These tests document specific issues that were discovered and fixed.
 * Each test should include context about what scenario it covers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDrop } from '@/hooks/useDrop';
import {
    createMockShip,
    createPassingValidation,
    createMockFileEntry,
    createMockDirectoryEntry,
    createMockDataTransferItem,
    createMockDragEvent,
} from '../test-utils';

// Module-scoped mock functions (referenced by vi.mock — cannot be moved to shared utils)
const mockValidateFiles = vi.fn();

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

/**
 * Regression: Mixed file and folder drag-and-drop
 *
 * Issue: When users drag both files AND folders together (e.g., index.html + assets/),
 * the path handling was inconsistent. Files at root level would get incorrect paths
 * while folder contents were processed correctly.
 *
 * Root cause: webkitGetAsEntry returns FileSystemEntry for both files and folders,
 * but the path construction logic didn't account for root-level files properly.
 *
 * These tests verify that mixed drops work correctly with proper path preservation.
 */
describe('useDrop - Mixed File/Folder Drop Regression', () => {
    beforeEach(() => {
        mockValidateFiles.mockImplementation(createPassingValidation());
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should handle mixed files and folders drop correctly', async () => {
        const { ship } = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // Simulate dropping: index.html, robots.txt, assets/ (containing style.css)
        const indexEntry = createMockFileEntry('index.html');
        const robotsEntry = createMockFileEntry('robots.txt');
        const styleEntry = createMockFileEntry('style.css');
        const assetsEntry = createMockDirectoryEntry('assets', [styleEntry]);

        const mockEvent = createMockDragEvent({
            items: [
                createMockDataTransferItem(indexEntry, new File([''], 'index.html')),
                createMockDataTransferItem(robotsEntry, new File([''], 'robots.txt')),
                createMockDataTransferItem(assetsEntry, null),
            ],
        });

        const { onDrop } = result.current.getDropzoneProps();

        await act(async () => {
            await onDrop(mockEvent);
        });

        await waitFor(() => {
            expect(result.current.isProcessing).toBe(false);
        });

        const paths = result.current.files.map(f => f.path).sort();

        expect(paths).toEqual([
            'assets/style.css',
            'index.html',
            'robots.txt',
        ]);
    });

    it('should handle mixed files and folders drop correctly with nested structures', async () => {
        const { ship } = createMockShip();
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

        const mockEvent = createMockDragEvent({
            items: [
                createMockDataTransferItem(indexEntry, new File([''], 'index.html')),
                createMockDataTransferItem(assetsEntry, null),
            ],
        });

        const { onDrop } = result.current.getDropzoneProps();

        await act(async () => {
            await onDrop(mockEvent);
        });

        await waitFor(() => {
            expect(result.current.isProcessing).toBe(false);
        });

        const paths = result.current.files.map(f => f.path).sort();

        expect(paths).toEqual([
            'assets/images/logo.png',
            'assets/style.css',
            'index.html',
        ]);
    });
    /**
     * Regression: webkitGetAsEntry fallback
     *
     * Issue: Some browsers/scenarios return null from webkitGetAsEntry even for valid files.
     * The code must fall back to getAsFile() in these cases to avoid losing files.
     *
     * This can happen with certain file types, browser extensions, or security policies.
     */
    it('should fallback to getAsFile when webkitGetAsEntry returns null', async () => {
        const { ship } = createMockShip();
        const { result } = renderHook(() => useDrop({ ship }));

        // Simulate dropping:
        // - regular-file.txt (webkitGetAsEntry works)
        // - problem-file.txt (webkitGetAsEntry returns null)

        const regularEntry = createMockFileEntry('regular-file.txt');
        const problemFile = new File(['content'], 'problem-file.txt');

        const mockEvent = createMockDragEvent({
            items: [
                createMockDataTransferItem(regularEntry, new File(['content'], 'regular-file.txt')),
                createMockDataTransferItem(null, problemFile),
            ],
        });

        const { onDrop } = result.current.getDropzoneProps();

        await act(async () => {
            await onDrop(mockEvent);
        });

        await waitFor(() => {
            expect(result.current.isProcessing).toBe(false);
        });

        const paths = result.current.files.map(f => f.path).sort();

        expect(paths).toEqual([
            'problem-file.txt',
            'regular-file.txt',
        ]);
    });
});
