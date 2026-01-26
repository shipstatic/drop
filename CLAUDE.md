# CLAUDE.md

Claude Code instructions for the **Drop** package.

## Package Identity

**@shipstatic/drop** is a React companion to Ship SDK. It provides what the SDK doesn't have for browser deployments: ZIP extraction, drag & drop with folder support, and React state management.

**Maturity:** Release candidate. Interfaces are stabilizing; changes should be deliberate and well-considered.

```
User drops files → Drop processes → Ship SDK deploys
     (ZIP, folders)    (validation)     (upload, MD5)
```

**Drop's scope:** Everything BEFORE `ship.deployments.create()`. The SDK handles everything after.

## Architecture

```
src/
├── index.ts              # Package exports
├── testing.ts            # Test utilities (exported via /testing subpath)
├── types.ts              # Extends @shipstatic/types with UI-specific statuses
├── hooks/
│   └── useDrop.ts        # Main hook (state machine, processing, prop getters)
└── utils/
    ├── fileProcessing.ts # Folder traversal, path normalization
    ├── zipExtractor.ts   # ZIP extraction (JSZip)
    └── mimeType.ts       # MIME detection
```

## Quick Reference

```bash
pnpm test --run               # All tests
pnpm build                    # Build package
```

## Ship SDK Integration

### Functions Imported from Ship SDK

Drop delegates to Ship SDK for validation and filtering:

```typescript
import { validateFiles, filterJunk, getValidFiles } from '@shipstatic/ship';
```

| Function | Purpose | Used In |
|----------|---------|---------|
| `validateFiles(files, config)` | Validate against server limits | After processing |
| `filterJunk(paths)` | Filter .DS_Store, Thumbs.db, etc. | During processing |
| `getValidFiles(files)` | Extract files with `status: 'ready'` | `validFiles` getter |

### The Integration Point

```typescript
const drop = useDrop({ ship });  // Pass Ship instance

// Drop calls ship.getConfig() internally for validation limits
// Drop uses Ship's validateFiles() for validation

// When ready, get File objects for SDK:
const files = drop.getFilesForUpload();
await ship.deployments.create(files);
```

**Key detail:** Drop sets `webkitRelativePath` on each File object. Ship SDK reads this property to preserve folder structure during deployment.

## State Machine

```
idle → dragging → processing → ready (success)
                            → error (failed)
```

| Phase | Meaning |
|-------|---------|
| `idle` | Ready for files |
| `dragging` | User dragging over dropzone |
| `processing` | Extracting ZIP, validating |
| `ready` | Files valid, can deploy |
| `error` | Validation or processing failed |

**Convenience booleans:**
- `drop.phase` - Raw state value for switch-case logic
- `drop.isInteractive` - True when idle, dragging, or ready (user can interact)
- `drop.hasError` - True when in error state
- `drop.isProcessing` - True when processing files
- `drop.isDragging` - True when user is dragging over dropzone

## Processing Flow

```
1. Files dropped/selected
2. Extract ZIP if single ZIP file
3. Filter junk (via Ship SDK's filterJunk)
4. Create ProcessedFile[] with paths
5. Strip common directory prefix
6. Validate (via Ship SDK's validateFiles + ship.getConfig())
7. Transition to ready/error
```

**ZIP behavior:** Single ZIP → extract contents. Multiple files including ZIPs → treat ZIPs as files.

## Prop Getters API

```typescript
<div {...drop.getDropzoneProps()}>      // Handles drag events + click
  <input {...drop.getInputProps()} />   // Hidden file input with folder support
</div>

// For drag-only dropzones (no click-to-open):
<div {...drop.getDropzoneProps({ clickable: false })}>
  <input {...drop.getInputProps()} />
  <button onClick={drop.open}>Select folder</button>
</div>
```

`getDropzoneProps()` handles `webkitGetAsEntry` internally for proper folder traversal. Manual `processFiles()` usage loses this.

## Error Handling

### File Status Values

| Status | Source | Meaning |
|--------|--------|---------|
| `ready` | Ship SDK | Passed validation |
| `validation_failed` | Ship SDK | Failed validation |
| `empty_file` | Ship SDK | 0 bytes |
| `processing_error` | Drop | ZIP/processing failed |
| `uploading` | Drop | Upload in progress |
| `complete` | Drop | Upload done |

Statuses from `@shipstatic/types` are extended with Drop-specific UI states.

### Atomic Validation

If ANY file fails, ALL are marked `validation_failed`. Use `drop.reset()` to clear and retry. This matches Ship SDK's all-or-nothing deployment philosophy.

## Design Decisions

### Why Drop Exists

Ship SDK handles deployment but doesn't provide:
- ZIP extraction (browser-specific, uses JSZip)
- React state management
- Drag & drop with folder traversal (`webkitGetAsEntry`)
- UI-friendly file status tracking

### Why No MD5 Calculation

