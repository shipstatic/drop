# CLAUDE.md

Claude Code instructions for the **Drop** package.

## Package Identity

**@shipstatic/drop** is a React companion to Ship SDK. It provides what the SDK doesn't have for browser deployments: ZIP extraction, drag & drop with folder support, and React state management.

```
User drops files → Drop processes → Ship SDK deploys
     (ZIP, folders)    (validation)     (upload, MD5)
```

**Drop's scope:** Everything BEFORE `ship.deployments.create()`. The SDK handles everything after.

## Architecture

```
src/
├── index.ts              # Package exports
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

// When ready, extract File objects for SDK:
const files = drop.validFiles.map(f => f.file);
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

Use `drop.phase` for switch-case logic, `drop.isDragging`/`drop.isProcessing` for simple conditionals.

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

If ANY file fails, ALL are marked `validation_failed`. Use `clearAll()` to reset and retry. This matches Ship SDK's all-or-nothing deployment philosophy.

### Upload Progress

```typescript
drop.updateFileStatus(fileId, { status: 'uploading', progress: 50 });
```

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

Atomic validation means removing one file requires re-validating all. Simpler to `clearAll()` and re-drop.

## Key Gotchas

### DataTransfer Synchronous Access

`dataTransfer.items` must be accessed synchronously in drop handlers - they're garbage collected after the first `await`. The hook handles this, but manual `processFiles()` callers lose folder structure.

### webkitRelativePath

Drop sets this property on File objects. Ship SDK reads it for deployment paths. Don't mutate it between Drop and SDK.

## Related Documentation

| Document | Content |
|----------|---------|
| `../ship/CLAUDE.md` | Ship SDK - what happens after Drop |
| `../types/README.md` | Shared types including FileValidationStatus |

---

*Drop is a companion to Ship SDK. For SDK patterns (auth, HTTP, CLI), see `../ship/CLAUDE.md`.*
