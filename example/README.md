# Drop + Ship Example

A minimal example showing the simplicity and power of combining `@shipstatic/drop` with `@shipstatic/ship`.

## What This Shows

This **250-line example** demonstrates a complete file deployment workflow:

✅ **Drag & drop** files or folders
✅ **Click to browse** with folder selection support
✅ **Shows source name** (file or folder being dropped)
✅ **File count** display
✅ **Deploy** with one click
✅ **Success state** with deployment URL
✅ **Error handling**:
  - Granular validation errors (per-file feedback)
  - General deployment errors
✅ **State management**:
  - Processing state (`drop.isProcessing`)
  - Validation state (`drop.validationError`)
  - Deployment state (success/error)

## The Code

The entire implementation is in [`src/App.tsx`](./src/App.tsx) - approximately 250 lines including:

- Dropzone with drag & drop + click-to-browse
- Folder traversal using `webkitGetAsEntry` API
- File processing via `useDrop()` hook
- Deployment via `ship.deployments.create()`
- Complete error handling and state management

## Running

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build
pnpm build
```

## The Hook

```typescript
const drop = useDrop({});

// Everything you need:
drop.files          // All processed files
drop.isProcessing   // Processing state
drop.validationError // Validation errors
drop.statusText     // Status message
drop.processFiles() // Process dropped files
drop.getValidFiles() // Get valid files for deployment
drop.clearAll()     // Reset state
```

## Key Features

### 1. Folder Structure Preservation

The example uses `webkitGetAsEntry` to traverse folders and preserve structure:

```typescript
const entry = item.webkitGetAsEntry?.();
await traverseFileTree(entry, files, entry.isDirectory ? entry.name : '');
```

Each file gets its `webkitRelativePath` set, which Ship SDK uses to recreate the folder structure on deployment.

### 2. Automatic Validation

Drop automatically validates files against Ship's limits:
- File size limits
- Total size limits
- File count limits
- MIME type validation

Validation errors show exactly which files failed and why.

### 3. One-Line Deployment

```typescript
const validFiles = drop.getValidFiles();
const files = validFiles.map(f => f.file);
const result = await ship.deployments.create(files);
```

## States

The example handles all states:

1. **Empty** - Initial state
2. **Dragging** - Visual feedback while dragging
3. **Processing** - Files being processed/validated
4. **Ready** - Files validated and ready to deploy
5. **Deploying** - Deployment in progress (handled by Ship SDK)
6. **Success** - Deployment URL shown
7. **Error** - Validation or deployment errors shown

## Architecture

```
User drops files
       ↓
webkitGetAsEntry (folder traversal)
       ↓
drop.processFiles() (ZIP extraction, path normalization)
       ↓
Ship SDK validation (size, count, MIME type)
       ↓
drop.getValidFiles() (ready for deployment)
       ↓
ship.deployments.create() (upload & deploy)
       ↓
Deployment URL
```

## Why So Simple?

- **No form state management** - Drop hook handles everything
- **No manual validation** - Ship SDK provides config & validates
- **No file readers** - Files are passed directly to Ship
- **No progress tracking** - Ship SDK handles upload internally
- **No folder parsing** - Browser's `webkitGetAsEntry` does it

The complexity is in the packages. Your code stays simple.

## Learn More

- [@shipstatic/drop](../README.md) - File processing hook
- [@shipstatic/ship](../../ship/README.md) - Deployment SDK
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry)
