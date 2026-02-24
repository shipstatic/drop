# @shipstatic/drop

Headless file processing toolkit for Ship SDK deployments.

A focused React hook for preparing files for deployment with [@shipstatic/ship](https://github.com/shipstatic/ship). Handles ZIP extraction, path normalization, folder structure preservation, and validation.

## Installation

```bash
npm install @shipstatic/drop @shipstatic/ship
```

## Quick Start

```tsx
import { useDrop } from '@shipstatic/drop';
import Ship from '@shipstatic/ship';

const ship = new Ship({ deployToken: 'token-xxxx' });

function Uploader() {
  const drop = useDrop({ ship });

  const handleUpload = async () => {
    const files = drop.getFilesForUpload();
    await ship.deployments.upload(files);
  };

  return (
    <div>
      <div
        {...drop.getDropzoneProps()}
        style={{
          border: '2px dashed',
          borderColor: drop.isDragging ? 'blue' : 'gray',
          padding: '40px',
          textAlign: 'center',
        }}
      >
        <input {...drop.getInputProps()} />
        {drop.isDragging ? 'Drop here' : 'Click or drag files/folders'}
      </div>

      {drop.status && <p>{drop.status.title}: {drop.status.details}</p>}

      <button onClick={handleUpload} disabled={!drop.validFiles.length}>
        Upload {drop.validFiles.length} files
      </button>
    </div>
  );
}
```

## Features

- **Prop Getters API** - Spread props on your elements (like `react-dropzone`)
- **Built-in Drag & Drop** - Folder support with `webkitGetAsEntry` API
- **ZIP Support** - Automatic extraction and processing
- **Ship SDK Integration** - Validation via `ship.getConfig()`
- **Headless** - No visual components, full styling control
- **TypeScript** - Complete type definitions

## State Machine

```
idle → dragging → processing → ready/error
```

Use semantic booleans for clean rendering:

```tsx
{drop.isProcessing && <Spinner />}
{drop.hasError && <Error message={drop.status?.details} onRetry={drop.reset} />}
{drop.isInteractive && <DropZone />}
```

Or use `phase` for switch-case logic:

```tsx
switch (drop.phase) {
  case 'idle': return 'Drop files here';
  case 'dragging': return 'Drop now!';
  case 'processing': return 'Processing...';
  case 'ready': return `${drop.validFiles.length} files ready`;
  case 'error': return drop.status?.details;
}
```

## API

### `useDrop(options)`

```typescript
interface DropOptions {
  ship: Ship;                                    // Ship SDK instance (required)
  onFilesReady?: (files: ProcessedFile[]) => void;
  onValidationError?: (error: ClientError) => void;
  stripPrefix?: boolean;                         // Strip common path prefix (default: true)
}
```

### Return Value

```typescript
interface DropReturn {
  // State
  phase: 'idle' | 'dragging' | 'processing' | 'ready' | 'error';
  isProcessing: boolean;
  isDragging: boolean;
  isInteractive: boolean;  // true when idle, dragging, or ready
  hasError: boolean;       // true when in error state
  files: ProcessedFile[];
  validFiles: ProcessedFile[];
  sourceName: string;
  status: { title: string; details: string; errors?: string[] } | null;

  // Prop getters
  getDropzoneProps: (options?: { clickable?: boolean }) => {...};
  getInputProps: () => {...};

  // Actions
  open: () => void;                              // Trigger file picker
  processFiles: (files: File[]) => Promise<void>;
  reset: () => void;                             // Clear all files and reset state

  // Helpers
  getFilesForUpload: () => File[];               // Get raw File objects for SDK
}
```

### Prop Getter Options

```tsx
// Default: clickable dropzone (click opens file picker)
<div {...drop.getDropzoneProps()}>

// Drag-only dropzone (no click behavior)
<div {...drop.getDropzoneProps({ clickable: false })}>
  <button onClick={drop.open}>Select folder</button>
</div>
```

## Ship SDK Integration

Drop uses Ship SDK's validation automatically:

```tsx
const drop = useDrop({ ship });

// Behind the scenes: ship.getConfig() → validateFiles()
// Client validation matches server limits
```

Pass files to Ship SDK:

```tsx
const files = drop.getFilesForUpload();
await ship.deployments.upload(files);
```

## Testing

The `/testing` subpath provides mock utilities for testing components that use `useDrop`:

```typescript
import {
  createMockDrop,
  createMockDropWithSpies,
  createMockProcessedFile,
} from '@shipstatic/drop/testing';
```

### Testing Component States

```tsx
import { render, screen } from '@testing-library/react';
import { createMockDrop, createMockProcessedFile } from '@shipstatic/drop/testing';

it('shows file count when ready', () => {
  const drop = createMockDrop({
    phase: 'ready',
    files: [
      createMockProcessedFile('index.html'),
      createMockProcessedFile('style.css'),
    ],
  });

  render(<MyDropzone drop={drop} />);
  expect(screen.getByText('2 files ready')).toBeInTheDocument();
});
```

### Testing Interactions

```tsx
import userEvent from '@testing-library/user-event';
import { createMockDropWithSpies, createMockProcessedFile } from '@shipstatic/drop/testing';

it('calls reset when Clear is clicked', async () => {
  const { drop, spies } = createMockDropWithSpies({
    phase: 'ready',
    files: [createMockProcessedFile('index.html')],
  });

  render(<MyDropzone drop={drop} />);
  await userEvent.click(screen.getByText('Clear'));

  expect(spies.reset.toHaveBeenCalled()).toBe(true);
});
```

### Available Utilities

| Function | Purpose |
|----------|---------|
| `createMockDrop(options?)` | Mock `DropReturn` for rendering tests |
| `createMockDropWithSpies(options?)` | Mock with call tracking for interaction tests |
| `createMockProcessedFile(name, options?)` | Mock `ProcessedFile` |
| `createMockFile(name, content?, type?)` | Mock `File` object |
| `createMockFileWithPath(name, path, ...)` | Mock `File` with `webkitRelativePath` |
| `createMockErrorStatus(title?, details?, errors?)` | Mock error status |
| `createMockProcessingStatus(title?, details?)` | Mock processing status |
| `createMockReadyStatus(count)` | Mock ready status |

## Requirements

- React 18+ or 19+
- Modern browsers (Chrome, Edge, Safari 11.1+, Firefox 50+)

## License

MIT
