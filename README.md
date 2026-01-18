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
    await ship.deployments.create(drop.validFiles.map(f => f.file));
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

      <button onClick={handleUpload} disabled={drop.phase !== 'ready'}>
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
  files: ProcessedFile[];
  validFiles: ProcessedFile[];
  status: { title: string; details: string } | null;

  // Prop getters
  getDropzoneProps: () => { onDragOver, onDragLeave, onDrop, onClick };
  getInputProps: () => { ref, type, style, multiple, webkitdirectory, onChange };

  // Actions
  open: () => void;           // Trigger file picker
  processFiles: (files: File[]) => Promise<void>;
  clearAll: () => void;
  updateFileStatus: (fileId: string, state: {...}) => void;
}
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
const filesToDeploy = drop.validFiles.map(f => f.file);
await ship.deployments.create(filesToDeploy);
```

## Requirements

- React 18+ or 19+
- Modern browsers (Chrome, Edge, Safari 11.1+, Firefox 50+)

## License

MIT
