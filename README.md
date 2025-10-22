# @shipstatic/drop

**Headless file processing toolkit for Ship SDK deployments**

A focused React hook for preparing files for deployment with [@shipstatic/ship](https://github.com/shipstatic/ship). Handles ZIP extraction, path normalization, and validation - everything needed before calling `ship.deploy()`.

**Note:** MD5 calculation is handled by Ship SDK during deployment. Drop focuses on file processing and UI state management.

## Why Headless?

This package provides **zero UI components**. You build the dropzone that fits your needs. Why?

1. **Folder structure matters** - Proper folder drag-and-drop requires modern browser APIs (`File System Access API`, `webkitGetAsEntry`) that generic dropzone libraries don't support
2. **Full control** - Your UI, your styling, your UX patterns
3. **Smaller bundle** - No React components, no extra dependencies (~14KB saved vs generic libraries)
4. **Ship SDK integration** - Purpose-built for Ship deployments, not a generic file upload library

The package focuses on what's hard (ZIP extraction, folder structure preservation) and leaves what's easy (UI) to you.

## Features

- 🎯 **Headless Architecture** - Just the hook, no UI opinions
- 📦 **ZIP Support** - Automatic ZIP file extraction and processing
- ✅ **Validation** - Client-side file size, count, and total size validation (powered by Ship SDK)
- 🗑️ **Junk Filtering** - Automatically filters `.DS_Store`, `Thumbs.db`, etc. (powered by Ship SDK)
- 🔒 **Path Sanitization** - Defense-in-depth protection against directory traversal attacks
- 📁 **Folder Structure Preservation** - Respects `webkitRelativePath` for proper deployment paths
- 🚀 **Focused Scope** - File processing and UI state only. MD5 calculation and deployment handled by Ship SDK

## Installation

```bash
npm install @shipstatic/drop
# or
pnpm add @shipstatic/drop
```

## Quick Start

```tsx
import { useDrop } from '@shipstatic/drop';
import Ship from '@shipstatic/ship';

const ship = new Ship({ deployToken: 'token-xxxx' });

function MyUploader() {
  const drop = useDrop({
    ship  // Pass Ship instance - Drop uses ship.getConfig() for validation
  });

  const handleUpload = async () => {
    const validFiles = drop.getValidFiles();

    // ProcessedFile extends StaticFile - no conversion needed!
    await ship.deployments.create(validFiles.map(f => f.file));
  };

  return (
    <div>
      <input
        type="file"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          drop.processFiles(files);
        }}
      />

      <p>{drop.statusText}</p>

      {drop.files.map(file => (
        <div key={file.id}>
          {file.name} - {file.status}
        </div>
      ))}

      <button
        onClick={handleUpload}
        disabled={drop.getValidFiles().length === 0}
      >
        Upload {drop.getValidFiles().length} files
      </button>
    </div>
  );
}
```

### ⚠️ Configuration Architecture

**Drop uses Ship's validation config automatically:**

Drop accepts a `Ship` instance and uses `ship.getConfig()` internally. This ensures:
- ✅ **Single source of truth** - Validation config comes from Ship SDK
- ✅ **Always in sync** - Client validation matches server limits
- ✅ **No manual config fetching** - Drop handles it internally
- ✅ **Simpler API** - Just pass `ship` instance

```tsx
// Drop fetches config from Ship SDK automatically
const drop = useDrop({ ship });

// Behind the scenes:
// 1. Ship SDK fetches /config on initialization
// 2. Drop calls ship.getConfig() when validating
// 3. Validation always uses current server limits
```

**Why this architecture:**
- Drop has NO validation rules of its own - it's a pure proxy
- Ship SDK is the single source of truth for validation
- Drop only provides what Ship doesn't have (ZIP, React state, folder structure)

## Building Your Drop Zone with Folder Support

For production use, you'll want to support folder drag-and-drop using modern browser APIs. Here's a complete example:

```tsx
import { useState } from 'react';
import { useDrop } from '@shipstatic/drop';

function MyDeployUI() {
  const drop = useDrop();
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);

    // Extract files with folder structure preserved
    const files = await extractFilesWithStructure(e.dataTransfer);
    drop.processFiles(files);
  };

  const extractFilesWithStructure = async (
    dataTransfer: DataTransfer
  ): Promise<File[]> => {
    const files: File[] = [];
    const items = dataTransfer.items;

    if (!items) return Array.from(dataTransfer.files);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        await processDataTransferItem(item, files);
      }
    }

    return files.length > 0 ? files : Array.from(dataTransfer.files);
  };

  const processDataTransferItem = async (
    item: DataTransferItem,
    files: File[]
  ): Promise<void> => {
    // Try modern File System Access API first (Chrome 86+)
    if (
      globalThis.isSecureContext &&
      typeof (item as any).getAsFileSystemHandle === 'function'
    ) {
      try {
        const handle = await (item as any).getAsFileSystemHandle();
        if (handle) {
          await processFileSystemHandle(handle, files, '');
          return;
        }
      } catch (err) {
        // Fall through to webkit API
      }
    }

    // Fallback to webkitGetAsEntry (broader browser support)
    const entry = (item as any).webkitGetAsEntry?.();
    if (entry) {
      await processEntry(entry, files, '');
    }
  };

  const processFileSystemHandle = async (
    handle: any,
    files: File[],
    basePath: string
  ): Promise<void> => {
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      // Set webkitRelativePath for Ship SDK compatibility
      Object.defineProperty(file, 'webkitRelativePath', {
        value: basePath + file.name,
        writable: false,
        enumerable: true,
        configurable: true,
      });
      files.push(file);
    } else if (handle.kind === 'directory') {
      const dirPath = basePath + handle.name + '/';
      for await (const entry of handle.values()) {
        await processFileSystemHandle(entry, files, dirPath);
      }
    }
  };

  const processEntry = async (
    entry: any,
    files: File[],
    basePath: string
  ): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        entry.file(resolve, reject);
      });
      // Set webkitRelativePath for Ship SDK compatibility
      Object.defineProperty(file, 'webkitRelativePath', {
        value: basePath + entry.name,
        writable: false,
        enumerable: true,
        configurable: true,
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const entries = await new Promise<any[]>((resolve, reject) => {
        dirReader.readEntries(resolve, reject);
      });

      for (const childEntry of entries) {
        await processEntry(childEntry, files, basePath + entry.name + '/');
      }
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={handleDrop}
      className={isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}
    >
      {drop.isProcessing ? (
        <p>Processing {drop.files.length} files...</p>
      ) : (
        <p>Drag & drop files or folders here</p>
      )}

      {drop.validationError && (
        <div className="text-red-600">{drop.validationError.details}</div>
      )}
    </div>
  );
}
```

### Why This Approach?

- ✅ **Preserves folder structure** via `webkitRelativePath`
- ✅ **Uses modern File System Access API** (no permission prompts in Chrome 86+)
- ✅ **Fallback to webkit APIs** for broader browser support (Safari, Firefox)
- ✅ **You control every aspect** of the UI and UX

## API

### `useDrop(options?)`

Main hook for managing drop state.

**Options:**

```typescript
interface DropOptions {
  /** Ship SDK instance (required for validation) */
  ship: Ship;
  /** Callback when validation fails */
  onValidationError?: (error: ClientError) => void;
  /** Callback when files are ready for upload */
  onFilesReady?: (files: ProcessedFile[]) => void;
  /** Whether to strip common directory prefix from paths (default: true) */
  stripPrefix?: boolean;
}
```

**Returns:**

```typescript
interface DropReturn {
  /** All processed files with their status */
  files: ProcessedFile[];
  /** Current status text */
  statusText: string;
  /** Whether currently processing files (ZIP extraction, etc.) */
  isProcessing: boolean;
  /** Last validation error if any */
  validationError: ClientError | null;

  /** Process files from drop (resets and replaces existing files) */
  processFiles: (files: File[]) => Promise<void>;
  /** Clear all files and reset state */
  clearAll: () => void;
  /** Get only valid files ready for upload */
  getValidFiles: () => ProcessedFile[];
  /** Update upload state for a specific file (status, progress, message) */
  updateFileStatus: (fileId: string, state: {
    status: FileStatus;
    statusMessage?: string;
    progress?: number;
  }) => void;
}
```

## Error Handling

### Per-File Error Display

Each file in the `files` array contains its own `status` and `statusMessage`, allowing you to display granular errors for individual files:

```tsx
function FileList({ drop }) {
  return (
    <div>
      {drop.files.map(file => (
        <div key={file.id}>
          <span>{file.path}</span>

          {/* Show status indicator */}
          {file.status === 'ready' ? '✓' : '✗'}

          {/* Show per-file error message */}
          {file.status !== 'ready' && file.statusMessage && (
            <span style={{ color: 'red' }}>
              {file.statusMessage}
            </span>
          )}
        </div>
      ))}

      {/* If validation fails, allow user to clear all and try again */}
      {drop.validationError && (
        <button onClick={drop.clearAll}>
          Clear All & Try Again
        </button>
      )}
    </div>
  );
}
```

**Common error statuses:**
- `validation_failed` - File failed validation (size, type, name, etc.)
- `processing_error` - MD5 calculation or processing failed
- `empty_file` - File is 0 bytes
- `ready` - File passed all validation and is ready for upload

### Validation Error Summary

The `validationError` provides a summary when any files fail validation:

```tsx
{drop.validationError && (
  <div>
    <p>{drop.validationError.error}</p>
    <p>{drop.validationError.details}</p>
  </div>
)}
```

**Atomic Validation**: If ANY file fails validation, ALL files are marked as `validation_failed`. This ensures deployments are all-or-nothing for data integrity. The Ship SDK follows this same pattern server-side.

### No Individual File Removal

The Drop package **intentionally does not support removing individual files**. Here's why:

**Reason:** Ship SDK uses **atomic validation** - if ANY file fails validation, ALL files are marked as `validation_failed`. This ensures deployments are all-or-nothing for data integrity.

**The Problem with Individual Removal:**
```tsx
// User drops 5 files, 1 is too large
// Atomic validation: ALL 5 files marked as validation_failed

// If we allowed removing the large file:
drop.removeFile(largeFileId); // ❌ We don't support this!

// Would need to re-validate remaining 4 files
// Creates complexity and race conditions
```

**The Simple Solution:**
Use `clearAll()` to reset and try again:

```tsx
// If validation fails, show user which files failed
{drop.validationError && (
  <div>
    <p>Validation failed. Please fix the issues and try again:</p>
    {drop.files.map(file => (
      <div key={file.id}>
        {file.path}: {file.statusMessage}
      </div>
    ))}
    <button onClick={drop.clearAll}>Clear All & Try Again</button>
  </div>
)}
```

**Benefits:**
- ✅ No race conditions or stale validation state
- ✅ Simpler mental model (atomic = all-or-nothing)
- ✅ Aligns with Ship SDK's validation philosophy
- ✅ Clear UX: fix the problem, then re-drop

## Types

```typescript
/**
 * ProcessedFile extends StaticFile from @shipstatic/types
 * This means it can be passed directly to ship.deployments.create()
 *
 * Note: md5 is intentionally undefined - Ship SDK calculates it during deployment
 */
interface ProcessedFile extends StaticFile {
  // StaticFile properties (SDK compatibility)
  content: File;        // File object (required by SDK)
  path: string;         // Normalized path (webkitRelativePath or file.name)
  size: number;         // File size in bytes
  md5?: string;         // Undefined - Ship SDK calculates during deployment

  // ProcessedFile-specific properties (UI functionality)
  id: string;           // Unique identifier for React keys
  file: File;           // Alias for 'content' (better DX)
  name: string;         // File name without path
  type: string;         // MIME type
  lastModified: number;
  status: FileStatus;
  statusMessage?: string;  // Per-file error message
  progress?: number;       // Upload progress (0-100)
}

interface ClientError {
  error: string;
  details: string;
  isClientError: true;
}

type FileStatus =
  | 'pending'
  | 'ready'
  | 'uploading'
  | 'complete'
  | 'processing_error'
  | 'error'
  | 'validation_failed'
  | 'empty_file';
```

## Direct Ship SDK Integration

**ProcessedFile extends StaticFile** - no conversion needed! Since `ProcessedFile` extends `StaticFile` from `@shipstatic/types`, you can pass the files directly to the Ship SDK:

```typescript
const validFiles = drop.getValidFiles();

// ProcessedFile[] IS StaticFile[] - pass directly!
await ship.deployments.create({ files: validFiles });
```

### Type Compatibility

```typescript
// ✅ This works because ProcessedFile extends StaticFile
interface ProcessedFile extends StaticFile {
  content: File;   // Required by StaticFile
  path: string;    // Required by StaticFile
  size: number;    // Required by StaticFile
  md5?: string;    // Required by StaticFile

  // Additional UI properties
  id: string;
  file: File;      // Alias for 'content' (better DX)
  name: string;
  type: string;
  status: FileStatus;
  // ... etc
}
```

**Important**: The drop hook preserves folder structure via `webkitRelativePath` and processes paths with `stripCommonPrefix` automatically. The `path` property is always deployment-ready.

## Architecture Decisions

### Why Drop Doesn't Calculate MD5

**Design Philosophy:** Drop should only provide what Ship SDK doesn't have.

**What Drop provides:**
- ✅ ZIP extraction (Ship SDK doesn't have this)
- ✅ React state management (Ship SDK doesn't have this)
- ✅ Folder structure preservation (UI-specific concern)
- ✅ Path normalization (UI-specific concern)

**What Ship SDK provides:**
- ✅ MD5 calculation (already implemented)
- ✅ Validation (already implemented)
- ✅ Deployment (core functionality)

**Why this matters:**
- Avoids duplicate MD5 calculation (performance)
- Single source of truth for deployment logic
- Drop stays focused on UI concerns
- Ship SDK handles all deployment concerns

**StaticFile.md5 is optional** - Ship SDK calculates it during deployment if not provided.

### Why Not Abstract?

This package was extracted from the `web/drop` application and is purpose-built for Ship SDK. Key decisions:

**1. Focused on UI Concerns**
- ZIP extraction for user convenience
- File list state management for React UIs
- Folder structure preservation from drag-and-drop
- Path normalization for clean URLs
- These are UI/UX concerns, not deployment logic

**2. Loosely Coupled Integration Pattern**
Following industry standards (Firebase hooks, Supabase utilities), we chose:
- ✅ **Decoupled**: No Ship SDK dependency in this package
- ✅ **Simple**: Direct `File[]` input/output
- ✅ **Testable**: No mocking of Ship SDK needed
- ✅ **Flexible**: Host app controls WHEN to deploy

Instead of:
- ❌ Passing Ship SDK instance to useDrop
- ❌ React Context provider pattern
- ❌ Global configuration singleton

**3. Type System Integration**

ProcessedFile extends StaticFile from `@shipstatic/types` - the single source of truth for Ship SDK types:

```
File[] → ProcessedFile[] (which IS StaticFile[]) → ship.deployments.create()
```

No conversion needed. ProcessedFile adds UI-specific properties (id, name, status, progress) to StaticFile's base properties (content, path, size, md5).

**4. No UI Components**

We deliberately don't provide drop zone UI components because:
- Generic drop zone libraries (like `react-dropzone`) don't support folder structure preservation
- Proper folder drag-and-drop requires modern browser APIs that need custom implementation
- Your deployment UI is unique to your application
- Providing a component that "works but loses paths" would be misleading

### Error Handling Philosophy

All errors are surfaced at the per-file level:
- Each file has its own `status` and `statusMessage` property
- Processing errors (e.g., ZIP extraction failures) are marked with `status: 'processing_error'`
- Validation failures are marked with `status: 'validation_failed'`
- The `statusMessage` always contains specific error details
- Failed files are excluded from `getValidFiles()` and cannot be deployed
- No silent failures - all errors are visible to users

See the [Error Handling](#error-handling) section for examples of displaying per-file errors in your UI.

### Security

**Path Sanitization**: ZIP extraction includes defense-in-depth protection against directory traversal attacks:
- Normalizes all file paths by removing `..`, `.`, and empty segments
- Prevents traversal above the root directory
- Converts absolute paths to relative paths
- Skips files that resolve to empty paths after normalization
- Comprehensive test coverage for various attack vectors

While the Ship SDK validates paths server-side, client-side sanitization provides an additional security layer and prevents malicious paths from ever reaching the server.

**Concurrency Protection**: The `processFiles` function includes built-in race condition protection:
- Uses a synchronous ref guard to prevent concurrent processing
- Automatically ignores duplicate calls while processing is in progress
- Logs warnings when concurrent calls are detected
- Ensures the processing flag is always cleared, even on errors
- Makes the hook robust regardless of UI implementation

## License

MIT
