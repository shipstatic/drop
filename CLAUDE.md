# CLAUDE.md

Claude Code instructions for the **Drop** package.

## Package Identity

**@shipstatic/drop** is a React companion to Ship SDK. It provides what the SDK doesn't have for browser deployments: ZIP extraction, drag & drop with folder support, and React state management.

**Maturity:** Stable; semver applies — breaking changes require a major version bump.

**Branches:** `main` (production) + `development` (integration). `ci.yml` runs an always-on `test` job gating the guarded `publish` job, which publishes only when `package.json` holds a version not yet on the registry, with the dist-tag derived from the version (`-` suffix → `beta`, else `latest`). See root `CLAUDE.md` "Branch & CI Model".

**Drop's scope:** Everything BEFORE `ship.deployments.upload()`. The SDK handles everything after — which is why drop has no upload vocabulary of its own (see "Status Values").

## Architecture

Seven flat modules, no barrel directories. The layout is the design: one file per
concern, each named for what it holds.

```
src/
├── index.ts      # CURATED exports — the public API is a decision
├── useDrop.ts    # The hook — React state, DOM events, prop getters
├── process.ts    # THE PIPELINE — pure, no React, no Ship instance
├── entries.ts    # FileSystemEntry traversal — the one un-fakeable collaborator
├── files.ts      # File ↔ ProcessedFile + the path rules
├── zip.ts        # ZIP extraction (fflate) + path sanitization
├── types.ts      # Types; the status vocabulary is Ship's verbatim
└── testing.ts    # Consumer mock utilities (/testing subpath)
```

`entries.ts` is alone in its file for a reason that is both architectural and
testing-shaped: `FileSystemEntry` objects cannot be constructed in ANY browser
(they come from a real user gesture over real OS paths). Keeping the traversal in
one module is what makes "every other module is tested against real platform
objects" a true statement rather than an aspiration. Don't merge it back into
`files.ts`.

### The public API is curated, not swept

`src/index.ts` names its exports one by one. The modules behind it export helpers
that are deliberately NOT public — `filePath`, `setRelativePath`, `applyStatus`,
`createProcessedFile`, `stripCommonPrefix`, `toValidatable`, `detectSourceName`,
`traverseFileTree`, `extractZipToFiles`, `isZipFile`, `normalizePath` — because
publishing them puts semver around implementation detail. `export *` from the leaf
modules would do exactly that; `tests/index.test.ts` fences both directions.

**Two** runtime values are public: `useDrop` and `processFiles`. The types beside them (`DropOptions`, `DropReturn`, `DropzonePropsOptions`, `PickerMode`, `DropInputProps`) are named rather than inline, so a consumer wrapping the hook can hold the shapes it spreads.

The file-status vocabulary is deliberately NOT among them. `FileValidationStatus`
belongs to `@shipstatic/types` and is already re-exported by `@shipstatic/ship`,
which every consumer of drop depends on. Drop once re-exported it as
`FileValidationStatus` — a second name for one object, so a consumer of both packages had
to wonder whether they differed. Use the platform's name; don't re-badge it.

### The pipeline/hook split (load-bearing)

`processFiles()` in `process.ts` owns every rule between "here are some
Files" and "here is a verdict": source-name detection, ZIP extraction, unbuilt
detection, junk filtering, path normalization, entry-point and limit validation.
It takes `PlatformLimits` — **not** a `Ship` instance — and never throws;
expected and unexpected failures alike come back as an `error` outcome.

`useDrop` is then a state machine over it: guard → `setState(processing)` →
`await processFiles(...)` → `setState(outcome)`. Nothing else.

**Keep new pipeline rules in `process.ts`.** The split is what makes them
testable without a renderer: a rule inside the hook can only be reached by
rendering and faking a client, which is how a 5:1 test-to-source ratio and ten
files mocking a package of pure functions came about (see "Testing canon").

## Quick Reference

