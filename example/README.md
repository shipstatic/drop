# Drop + Ship Example

A complete example demonstrating `@shipstatic/drop`'s **state machine architecture** with `@shipstatic/ship`.

## What This Shows

This **260-line example** demonstrates a production-ready file deployment workflow:

✅ **Drag & drop** files or folders with visual feedback
✅ **State machine UI** - Different visuals for each state
✅ **Source name display** (ZIP/folder/file detection)
✅ **File list** with expandable details and per-file status
✅ **One-click deploy** with disabled state handling
✅ **Success state** with deployment URL
✅ **Error handling**:
  - Validation errors (client-side)
  - Deployment errors (server-side)
  - Clear error/success visual separation
✅ **State machine architecture**:
  - `idle` → `dragging` → `processing` → `ready` / `error`
  - Explicit state-based rendering
  - No impossible states

## The Code

The entire implementation is in [`src/App.tsx`](./src/App.tsx):

- **State machine UI** - Renders differently for each state value
- **Prop getters** - `getDropzoneProps()` and `getInputProps()` for zero-config integration
- **Computed values** - `canDeploy` derived from `drop.state.value`
- **File processing** - Automatic via `useDrop()` hook
- **Deployment** - One-line `ship.deployments.upload()`
- **Expandable file list** - Shows per-file status with visual indicators

## Running

```bash
pnpm install  # Install dependencies
pnpm dev      # Start dev server at http://localhost:5173
pnpm build    # Build for production
```

## State Machine API

```typescript
const drop = useDrop({ ship });

// State machine (single source of truth)
drop.state.value       // 'idle' | 'dragging' | 'processing' | 'ready' | 'error'
drop.state.files       // ProcessedFile[] with per-file status
drop.state.sourceName  // Detected source name (ZIP/folder/file)
drop.state.status      // { title: string, details: string } | null

// Convenience getters (computed from state)
drop.isProcessing      // true when state.value === 'processing'
drop.isDragging        // true when state.value === 'dragging'

// Actions
drop.getValidFiles()   // Get files ready for deployment
drop.clearAll()        // Reset to initial state
drop.processFiles()    // Manually process files (advanced)

// Prop getters (zero-config integration)
drop.getDropzoneProps()  // Spread on dropzone div
drop.getInputProps()     // Spread on input element
```

## State-Based UI

The example renders **different UI for each state**, demonstrating the state machine pattern:

### `idle` State
```tsx
// Dropzone ready for files
<div {...drop.getDropzoneProps()}>
  📁 Click or drop files/folders
</div>
```

### `dragging` State
```tsx
// Visual feedback with blue background
<div style={{ backgroundColor: drop.isDragging ? "#f0f9ff" : "white" }}>
  📂 Drop here
</div>
```

### `processing` State
```tsx
// Blue status card
{drop.state.value === "processing" && drop.state.status && (
  <div className="blue-card">
    <strong>{drop.state.status.title}</strong>
    <p>{drop.state.status.details}</p>
  </div>
)}
```

### `ready` State
```tsx
// Green success card with file count
{drop.state.value === "ready" && (
  <div className="green-card">
    <strong>{drop.state.sourceName}</strong>
    <p>{drop.getValidFiles().length} files ready to deploy</p>
  </div>
)}
```

### `error` State
```tsx
// Red error card
{drop.state.value === "error" && drop.state.status && (
  <div className="red-card">
    <strong>{drop.state.status.title}</strong>
    <p>{drop.state.status.details}</p>
  </div>
)}
```

## Key Features

### 1. Computed Values

Clean button logic derived from state:

```typescript
const canDeploy = drop.state.value === "ready" && !isDeploying && !deploymentUrl;

<button disabled={!canDeploy}>Deploy</button>
```

### 2. Explicit State Handling

No boolean soup - just check the state value:

```typescript
// ✅ Clear and explicit
{drop.state.value === "ready" && <ReadyUI />}
{drop.state.value === "error" && <ErrorUI />}

// ❌ Old way (multiple booleans)
{!isProcessing && !validationError && files.length > 0 && <ReadyUI />}
```

### 3. One-Line Deployment

```typescript
const validFiles = drop.getValidFiles();
const files = validFiles.map(f => f.file);
const result = await ship.deployments.upload(files);
```

## State Machine Flow

```
            ┌─────────┐
            │  idle   │ ← Initial state
            └────┬────┘
                 │ onDragOver
                 ↓
         ┌───────────────┐
         │   dragging    │ ← Visual feedback
         └───────┬───────┘
                 │ onDrop
                 ↓
         ┌───────────────┐
         │  processing   │ ← ZIP extraction, validation
         └───────┬───────┘
                 │
        ┌────────┴────────┐
        ↓                 ↓
  ┌─────────┐       ┌─────────┐
  │  ready  │       │  error  │ ← Terminal states
  └─────────┘       └─────────┘
        │                 │
        └────────┬────────┘
                 ↓ clearAll()
            ┌─────────┐
            │  idle   │
            └─────────┘
```

## Why This Architecture?

**State Machine Benefits:**
- ✅ **No impossible states** - Can't be processing AND ready simultaneously
- ✅ **Explicit transitions** - Clear state flow easy to reason about
- ✅ **Type safety** - TypeScript discriminated unions prevent bugs
- ✅ **Testable** - Each state has predictable behavior

**Simplicity Through Abstraction:**
- **No form state management** - Drop hook handles everything
- **No manual validation** - Ship SDK provides config & validates
- **No file readers** - Files passed directly to Ship
- **No folder parsing** - Built into `getDropzoneProps()`
- **No progress tracking** - Ship SDK handles upload internally

The complexity lives in the packages. Your code stays clean.

## Learn More

- [@shipstatic/drop](../README.md) - File processing hook
- [@shipstatic/ship](../../ship/README.md) - Deployment SDK
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry)
