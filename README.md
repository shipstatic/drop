# @shipstatic/drop

Headless file processing for Ship SDK deployments.

A React hook that prepares files for deployment with [@shipstatic/ship](https://www.npmjs.com/package/@shipstatic/ship): drag & drop with folder support, ZIP extraction, path normalization, and validation against your account's real platform limits. No UI, full styling control.

## Installation

```bash
npm install @shipstatic/drop @shipstatic/ship
```

React 18 or 19 is a peer dependency.

## Quick Start

```tsx
import { useDrop } from '@shipstatic/drop';
import Ship from '@shipstatic/ship';

const ship = new Ship({ token: 'deploy-...' });

function Uploader() {
  const drop = useDrop({ ship });

  const upload = async () => {
    await ship.deployments.upload(drop.getFilesForUpload());
  };

  return (
    <div>
      <div
        {...drop.getDropzoneProps()}
        style={{
          border: '2px dashed',
          borderColor: drop.isDragging ? 'blue' : 'gray',
          padding: 40,
          textAlign: 'center',
        }}
      >
        <input {...drop.getInputProps()} />
        {drop.isDragging ? 'Drop here' : 'Click or drag a folder'}
      </div>

      {drop.status && (
        <p>
          {drop.status.title}: {drop.status.details}
        </p>
      )}

      <button onClick={upload} disabled={drop.validFiles.length === 0}>
        Deploy {drop.validFiles.length} files
      </button>
    </div>
  );
}
```

## Why it exists

Ship's SDK deploys files. It doesn't do the browser-side work of *getting* them:

- **Folder drag & drop** via `webkitGetAsEntry`, traversed to exhaustion (`readEntries` returns at most 100 entries per call, so a naive reader truncates large folders)
- **ZIP extraction**, off the main thread
- **Path normalization** — the common directory prefix is stripped so `my-site/index.html` deploys as `index.html`
- **Validation** against your live limits from `ship.getLimits()`, using Ship's own validator so client and server can never disagree
- **React state** for the whole lifecycle

## `useDrop(options)`

```ts
const drop = useDrop({ ship });
```

| Option | Type | Purpose |
|--------|------|---------|
| `ship` | `Pick<Ship, 'getLimits'>` | Your Ship client — used for platform limits. A real `Ship` satisfies it. |

### What it returns

```ts
interface DropReturn {
  // State
  phase: 'idle' | 'processing' | 'ready' | 'error';
  isProcessing: boolean;   // phase === 'processing'
  isDragging: boolean;     // pointer is over the dropzone
  isInteractive: boolean;  // idle or ready
  hasError: boolean;       // phase === 'error'
  files: ProcessedFile[];
  validFiles: ProcessedFile[];  // only those that passed validation
  sourceName: string;      // ZIP name, folder name, or filename
  status: DropStatus | null;
  needsBuild: boolean;

  // Prop getters
  getDropzoneProps: (options?: { clickable?: boolean }) => { ... };
  getInputProps: (mode?: PickerMode) => { ... };  // 'folder' (default) | 'files'

  // Actions
  open: (mode?: PickerMode) => void;             // trigger a picker (default: folder)
  processFiles: (files: File[]) => Promise<void>; // advanced — see below
  reset: () => void;

  getFilesForUpload: () => File[];  // raw Files for ship.deployments.upload()
}
```

**`isDragging` is not a phase.** It's a pointer state that can occur over any phase, so a ready set stays ready while a new folder is dragged over it. Switch on `phase`; style on `isDragging`.

### Phases

```
idle → processing → ready   (deployable)
                  → error   (see status)
```

`status` carries what to show the user:

```ts
interface DropStatus {
  title: string;
  details: string;
  errors?: string[];    // per-file breakdown, on multi-error failures
  warnings?: string[];  // non-blocking, e.g. excluded empty files
}
```

To react to a phase change, use the state — that's what it's for:

```tsx
useEffect(() => {
  if (drop.phase === 'ready') track('files_ready', drop.files.length);
}, [drop.phase]);
```

## Prop getters

```tsx
<div {...drop.getDropzoneProps()}>
  <input {...drop.getInputProps()} />
</div>
```

Drag-only, with your own triggers:

```tsx
<div {...drop.getDropzoneProps({ clickable: false })}>
  <input {...drop.getInputProps('folder')} />
  <input {...drop.getInputProps('files')} />
  <button onClick={() => drop.open('folder')}>Select folder</button>
  <button onClick={() => drop.open('files')}>Select files</button>
</div>
```

`getDropzoneProps()` handles `webkitGetAsEntry` internally, which is what preserves folder structure. Calling `processFiles()` yourself loses it — the browser invalidates `dataTransfer.items` at the first `await`, so entries must be captured synchronously.

### Two pickers

`PickerMode` is `'folder' | 'files'`, and **folder is the default** — a bare `getInputProps()` / `open()`, and the dropzone's own click, open the folder picker.

An `<input>` is either a folder picker or a file picker, so each mode owns its own element and its own ref: a UI offering both renders **both inputs**, and `open(mode)` clicks whichever is mounted. Exactly one attribute differs — `webkitdirectory` in folder mode, `accept` in files mode.

Wrap `open` in a handler rather than passing it by reference (`onClick={() => drop.open('files')}`): React hands a click handler a `MouseEvent`, which would otherwise arrive as the mode.

**Selecting is not a second code path.** A picked file set — loose files or a ZIP — runs the identical pipeline as a dropped one, with the same paths, the same source name and the same verdict. The `accept` list is a *hint* that biases what the file dialog shows first; it decides nothing, since every dialog offers an all-files escape and drag & drop ignores `accept` outright. What files may be deployed is one rule, applied downstream of both entry points.

## Validation

Validation is **atomic**: if any file fails, every non-excluded file is marked `validation_failed` and nothing is deployable. Call `reset()` and start over.

Empty files (0 bytes) are `excluded` with a warning rather than failing the deploy.

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting validation |
| `processing_error` | Failed during processing |
| `excluded` | Excluded with a warning — not an error |
| `validation_failed` | Failed validation; blocks deployment |
| `ready` | Deployable |

These are Ship's own values. Drop adds none of its own, so a `ProcessedFile` is directly expressible as Ship's `ValidatableFile` — and you compare against `FileValidationStatus`, imported from `@shipstatic/ship`, rather than a drop-specific alias:

```ts
import { FileValidationStatus } from '@shipstatic/ship';

const ready = drop.files.filter(f => f.status === FileValidationStatus.READY);
```

## Build on upload

Drop recognises an unbuilt project (source files with `package.json` / `node_modules`) and sets `needsBuild`. `node_modules` is skipped during traversal and stripped from folder-picker selections, deploy validation is skipped (source files aren't build output), and every file goes straight to `ready`.

Pass the signal through to the SDK:

```tsx
await ship.deployments.upload(drop.getFilesForUpload(), {
  build: drop.needsBuild,
  prerender: drop.needsBuild,
});
```

## ZIP handling

A **single** dropped ZIP is extracted and its contents deployed. ZIPs among several files are treated as ordinary files. Archive paths are sanitized against directory traversal (`../../etc/passwd` → `etc/passwd`).

## Without React

The pipeline is a plain function, so any UI layer can use it:

```ts
import { processFiles } from '@shipstatic/drop';
import { FileValidationStatus } from '@shipstatic/ship';

const outcome = await processFiles(files, { limits: await ship.getLimits() });

if (outcome.phase === 'ready') {
  const ready = outcome.files.filter(f => f.status === FileValidationStatus.READY);
  await ship.deployments.upload(ready.map(f => f.file));
} else {
  console.error(outcome.status.title, outcome.status.details);
}
```

It never throws — a missing entry point, an oversized file, an unbuilt project, and an unexpected failure all come back as an `error` outcome. Pass `onStatus` to report progress during extraction.

## Testing your components

`@shipstatic/drop/testing` builds the fixtures so your tests don't have to:

```tsx
import { createMockDrop, createMockProcessedFile } from '@shipstatic/drop/testing';

it('renders the file count', () => {
  const drop = createMockDrop({
    phase: 'ready',
    files: [createMockProcessedFile('index.html')],
  });

  render(<Dropzone drop={drop} />);
  expect(screen.getByText('1 file')).toBeInTheDocument();
});
```

Override any field — including with your own spies, which is how you assert on interactions:

```tsx
const reset = vi.fn();
const drop = createMockDrop({ phase: 'ready', reset });

render(<Dropzone drop={drop} />);
await userEvent.click(screen.getByText('Clear'));

expect(reset).toHaveBeenCalled();
```

The subpath deliberately ships no spy or matcher helpers of its own — your test framework already has better ones.

| Export | Purpose |
|--------|---------|
| `createMockDrop(overrides?)` | A complete `DropReturn`; convenience booleans and `validFiles` derive from `phase` and `files` unless overridden |
| `createMockProcessedFile(name, options?)` | A `ProcessedFile` backed by a real `File` |
| `createMockFileWithPath(name, path, content?, type?)` | A real `File` carrying a folder-relative path |
| `mockUseDrop(overrides?)` | A `useDrop` replacement, for components that call the hook themselves |

If your component **receives** `drop` as a prop, you need nothing else — pass it a
`createMockDrop()`. If it calls `useDrop` internally, replace the module:

```tsx
import { mockUseDrop } from '@shipstatic/drop/testing';

vi.mock('@shipstatic/drop', () => ({ useDrop: mockUseDrop({ phase: 'ready' }) }));
```

## Gotchas

- **`webkitRelativePath` is the handoff.** Drop writes each file's deploy path there, and the Ship SDK reads it. Don't modify it in between.
- **`stripCommonPrefix` mutates File objects.** It returns new `ProcessedFile`s but rewrites `webkitRelativePath` on the underlying `File` — deliberately, because that's what the SDK reads.
- **Unreadable entries are skipped silently.** A folder with permission-denied files still deploys; the failures are logged to the console with no programmatic signal.
- **No MD5 here.** Ship computes checksums during upload.
- **`type` is the browser's report.** The platform derives `Content-Type` server-side from the path, so drop bundles no MIME database.

## License

MIT