```bash
pnpm test                  # watch (main project, jsdom)
pnpm test:ci               # single run
pnpm coverage              # the suite + the ratchet — what CI runs
pnpm test:browser          # capability tier — real Chromium via playwright
pnpm typecheck             # tsc over src AND tests, 0 errors
pnpm lint                  # biome check .
pnpm check:package         # publint + attw over the built artifact
pnpm build                 # tsup (ESM + CJS + dts)
```

## Ship SDK Integration

Drop delegates every algorithm it can to the SDK, and mocks none of them — they
are pure functions:

| Function | Purpose |
|----------|---------|
| `validateFiles(files, limits)` | Validate against platform limits |
| `filterJunk(paths, {allowUnbuilt})` | Filter .DS_Store, Thumbs.db, dot files (`.well-known` allowed); THROWS on unbuilt markers |
| `optimizeDeployPaths(paths)` | Common-prefix stripping — the one source of truth for deploy paths |
| `pluralize`, `formatFileSize` | Message formatting |

From `@shipstatic/types` it takes `FileValidationStatus`, `hasUnbuiltMarker`,
`isShipError` and `WEB_FILE_ACCEPT` (the files-picker `accept` hint). That
package is a **devDependency and is bundled** — tsup externalizes only
`dependencies`/`peerDependencies` — so a constant added there reaches drop's
dist inlined, at no runtime-dependency cost to consumers.

The only I/O collaborator is `ship.getLimits()` — and `DropOptions.ship` is typed
as `Pick<Ship, 'getLimits'>`, mirroring the SDK's own resource-factory doctrine
("factories only depend on the callbacks they actually need"). A real `Ship`
satisfies it, and no test needs a cast.

`formatFileSize` is NOT re-exported: every consumer already imports it from
`@shipstatic/ship` directly, so a pass-through would be surface for nothing.

### The handoff contract

`toValidatable(file)` in `process.ts` is the exact shape drop hands to Ship:

```typescript
{ name: file.path, size: file.size }   // the DEPLOY PATH is the name
```

**The deploy path is the name**, because server-side validation runs on full
paths. `ProcessedFile` is deliberately *not* passed through even though it now
structurally satisfies `ValidatableFile` — its `name` is the display basename, so
passing it would validate a different string than the platform does. Pinned in
`tests/process-contract.test.ts`.

**Key detail:** Drop sets `webkitRelativePath` on each File object. Ship SDK reads that property to preserve folder structure during deployment.

## State Machine

```
idle → processing → ready (success)
                  → error (failed)
```

**Dragging is not a phase.** It is a pointer state orthogonal to the lifecycle,
carried as `isDragging`, so a ready set stays ready while a new folder is dragged
over it. Putting it in the phase union costs two re-derivations — an allow-list of
states a drag may leave, and a re-scan of file statuses to decide which phase to
return to — which is a second source of truth for something the state already
knows. Don't reintroduce it.

Convenience booleans: `isProcessing`, `isDragging`, `isInteractive`
(`idle` or `ready`), `hasError`. Use `phase` for switch-case.

**State is the only observation channel.** There are no `onFilesReady` /
`onValidationError` callbacks: a hook already re-renders on every transition, so
callbacks would be a second way to learn the same thing — and the one that can
disagree. Consumers run side effects from a `useEffect` on `phase`, which is what
`web/www` did even when the callbacks existed. This is also why there is no
`ClientError` type; it was a renaming of `DropStatus`.

## Processing Flow

```
1. Detect source name (ZIP name > folder name > filename)
2. Extract ZIP if a SINGLE ZIP was dropped
3. Detect unbuilt project (hasUnbuiltMarker) → needsBuild
4. Strip node_modules files if needsBuild
5. Filter junk (allowUnbuilt when needsBuild)
6. Create ProcessedFile[] with paths
7. Strip common directory prefix (always — see Design Decisions)
8. Validate entry point (index.html at root for built sites, anywhere for unbuilt)
9. If needsBuild: skip deploy validation → ready (build service validates output)
10. Else: validateFiles against ship.getLimits() → ready/error
```

**ZIP behavior:** Single ZIP → extract contents. Multiple files including ZIPs → treat ZIPs as regular files.

