# @shipstatic/assets

**Headless file processing toolkit for Ship SDK deployments**

A focused React hook for preparing files for deployment with [@shipstatic/ship](https://github.com/shipstatic/ship). Handles ZIP extraction, MD5 calculation, path normalization, and validation - everything needed before calling `ship.deploy()`.

## Why Headless?

This package provides **zero UI components**. You build the dropzone that fits your needs. Why?

1. **Folder structure matters** - Proper folder drag-and-drop requires modern browser APIs (`File System Access API`, `webkitGetAsEntry`) that generic dropzone libraries don't support
2. **Full control** - Your UI, your styling, your UX patterns
3. **Smaller bundle** - No React components, no extra dependencies (~14KB saved vs generic libraries)
4. **Ship SDK integration** - Purpose-built for Ship deployments, not a generic file upload library

The package focuses on what's hard (ZIP extraction, MD5 calculation, validation) and leaves what's easy (UI) to you.

## Features

- 🎯 **Headless Architecture** - Just the hook, no UI opinions
- 📦 **ZIP Support** - Automatic ZIP file extraction and processing
- ✅ **Validation** - Client-side file size, count, and total size validation
- 🗑️ **Junk Filtering** - Automatically filters `.DS_Store`, `Thumbs.db`, etc.
- 🔍 **MD5 Hashing** - Calculates MD5 checksums for all files
- 🔒 **Path Sanitization** - Defense-in-depth protection against directory traversal attacks
- 📁 **Folder Structure Preservation** - Respects `webkitRelativePath` for proper deployment paths
- 🚀 **SDK Agnostic** - Works with any upload SDK (Ship, AWS S3, etc.)

## Installation

```bash
npm install @shipstatic/assets
# or
pnpm add @shipstatic/assets
```

## Quick Start

```tsx
import { useDropzoneManager } from '@shipstatic/assets';
import Ship from '@shipstatic/ship';

function MyUploader() {
  const ship = new Ship({ apiUrl: '...' });

  // Get validation config from Ship SDK
  const config = await ship.getConfig();

  const dropzone = useDropzoneManager({
    config  // Pass SDK config directly
  });

  const handleUpload = async () => {
    const validFiles = dropzone.getValidFiles();

    // ProcessedFile extends StaticFile - no conversion needed!
    await ship.deployments.create({ files: validFiles });
  };

  return (
    <div>
      <input
        type="file"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          dropzone.processFiles(files);
        }}
      />

      <p>{dropzone.statusText}</p>

      {dropzone.files.map(file => (
        <div key={file.id}>
          {file.name} - {file.status}
        </div>
      ))}

      <button
        onClick={handleUpload}
        disabled={dropzone.getValidFiles().length === 0}
      >
        Upload {dropzone.getValidFiles().length} files
      </button>
    </div>
  );
}
```

## Building Your Dropzone with Folder Support

For production use, you'll want to support folder drag-and-drop using modern browser APIs. Here's a complete example:

```tsx
import { useState } from 'react';
import { useDropzoneManager } from '@shipstatic/assets';

function MyDeployUI() {
  const dropzone = useDropzoneManager();
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);

    // Extract files with folder structure preserved
    const files = await extractFilesWithStructure(e.dataTransfer);
    dropzone.processFiles(files);
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
      {dropzone.isProcessing ? (
        <p>Processing {dropzone.files.length} files...</p>
      ) : (
        <p>Drag & drop files or folders here</p>
      )}

      {dropzone.validationError && (
        <div className="text-red-600">{dropzone.validationError.details}</div>
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

### `useDropzoneManager(options?)`

Main hook for managing dropzone state.

**Options:**

```typescript
interface DropzoneManagerOptions {
  /** Validation configuration (from ship.getConfig()) */
  config?: Partial<ValidationConfig>;
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
interface DropzoneManagerReturn {
  /** All processed files with their status */
  files: ProcessedFile[];
  /** Current status text */
  statusText: string;
  /** Whether currently processing files (ZIP extraction, etc.) */
  isProcessing: boolean;
  /** Last validation error if any */
  validationError: ClientError | null;
  /** Whether all valid files have MD5 checksums calculated */
  hasChecksums: boolean;

  /** Process files from dropzone (resets and replaces existing files) */
  processFiles: (files: File[]) => Promise<void>;
  /** Remove a specific file */
  removeFile: (fileId: string) => void;
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

## Types

```typescript
/**
 * ProcessedFile extends StaticFile from @shipstatic/types
 * This means it can be passed directly to ship.deployments.create()
 */
interface ProcessedFile extends StaticFile {
  // StaticFile properties (SDK compatibility)
  content: File;        // File object (required by SDK)
  path: string;         // Normalized path (webkitRelativePath or file.name)
  size: number;         // File size in bytes
  md5?: string;         // Pre-calculated MD5 checksum

  // ProcessedFile-specific properties (UI functionality)
  id: string;           // Unique identifier for React keys
  file: File;           // Alias for 'content' (better DX)
  name: string;         // File name without path
  type: string;         // MIME type
  lastModified: number;
  status: FileStatus;
  statusMessage?: string;
  progress?: number;    // Upload progress (0-100)
}

/**
 * ValidationConfig is an alias to ConfigResponse from @shipstatic/types
 * Use ship.getConfig() to get the exact validation limits from the server
 */
interface ValidationConfig {
  maxFileSize: number;      // Default: 5MB
  maxTotalSize: number;     // Default: 25MB
  maxFilesCount: number;    // Default: 100
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
const validFiles = dropzone.getValidFiles();

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

**Important**: The dropzone preserves folder structure via `webkitRelativePath` and processes paths with `stripCommonPrefix` automatically. The `path` property is always deployment-ready.

## Architecture Decisions

### Why Not Abstract?

This package was extracted from the `web/drop` application and is purpose-built for Ship SDK. Key decisions:

**1. Tightly Coupled to Ship SDK Requirements**
- MD5 calculation is **mandatory** (Ship SDK requires it for integrity checks)
- Common prefix stripping is **mandatory** (ensures clean deployment paths)
- Folder structure preservation is **mandatory** (via `webkitRelativePath`)
- These aren't optional features - they're essential for Ship deployments

**2. Loosely Coupled Integration Pattern**
Following industry standards (Firebase hooks, Supabase utilities), we chose:
- ✅ **Decoupled**: No Ship SDK dependency in this package
- ✅ **Simple**: Direct `File[]` input/output
- ✅ **Testable**: No mocking of Ship SDK needed
- ✅ **Flexible**: Host app controls WHEN to deploy

Instead of:
- ❌ Passing Ship SDK instance to useDropzoneManager
- ❌ React Context provider pattern
- ❌ Global configuration singleton

**3. Type System Integration**

ProcessedFile extends StaticFile from `@shipstatic/types` - the single source of truth for Ship SDK types:

```
File[] → ProcessedFile[] (which IS StaticFile[]) → ship.deployments.create()
```

No conversion needed. ProcessedFile adds UI-specific properties (id, name, status, progress) to StaticFile's base properties (content, path, size, md5).

**4. No UI Components**

We deliberately don't provide dropzone UI components because:
- Generic dropzone libraries (like `react-dropzone`) don't support folder structure preservation
- Proper folder drag-and-drop requires modern browser APIs that need custom implementation
- Your deployment UI is unique to your application
- Providing a component that "works but loses paths" would be misleading

### Error Handling

MD5 calculation failures are properly handled:
- Files with failed MD5 calculation are marked with `status: PROCESSING_ERROR`
- The `statusMessage` contains the specific error details
- These files are excluded from `getValidFiles()` and cannot be deployed
- No silent failures - all errors are visible to users

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