Ship SDK calculates MD5 during deployment. Duplicate calculation would waste cycles.

### Why No Individual File Removal

Atomic validation means removing one file requires re-validating all. Simpler to call `reset()` and re-drop.

## Key Gotchas

### DataTransfer Synchronous Access

`dataTransfer.items` must be accessed synchronously in drop handlers - they're garbage collected after the first `await`. The hook handles this, but manual `processFiles()` callers lose folder structure.

### webkitRelativePath

Drop sets this property on File objects. Ship SDK reads it for deployment paths. Don't mutate it between Drop and SDK.

### File Input is Folder-Only

The hidden input always has `webkitdirectory` attribute set. This means clicking opens a **folder picker**, not a file picker. Users wanting to upload individual files must use drag-and-drop.

### stripCommonPrefix Mutates File Objects

`stripCommonPrefix` returns new `ProcessedFile` objects (immutable pattern), but it **mutates** the underlying `File.webkitRelativePath` property. This is intentional - Ship SDK reads `webkitRelativePath` from the raw File objects, so the mutation keeps them in sync.

### Folder Traversal Silently Skips Errors

If a file can't be read during folder drag-and-drop (permissions, etc.), it's logged to console but otherwise skipped. The caller has no programmatic way to know which files failed.

## Testing

### Package Tests

318 tests with 99%+ coverage across:

| Test Suite | Focus |
|------------|-------|
| `useDrop.test.ts` | Core hook behavior, state transitions |
| `useDrop-props.test.tsx` | Prop getters, clickable option |
| `useDrop-zip.test.tsx` | ZIP extraction integration |
| `useDrop-validation.test.tsx` | Ship SDK validation integration |
| `useDrop-branches.test.tsx` | Edge cases, error paths |
| `zipExtractor.test.ts` | ZIP extraction utility |
| `fileProcessing.test.ts` | Path normalization, folder traversal |
| `commonPrefix.test.ts` | Directory prefix stripping |
| `testing.test.ts` | Test utilities themselves |
| `ship-sdk-contract.test.ts` | Contract with Ship SDK |

```bash
pnpm test --run              # Run all tests
pnpm test --run --coverage   # With coverage report
```

### Consumer Test Utilities

The `/testing` subpath exports mock utilities for testing components that consume `useDrop`:

```typescript
import {
  createMockDrop,
  createMockDropWithSpies,
  createMockProcessedFile,
  createMockFile,
  createMockFileWithPath,
  createMockErrorStatus,
  createMockProcessingStatus,
  createMockReadyStatus,
} from '@shipstatic/drop/testing';
```

#### createMockDrop

Creates a mock `DropReturn` for testing components that receive `drop` as a prop:

```typescript
const drop = createMockDrop({
  phase: 'ready',
  files: [createMockProcessedFile('index.html')],
  sourceName: 'my-project.zip',
});

render(<DeployDropArea drop={drop} />);
expect(screen.getByText('1 files ready')).toBeInTheDocument();
```

#### createMockDropWithSpies

Same as `createMockDrop` but with call tracking for interaction tests:

```typescript
const { drop, spies } = createMockDropWithSpies({
  phase: 'ready',
  files: [createMockProcessedFile('index.html')],
});

render(<DeployDropArea drop={drop} />);
await userEvent.click(screen.getByText('Clear'));

expect(spies.reset.toHaveBeenCalled()).toBe(true);
expect(spies.open.calls()).toBe(0);
```

#### File Mocks

```typescript
// ProcessedFile with all metadata
const processed = createMockProcessedFile('style.css', {
  path: 'assets/style.css',
  content: 'body { margin: 0 }',
  type: 'text/css',
  status: 'ready',
});

// Plain File object
const file = createMockFile('data.json', '{"key": "value"}', 'application/json');

// File with webkitRelativePath set
const fileWithPath = createMockFileWithPath(
  'index.html',
  'my-project/dist/index.html'
);
```

#### Status Mocks

```typescript
const error = createMockErrorStatus(
  'Validation Failed',
  'Some files could not be processed',
  ['virus.exe: File type not allowed']
);

const processing = createMockProcessingStatus(
  'Extracting ZIP...',
  'Processing 42 files'
);

const ready = createMockReadyStatus(5); // "5 file(s) are ready"
```

### Testing Philosophy

- **Mock at the boundary** - Mock `DropReturn`, not internal utilities
- **Test states, not implementation** - Focus on phase transitions and UI states
- **Use spies for interactions** - Verify `reset()`, `open()` are called correctly
- **No DOM event simulation** - Use the mock utilities instead of simulating drag events

## Related Documentation

| Document | Content |
|----------|---------|
| `../ship/CLAUDE.md` | Ship SDK - what happens after Drop |
| `../types/README.md` | Shared types including FileValidationStatus |

---

*Drop is a companion to Ship SDK. For SDK patterns (auth, HTTP, CLI), see `../ship/CLAUDE.md`.*