**ZIP inflation is asynchronous** (`fflate`'s `unzip`, not `unzipSync`). The
synchronous variant blocks the tab for the duration of the inflate, which is
unacceptable on this package's headline interaction where a large folder is the
normal case.

### Build-on-Upload Detection

Drop detects unbuilt projects (source code with `package.json`/`node_modules`) and surfaces a `needsBuild: boolean` signal. When true:

- `traverseFileTree` skips `node_modules` directories entirely (performance — 50K+ files)
- Remaining `node_modules` files (from the `webkitdirectory` folder picker) are stripped
- `filterJunk` runs with `allowUnbuilt: true` (no throw on markers)
- Deploy validation is skipped — source files aren't deploy output
- All files go straight to `ready` status

The web app reads `drop.needsBuild` and passes `build: true, prerender: true` to the SDK. Drop doesn't know about `build`/`prerender` — it only detects and signals.

## Prop Getters API

```typescript
<div {...drop.getDropzoneProps()}>      // Handles drag events + click
  <input {...drop.getInputProps()} />   // Hidden file input with folder support
</div>

// Drag-only (no click-to-open), offering both pickers:
<div {...drop.getDropzoneProps({ clickable: false })}>
  <input {...drop.getInputProps('folder')} />
  <input {...drop.getInputProps('files')} />
  <button onClick={() => drop.open('folder')}>Select folder</button>
  <button onClick={() => drop.open('files')}>Select files</button>
</div>
```

`getDropzoneProps()` handles `webkitGetAsEntry` internally for proper folder traversal. Manual `processFiles()` callers lose this.

### The picker has a mode, so the mode is an argument

`PickerMode` is `'folder' | 'files'`, and **folder is the default** — a bare
`getInputProps()` / `open()`, and the dropzone's own click, address the folder
picker exactly as they always have. The addition is purely additive.

Each mode owns its own element and its own ref, so a UI offering both renders
**two inputs**; `open(mode)` clicks whichever is mounted, and warns by name when
it is not (a missing input is otherwise a silent no-op — the one footgun the
two-element shape introduces).

Exactly one attribute distinguishes them: `webkitdirectory` in folder mode,
`accept` in files mode. Never both — a folder picker ignores `accept`, so
emitting it there would advertise a filter that does not apply.

`getDropzoneProps`'s `onClick` **wraps** `open()` rather than passing it by
reference. React hands a click handler a `MouseEvent`, so by reference that
event becomes the mode argument — which is why `open` treats `'files'` as the
exception and everything else as folder, and why the dropzone click has its own
test.

Three shapes were considered and declined. **Four members**
(`getFolderInputProps`/`openFolder` + `getFilesInputProps`/`openFiles`) spends
two names on one axis and leaves the existing `open()` ambiguous forever.
**Toggling `webkitdirectory`** on one live node before `.click()` writes an
attribute behind React's back that a re-render then reverts. **Minting a
detached `<input>` inside `open()`** would delete `getInputProps` entirely and
reads as simpler, but it takes away the element consumers style, label and
query in tests — and a headless hook that creates DOM has stopped being
headless.

### The picker filter is a hint, and the platform owns the rule

Files mode carries `accept={WEB_FILE_ACCEPT}` from `@shipstatic/types` — the
same list `web/my` and `web/www` would otherwise each invent. It biases what a
file dialog shows first and **decides nothing**: every dialog offers an
all-files escape, and drag-and-drop ignores `accept` outright.

The verdict on any file is `validateFiles`, downstream of both entry points, so
a picked `.exe` and a dropped `.exe` fail identically with the platform's own
message. That equivalence is not a convention — `tests/useDrop-events.test.ts`
("a picked file set deploys identically to a dropped one") asserts phase, status,
deploy paths, `webkitRelativePath`, and source name are equal across the two
paths for loose files, a ZIP, a blocked extension, and a missing entry point.

Do not read `accept` as authority in either direction. It can express only an
allowlist while the platform's rule is a blocklist, so it is necessarily
*narrower* than what the platform hosts; treating it as the rule would reject
files the platform serves. `cloudflare/api` fences the one invariant that
matters — the picker never offers what the platform will refuse — because the
blocklist is the API's, not this package's.

**Which is also why the blocklist reaches drop as DATA.** `validateFiles` reads
`PlatformLimits.blockedExtensions` off the limits `processFiles` already
receives, so drop refuses exactly what the platform named at that moment and
nothing it merely used to name. `PLATFORM_LIMITS` in the builders carries a
SAMPLE list for that reason — enough to prove the pipeline honours what it was
given, deliberately not a copy of the platform's real policy.

## Status Values

Drop uses `FileValidationStatus` from `@shipstatic/types` directly — imported by
its real name, never aliased:

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting validation |
| `processing_error` | Failed during processing (before validation) |
| `excluded` | Excluded with a warning (e.g. empty files — not an error) |
| `validation_failed` | Failed validation (blocks deployment) |
| `ready` | Passed validation, ready to deploy |

**Drop adds no statuses of its own, and must not.** Any addition widens
`FileStatus` past `FileValidationStatusType`, which is what makes `ProcessedFile`
inexpressible as a `ValidatableFile` and forces a hand-projection at the boundary.
An `uploading`/`complete` lifecycle in particular would describe states this
package never enters. `ProcessedFile` carries no `md5` or `progress` for the same
reason: the SDK computes checksums, and drop never uploads.

### Atomic Validation

If ANY file fails validation, ALL non-excluded files are marked `validation_failed`. Empty files (0 bytes) are marked `excluded` with warnings (not errors) and don't block deployment. Use `drop.reset()` to clear and retry.

## Design Decisions

- **No MD5 calculation** — Ship SDK calculates MD5 during deployment; duplicate calculation wastes cycles.
- **No MIME database** — `ProcessedFile.type` is the browser's own report. Bundling `mime-db` to second-guess it cost ~200 KB of a 258 KB bundle to populate a field no consumer reads, while the platform derives Content-Type server-side from the path (`cloudflare/api/src/lib/storage.ts` → `deriveContentType`). Bundle is now ~31 KB.
- **No individual file removal** — Atomic validation means removing one file requires re-validating all. Call `reset()` and re-drop.
- **Prefix stripping is unconditional** — there was a `stripPrefix` option; its only reachable effect on a built site was to leave `index.html` nested and fail the entry-point check, and on input with no common prefix it was a no-op. An option whose every setting is either "correct" or "broken" is not an option.
- **Why Drop exists** — Ship SDK handles deployment but lacks ZIP extraction (browser-specific), React state management, drag & drop with `webkitGetAsEntry` folder traversal, and UI-friendly file status tracking.

## Key Gotchas

- **DataTransfer synchronous access** — `dataTransfer.items` must be accessed synchronously in drop handlers; they're garbage collected after the first `await`. The hook collects every entry first, then traverses. Manual `processFiles()` callers lose folder structure.
- **The hidden input has two modes** — `getInputProps()` defaults to a **folder** picker (`webkitdirectory`); `getInputProps('files')` is a plain multi-file picker. A UI offering both renders both inputs, and `open('files')` on an unmounted one warns rather than failing silently. Individual files also still arrive by drag-and-drop, and take the identical path (see "The picker has a mode").
- **`stripCommonPrefix` mutates File objects** — Returns new `ProcessedFile` objects (immutable), but **mutates** `File.webkitRelativePath` directly. Intentional — Ship SDK reads `webkitRelativePath` from raw File objects.
- **`webkitRelativePath`** — Don't mutate it between Drop and SDK; Ship SDK reads it for deployment paths.
- **`readEntries` batches at 100** — Real Chromium returns at most 100 directory entries per call and signals the end with an empty batch, so the reader must loop. A single call silently truncates every folder over 100 files.
- **Folder traversal silently skips errors** — Unreadable files (permissions, etc.) are logged to console but skipped. No programmatic notification to the caller.

## Testing

```bash
pnpm test:ci        # 11 files, 229 tests, ~2s
pnpm coverage       # + the ratchet (what CI runs)
pnpm test:browser   # 19 tests, real Chromium
pnpm typecheck      # src AND tests, 0 errors
```

| Project | Path | Environment |
|---------|------|-------------|
| `main` | `tests/**` | jsdom |
| `browser` | `tests-browser/**` | real Chromium (playwright) |

```
tests/
├── architecture/          # Fences: integrity, naming
├── fixtures/builders.ts   # The ONE fixture source
├── <module>.test.ts       # Mirror axis — tests/<m>.test.ts ↔ src/<m>.ts
├── index.test.ts          # Public-surface fence
└── setup.ts               # Hermeticity (no-network guard)
tests-browser/             # Capability tier — real Chromium
```

**`tests/**` is typechecked.** `pnpm typecheck` runs `tsconfig.check.json` over
`src` and `tests` together. This is the load-bearing gate: vitest transpiles
through esbuild WITHOUT checking types, so until 2026-07-27 nothing checked the
test tree — which is what let all of this sit there passing:

- `const validatable: ValidatableFile = processed;` under a comment calling
  itself a *"compile-time check"*, in a suite that was never compiled. It did not
  hold.
- A validation mock whose passing and failing factories returned mutually
  incompatible shapes, neither checked against Ship's real return type.
- A published `/testing` return type that **erased** the assertion helpers it
  actually returns, so `spies.reset.toHaveBeenCalled()` was a type error for
  every consumer — including `web/my`, whose tests call it.

### Testing canon

The cohesion contract. A change that breaks one of these needs a recorded
exception, not a workaround:

1. **Files are real.** Real `File`/`Blob` objects with real bytes, and real
   archives built with `fflate`'s `zipSync`. The suite once monkey-patched
   `File.prototype.arrayBuffer`/`text` suite-wide against a `_testContent`
   *string*, so no test read real bytes and binary content was inexpressible —
   in a package whose subject is ZIP payloads.
2. **Pure SDK functions are never mocked.** `validateFiles`, `filterJunk`,
   `optimizeDeployPaths`, `pluralize` run for real everywhere. The ONLY
   stand-in is `shipStub()`, because `getLimits()` is an HTTP call.
3. **Builders are the only fixture source** (`tests/fixtures/builders.ts`), and
   they take explicit content — no `Date.now()` in an asserted value.
4. **One entry-tree fake, behavioral and recorded.** See below.
5. **No outbound network.** `tests/setup.ts` throws on any `fetch`, naming the
   URL — the SDK's default API base is production.
6. **Console policy is config, not per-file spies.** `silent: 'passed-only'`
   keeps passing tests quiet and prints everything a FAILING test logged. Only
   spies a test asserts on are created locally.

### The one unavoidable fake

A synthetic `DataTransfer` cannot produce real `webkitGetAsEntry()` directory
entries in **any** browser, Chromium included — they come from a real user
gesture over real OS paths. So `traverseFileTree` has no real-runtime tier
available, and its collaborator is faked in `tests/fixtures/builders.ts`
(`fileEntry` / `dirEntry` / `entryTree`).

That fake models the **spec**, not a convenient answer:

- `readEntries` yields at most `READ_ENTRIES_BATCH_SIZE` (100) entries per call
  and ends with an EMPTY batch. A one-shot fake would let a single-call
  implementation pass while truncating every large folder in production.
- `createReader()` returns a FRESH cursor, so a directory can be read twice. The
  previous fake latched on a per-entry boolean and yielded nothing on a re-read.

Everything else drop does — `File` bytes, `webkitRelativePath`, ZIP inflation,
the whole pipeline — needs no fake and is certified for real in `tests-browser/`.

### The three fences

| Fence | Catches |
|---|---|
| `architecture/test-integrity.test.ts` | A test file that reaches NO production code — the tautology class. A tautology neither raises nor lowers coverage, so no ratchet can see it. Reach resolves transitively through local helpers. Its only exceptions are the two fences themselves, which read the tree as data. |
| `architecture/test-naming.test.ts` | Layout drift: a filename describing the test instead of its subject (`-branches`), a mirror file with no `src/` counterpart, an aspect split not recorded in the fence, a recorded entry gone stale, or a `src/` module with no mirror test. |
| `coverage.thresholds` | Coverage decay. A ratchet — it only goes up. Currently 99/93/99/99 against a measured 99.56 / 94.31 / 100 / 99.49. |

**Recorded aspect splits** — one subject, more than one mirror file. Legal under
the layout law (`<module>-<aspect>.test.ts`), and the naming fence fails the
suite if a split is not named in it by full basename:

| Module | Files | Why |
|---|---|---|
| `src/process.ts` | `process`, `process-contract` | The drop→SDK handoff, isolated from the pipeline that performs it — this is the file that must fail when the SDK moves. |
| `src/useDrop.ts` | `useDrop`, `useDrop-events` | The hook's DOM surface (drag/drop, hidden input, prop getters), separate from its state machine and actions. |

### Consumer Test Utilities

The `/testing` subpath exists for ONE reason: a `DropReturn` has twenty fields,
and a component test that takes `drop` as a prop should not have to build them.

```typescript
import {
  createMockDrop,
  createMockProcessedFile,
  createMockFileWithPath,
} from '@shipstatic/drop/testing';
```

| Function | Purpose |
|----------|---------|
| `createMockDrop(overrides?)` | A complete `DropReturn`. Takes `Partial<DropReturn>` — there is no separate options vocabulary, because every option IS a field. Convenience booleans and `validFiles` derive from `phase`/`files` unless overridden. |
| `createMockProcessedFile(name, options?)` | A `ProcessedFile` backed by a real `File` |
| `createMockFileWithPath(name, path, content?, type?)` | A real `File` carrying a folder-relative path |
| `mockUseDrop(overrides?)` | A `useDrop` replacement, for consumers that CALL the hook instead of receiving `drop` as a prop |

**It ships no spy, matcher, or status helpers, deliberately.** Interactions are
asserted with the consumer's own framework, passed straight through the overrides:

```tsx
const reset = vi.fn();
const drop = createMockDrop({ phase: 'ready', reset });
expect(reset).toHaveBeenCalled();   // real vitest matcher, real deep equality
```

Three rules hold this line, each of which was learned the hard way:

1. **Never ship a spy API.** A hand-rolled `toHaveBeenCalledWith` compares by
   identity where every real framework compares deeply — a footgun published as a
   feature. `Partial<DropReturn>` makes the consumer's `vi.fn()` strictly better.
2. **Never ship status factories.** They duplicate production copy and drift from
   it; a `createMockReadyStatus` once emitted `"1 file ready."` where the pipeline
   emits `"1 file ready"`. `DropStatus` is `{title, details}` — construct it
   inline, or get it from a real pipeline run.
3. **A consumer that receives `drop` as a prop needs no module mock at all.**
   That is the pattern to steer consumers toward — `web/my`'s `DeployDropArea`
   takes `drop: DropReturn` and has 22 clean `createMockDrop` call sites, while
   every component that calls `useDrop` itself needs `vi.mock`. A
   `<DropProvider>` + context hook was considered and **declined**: it is the
   canonical React answer, but it doubles this package's consumption API to save
   three lines in three files, and one headless hook is the whole identity.
   `mockUseDrop` exists for the callers that remain.
4. **Never wrap a one-line constructor.** `createMockFile` was
   `new File([c], n, {type})`. `createMockFileWithPath` survives because
   `webkitRelativePath` is read-only and needs `defineProperty`.

### Testing Philosophy (for consumers)

- **Mock at the boundary** — Mock `DropReturn`, not internal utilities
- **Test states, not implementation** — Focus on phase transitions and UI states
- **Use your own spies** — pass `vi.fn()` through `createMockDrop` overrides
- **Dragging is a flag** — `createMockDrop({ isDragging: true })`, independent of `phase`

## Post-Launch

- **TypeScript 7** — `typescript@7.0.2` exists (the native compiler). Drop stays
  on `^5.9.3` with ship and the rest of the monorepo; adopting it is an org-wide
  toolchain decision, not a per-package one.

---

*Drop is a companion to Ship SDK. For SDK patterns (auth, HTTP, CLI), see the `@shipstatic/ship` package.*
