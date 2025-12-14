# @shipstatic/drop

**Headless file processing toolkit for Ship SDK deployments**

A focused React hook for preparing files for deployment with [@shipstatic/ship](https://github.com/shipstatic/ship). Handles ZIP extraction, path normalization, and validation - everything needed before calling `ship.deploy()`.

Built-in drag & drop support with prop getters! No need to manually implement drag & drop handlers - just spread `{...drop.getDropzoneProps()}` on your container and `{...drop.getInputProps()}` on the input element. Folder structure preservation is handled automatically.

**Note:** MD5 calculation is handled by Ship SDK during deployment. Drop focuses on file processing and UI state management.

## Table of Contents

- [Why Headless?](#why-headless)
- [Features](#features)
- [Installation](#installation)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuration Architecture](#️-configuration-architecture)
- [Advanced Usage](#advanced-programmatic-file-picker)
- [API Reference](#api)
- [State Machine](#state-machine)
- [Error Handling](#error-handling)
- [Types](#types)
- [Ship SDK Integration](#direct-ship-sdk-integration)
- [Architecture Decisions](#architecture-decisions)

## Why Headless?

This package provides **zero UI components** - just a React hook with built-in drag & drop functionality. You bring your own styling.

**What you get:**
1. **Built-in drag & drop** - Proper folder support with `webkitGetAsEntry` API, all handled internally
2. **Prop getters API** - Similar to `react-dropzone`, just spread props on your elements
3. **Full styling control** - No imposed CSS, design system, or theming
4. **Ship SDK integration** - Purpose-built for Ship deployments, not a generic file upload library

**What's different from other libraries:**
- Generic dropzone libraries don't preserve folder structure properly
- We handle the complex parts (ZIP extraction, folder traversal, path normalization)
- You handle the simple parts (styling, layout, animations)

## Features

- 🎯 **Prop Getters API** - Just spread props on your elements (like `react-dropzone`)
- 🖱️ **Built-in Drag & Drop** - Automatic folder support with `webkitGetAsEntry` API
- 📦 **ZIP Support** - Automatic ZIP file extraction and processing
- ✅ **Validation** - Client-side file size, count, and total size validation (powered by Ship SDK)
- 🗑️ **Junk Filtering** - Automatically filters `.DS_Store`, `Thumbs.db`, etc. (powered by Ship SDK)
- 🔒 **Path Sanitization** - Defense-in-depth protection against directory traversal attacks
- 📁 **Folder Structure Preservation** - Proper folder paths via `webkitRelativePath`
- 🎨 **Headless UI** - No visual components, just logic and state management
- 📘 **Full TypeScript Support** - Complete type definitions with discriminated unions for state machine
- 🚀 **Focused Scope** - File processing and UI state only. MD5 calculation and deployment handled by Ship SDK

## Installation

```bash
npm install @shipstatic/drop
# or
pnpm add @shipstatic/drop
```

## Requirements

- **React**: ^18.0.0 or ^19.0.0
- **TypeScript**: Full TypeScript support with exported types
- **Browsers**: Modern browsers with support for:
  - File API (universal support)
  - DataTransfer API for drag & drop (universal support)
  - `webkitGetAsEntry` for folder uploads (Chrome, Edge, Safari 11.1+, Firefox 50+)

**Note on folder uploads**: The folder drag & drop feature uses the `webkitGetAsEntry` API. While widely supported, older browsers may only support file-by-file selection. ZIP extraction works universally as a fallback.

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
      {/* Drag & drop zone with built-in folder support */}
      <div
        {...drop.getDropzoneProps()}
        style={{
          border: '2px dashed',
          borderColor: drop.isDragging ? 'blue' : 'gray',
          padding: '40px',
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        <input {...drop.getInputProps()} />
        {drop.isDragging ? '📂 Drop here' : '📁 Click or drag files/folders'}
      </div>

      {/* Status - using state machine phase */}
      {drop.status && (
        <p>
          <strong>{drop.status.title}:</strong> {drop.status.details}
        </p>
      )}

      {/* File list */}
      {drop.files.map(file => (
        <div key={file.id}>
          {file.name} - {file.status}
        </div>
      ))}

      {/* Upload button */}
      <button
        onClick={handleUpload}
        disabled={drop.phase !== 'ready'}
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

## Advanced: Programmatic File Picker

You can programmatically trigger the file picker using the `open()` method:

```tsx
function MyUploader() {
  const drop = useDrop({ ship });

  return (
    <div>
      {/* Custom trigger button */}
      <button onClick={drop.open}>
        Select Files
      </button>

      {/* Hidden input managed by the hook */}
      <input {...drop.getInputProps()} />

      {/* Or use the dropzone */}
      <div {...drop.getDropzoneProps()}>
        Drop files here
      </div>
    </div>
  );
}
```

## Advanced: Manual File Processing

For advanced use cases, you can manually process files instead of using prop getters:

```tsx
function AdvancedUploader() {
  const drop = useDrop({ ship });

  const handleManualDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    await drop.processFiles(files);
  };

  return (
    <div onDrop={handleManualDrop}>
      {/* Custom implementation */}
    </div>
  );
}
```

**Note:** When using manual processing, you lose automatic folder structure preservation. The built-in `getDropzoneProps()` handles `webkitGetAsEntry` API internally to preserve folder paths.

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
```typescript
interface DropReturn {
  // Convenience getters (computed from state)
  /** Current phase of the state machine */
  phase: DropStateValue;
  /** Whether currently processing files (ZIP extraction, etc.) */
  isProcessing: boolean;
  /** Whether user is currently dragging over the dropzone */
  isDragging: boolean;
  /** Flattened access to files */
  files: ProcessedFile[];
  /** Flattened access to source name */
  sourceName: string;
  /** Flattened access to status */
  status: DropStatus | null;

  // Primary API: Prop getters for easy integration
  /** Get props to spread on dropzone element (handles drag & drop) */
  getDropzoneProps: () => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onClick: () => void;
  };
  /** Get props to spread on hidden file input element */
  getInputProps: () => {
    ref: React.RefObject<HTMLInputElement | null>;
    type: 'file';
    style: { display: string };
    multiple: boolean;
    webkitdirectory: string; // Note: React expects string ('') for boolean attributes
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  };

  // Actions
  /** Programmatically trigger file picker */
  open: () => void;
  /** Manually process files (for advanced usage) */
  processFiles: (files: File[]) => Promise<void>;
  /** Clear all files and reset state */
  clearAll: () => void;

  // Helpers
  /** Get only valid files ready for upload */
  getValidFiles: () => ProcessedFile[];
  /** Update upload state for a specific file (status, progress, message) */
  updateFileStatus: (fileId: string, state: {
    status: FileStatus;
    statusMessage?: string;
    progress?: number;
  }) => void;
}

// State machine types
type DropStateValue =
  | 'idle'       // The hook is ready for files
  | 'dragging'   // The user is dragging files over the dropzone
  | 'processing' // Files are being validated and processed
  | 'ready'      // Files are valid and ready for deployment
  | 'error';     // An error occurred during processing

interface DropStatus {
  title: string;
  details: string;
  errors?: string[];
}
```

## State Machine

The drop hook uses a state machine for predictable, clear state management. Instead of multiple boolean flags, you have a single `drop.phase` that represents exactly what's happening.

### State Flow

```
idle → dragging → idle (drag leave without drop)
idle → dragging → processing → ready (successful)
idle → dragging → processing → error (failed)
ready → dragging → processing → ... (new drop)
error → dragging → processing → ... (retry)
```

### Using the State Machine

```tsx
function StatusIndicator({ drop }) {
  // Use drop.phase to switch-case on the state
  switch (drop.phase) {
    case 'idle':
      return <p>Drop files here or click to select</p>;

    case 'dragging':
      return <p>Drop your files now!</p>;

    case 'processing':
      return <p>{drop.status?.details || 'Processing...'}</p>;

    case 'ready':
      return (
        <div>
          <p>✓ {drop.files.length} files ready</p>
          <button>Upload to Ship</button>
        </div>
      );

    case 'error':
      return (
        <div>
          <p>✗ {drop.status?.title}</p>
          <p>{drop.status?.details}</p>
          <button onClick={drop.clearAll}>Try Again</button>
        </div>
      );
  }
}
```

### Convenience Getters

For simpler use cases, boolean convenience getters are provided:

```tsx
// These are computed from drop.phase (read-only projections)
drop.isProcessing  // true when phase === 'processing'
drop.isDragging    // true when phase === 'dragging'

// For error information, use the flattened status object
drop.phase === 'error'      // Check if in error state
drop.status?.title          // Error title
drop.status?.details        // Error details
```

### Benefits

- **No impossible states** - Can't be `isProcessing=true` AND `isDragging=true`
- **Clear transitions** - State flow is explicit and predictable
- **Better TypeScript** - Discriminated unions provide type safety
- **Easier debugging** - Single source of truth for what's happening

## Error Handling

### Per-File Error Display

Each file in the `state.files` array contains its own `status` and `statusMessage`, allowing you to display granular errors for individual files:

```tsx
function FileList({ drop }) {
  return (
    <div>
      {/* Flattened access to files array */}
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
      {drop.phase === 'error' && (
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

### Error State Summary

When files fail validation or processing, check the error state:

```tsx
{drop.phase === 'error' && drop.status && (
  <div>
    <p>{drop.status.title}</p>
    <p>{drop.status.details}</p>
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
{drop.phase === 'error' && (
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
- Drag & drop event handling with folder support
- Folder structure preservation via `webkitGetAsEntry` API
- Path normalization for clean URLs
- These are UI/UX concerns, not deployment logic

**2. Prop Getters Pattern (Like react-dropzone)**
We provide event handlers, not visual components:
- ✅ **`getDropzoneProps()`** - Returns drag & drop event handlers
- ✅ **`getInputProps()`** - Returns file input configuration
- ✅ **`isDragging`** - State for visual feedback
- ✅ **You control the DOM** - Your markup, your styling, your design system

This is the same pattern used by popular libraries like `react-dropzone`, `downshift`, and `react-table`.

**3. Loosely Coupled Integration**
Following industry standards (Firebase hooks, Supabase utilities), we chose:
- ✅ **Ship instance as dependency**: Validates using `ship.getConfig()`
- ✅ **Simple output**: ProcessedFile[] can be passed directly to Ship SDK
- ✅ **Testable**: Easy to mock Ship SDK for testing
- ✅ **Flexible**: Host app controls WHEN to deploy

**4. Type System Integration**

ProcessedFile extends StaticFile from `@shipstatic/types` - the single source of truth for Ship SDK types:

```
File[] → ProcessedFile[] (which IS StaticFile[]) → ship.deployments.create()
```

No conversion needed. ProcessedFile adds UI-specific properties (id, name, status, progress) to StaticFile's base properties (content, path, size, md5).

**5. No Visual Components**

We deliberately don't provide styled components because:
- Your design system is unique to your application
- Styling should match your brand, not our opinions
- Prop getters give you full control over DOM structure and CSS
- Similar to how `react-dropzone` works - logic without opinions

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
