# CLAUDE.md

Claude Code instructions for the **Drop** package.

## Package Identity

**@shipstatic/drop** is a React companion to Ship SDK. It provides what the SDK doesn't have for browser deployments: ZIP extraction, drag & drop with folder support, and React state management.

**Maturity:** Release candidate. Interfaces are stabilizing; changes should be deliberate.

**Drop's scope:** Everything BEFORE `ship.deployments.upload()`. The SDK handles everything after.

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
    ├── zipExtractor.ts   # ZIP extraction (fflate)
    └── mimeType.ts       # MIME detection
```

## Quick Reference

```bash
pnpm test --run               # All tests
pnpm build                    # Build package
```

## Ship SDK Integration

Drop delegates to Ship SDK for validation and filtering:

```typescript
import { validateFiles, filterJunk } from '@shipstatic/ship';
```

| Function | Purpose | Used In |
|----------|---------|---------|
| `validateFiles(files, config)` | Validate against server limits | After processing |
| `filterJunk(paths)` | Filter .DS_Store, Thumbs.db, dot files (`.well-known` allowed) | During processing |

`validFiles` is computed inline via `useMemo` — files with `status: 'ready'` filtered from state.

**Key detail:** Drop sets `webkitRelativePath` on each File object. Ship SDK reads this property to preserve folder structure during deployment.

## State Machine

```
idle → dragging → processing → ready (success)
                            → error (failed)
```

Phases: `idle` (ready), `dragging` (hovering), `processing` (extracting/validating), `ready` (can deploy), `error` (failed).

Convenience booleans: `isProcessing`, `isDragging`, `isInteractive` (idle/dragging/ready), `hasError`. Use `phase` for switch-case.

## Processing Flow

```
1. Files dropped/selected
2. Extract ZIP if single ZIP file
3. Detect unbuilt project (hasUnbuiltMarker) → needsBuild
4. Strip node_modules files if needsBuild
5. Filter junk (filterJunk, allowUnbuilt when needsBuild)
6. Create ProcessedFile[] with paths
7. Strip common directory prefix
8. Validate entry point (index.html at root for built sites, anywhere for unbuilt projects)
9. If needsBuild: skip validation → ready (build service validates output)
10. Else: validate (validateFiles + ship.getLimits()) → ready/error
```

**ZIP behavior:** Single ZIP → extract contents. Multiple files including ZIPs → treat ZIPs as regular files.

### Build-on-Upload Detection

Drop detects unbuilt projects (source code with `package.json`/`node_modules`) and surfaces a `needsBuild: boolean` signal on `DropReturn`. When `needsBuild` is true:

- `traverseFileTree` skips `node_modules` directories entirely (performance — 50K+ files)
- Remaining `node_modules` files (from `webkitdirectory` folder picker) are stripped
- `filterJunk` runs with `allowUnbuilt: true` (no throw on markers)
- Deploy validation is skipped — source files aren't deploy output
- All files go straight to `ready` status

The web app reads `drop.needsBuild` and passes `build: true, prerender: true` to the SDK. Drop doesn't know about `build`/`prerender` — it only detects and signals.

## Prop Getters API

```typescript
<div {...drop.getDropzoneProps()}>      // Handles drag events + click
  <input {...drop.getInputProps()} />   // Hidden file input with folder support
</div>

// Drag-only (no click-to-open):
<div {...drop.getDropzoneProps({ clickable: false })}>
  <input {...drop.getInputProps()} />
  <button onClick={drop.open}>Select folder</button>
</div>
```

`getDropzoneProps()` handles `webkitGetAsEntry` internally for proper folder traversal. Manual `processFiles()` callers lose this.

## Error Handling

### File Status Values

`FILE_STATUSES` spreads `FileValidationStatus` from `@shipstatic/types` and adds Drop-specific values:

| Status | Source | Meaning |
|--------|--------|---------|
| `pending` | `@shipstatic/types` | Awaiting validation |
| `processing_error` | `@shipstatic/types` | Failed during processing (before validation) |
| `excluded` | `@shipstatic/types` | Excluded with warning (e.g., empty files — not an error) |
| `validation_failed` | `@shipstatic/types` | Failed validation (blocks deployment) |
| `ready` | `@shipstatic/types` | Passed validation, ready to deploy |
| `processing` | Drop | Processing in progress |
| `uploading` | Drop | Upload in progress |
| `complete` | Drop | Upload done |
| `error` | Drop | Processing exception (catch block) |

### Atomic Validation

If ANY file fails validation, ALL non-excluded files are marked `validation_failed`. Empty files (0 bytes) are marked `excluded` with warnings (not errors) and don't block deployment. Use `drop.reset()` to clear and retry.

## Design Decisions

- **No MD5 calculation** — Ship SDK calculates MD5 during deployment; duplicate calculation wastes cycles.
- **No individual file removal** — Atomic validation means removing one file requires re-validating all. Call `reset()` and re-drop.
- **Why Drop exists** — Ship SDK handles deployment but lacks ZIP extraction (browser-specific), React state management, drag & drop with `webkitGetAsEntry` folder traversal, and UI-friendly file status tracking.

## Key Gotchas

- **DataTransfer synchronous access** — `dataTransfer.items` must be accessed synchronously in drop handlers; they're garbage collected after the first `await`. The hook handles this, but manual `processFiles()` callers lose folder structure.
- **File Input is folder-only** — The hidden input always has `webkitdirectory` set. Clicking opens a **folder picker**, not a file picker. Individual file uploads require drag-and-drop.
- **`stripCommonPrefix` mutates File objects** — Returns new `ProcessedFile` objects (immutable), but **mutates** `File.webkitRelativePath` directly. Intentional — Ship SDK reads `webkitRelativePath` from raw File objects.
- **`webkitRelativePath`** — Don't mutate it between Drop and SDK; Ship SDK reads it for deployment paths.
- **Folder traversal silently skips errors** — Unreadable files (permissions, etc.) are logged to console but skipped. No programmatic notification to the caller.

## Testing

98%+ coverage. Test files are in `src/__tests__/` and mirror the modules they test.

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

| Function | Purpose |
|----------|---------|
| `createMockDrop(options?)` | Mock `DropReturn` for rendering tests |
| `createMockDropWithSpies(options?)` | Mock with call tracking (`spies.reset.toHaveBeenCalled()` returns boolean) |
| `createMockProcessedFile(name, options?)` | Mock `ProcessedFile` |
| `createMockFile(name, content?, type?)` | Mock `File` object |
| `createMockFileWithPath(name, path, ...)` | Mock `File` with `webkitRelativePath` |
| `createMockErrorStatus(title?, details?, errors?)` | Mock error status |
| `createMockProcessingStatus(title?, details?)` | Mock processing status |
| `createMockReadyStatus(count)` | Mock ready status (`"N file(s) are ready."`) |

### Testing Philosophy

- **Mock at the boundary** — Mock `DropReturn`, not internal utilities
- **Test states, not implementation** — Focus on phase transitions and UI states
- **Use spies for interactions** — Verify `reset()`, `open()` are called correctly
- **No DOM event simulation** — Use mock utilities instead of simulating drag events

---

*Drop is a companion to Ship SDK. For SDK patterns (auth, HTTP, CLI), see the `@shipstatic/ship` package.*
