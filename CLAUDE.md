# CLAUDE.md

Claude Code instructions for the **Drop** package.

## Package Identity

**@shipstatic/drop** is a React companion to the Ship SDK. It provides what the
SDK lacks for browser deployments: ZIP extraction, drag and drop with folder
support, and React state management.

**Maturity:** stable; semver applies, so a breaking change needs a major
version bump.

**Releasing:** bump `version` in `package.json` and push. `ci.yml` runs the
`test` job, then publishes a version not yet on the registry: a prerelease
(any `-` suffix) to `beta` (from either branch, normally `development`), a stable one to `latest` from
`main`. Nothing is published by hand.

**Drop's scope:** everything BEFORE `ship.deployments.upload()`. The SDK
handles everything after, which is why drop has no upload vocabulary of its
own (see "Status Values").

## Architecture

Nine flat modules, no barrel directories, one file per concern:

```
src/
├── index.ts      # CURATED exports: the public API is a decision
├── useDrop.ts    # The hook: React state, DOM events, prop getters
├── process.ts    # THE PIPELINE: pure, no React, no Ship instance
├── source.ts     # What a project sent for building carries (.gitignore read as git does)
├── entries.ts    # FileSystemEntry traversal: the one un-fakeable collaborator
├── files.ts      # File ↔ ProcessedFile + the path rules
├── zip.ts        # ZIP extraction (fflate) + path sanitization
├── types.ts      # Types; the status vocabulary is Ship's verbatim
└── testing.ts    # Consumer mock utilities (/testing subpath)
```

**`entries.ts` stays alone in its file.** `FileSystemEntry` objects cannot be
constructed in ANY browser (they come from a real user gesture over real OS
paths), so keeping the traversal in one module is what makes "every other
module is tested against real platform objects" true. Don't merge it into
`files.ts`.

### The public API is curated, not swept

`src/index.ts` names its exports one by one. The helpers behind it are
deliberately NOT public (`filePath`, `setRelativePath`, `applyStatus`,
`createProcessedFile`, `stripCommonPrefix`, `toValidatable`,
`detectSourceName`, `traverseFileTree`, `extractZipToFiles`, `isZipFile`,
`normalizePath`, `projectSource`, `rebase`): publishing them puts semver
around implementation detail. `export *` from the leaf modules is refused;
`tests/index.test.ts` fences both directions.

**Two** runtime values are public: `useDrop` and `processFiles`. The types
beside them (`DropOptions`, `DropReturn`, `DropzonePropsOptions`,
`PickerMode`, `DropInputProps`) are named rather than inline, so a consumer
wrapping the hook can hold the shapes it spreads.

**The file-status vocabulary is not re-exported.** `FileValidationStatus`
belongs to `@shipstatic/types` and is re-exported by `@shipstatic/ship`, which
every consumer of drop depends on. A second name for one object makes a
consumer of both wonder whether they differ: use the platform's name, never a
re-badged one.

### The pipeline/hook split (load-bearing)

`processFiles()` in `process.ts` owns every rule between "here are some Files"
and "here is a verdict": source-name detection, ZIP extraction, unbuilt
detection and the project's source, junk filtering, path normalization, entry
point and limit validation. It takes `PlatformLimits`, **not** a `Ship`
instance, and never throws: expected and unexpected failures alike come back
as an `error` outcome.

`useDrop` is a state machine over it, one function (`prepare`) for every way a
selection arrives: guard → `setState(processing)` → collect the files and read
the limits, together → `await processFiles(...)` → `setState(outcome)`.
Nothing else.

**Keep new pipeline rules in `process.ts`.** A rule inside the hook can only be
reached by rendering and faking a client; in the pipeline it is a pure
function test (see "Testing canon").

### A run has a lifetime, and one `AbortController` per run is all of it

- **A run is one selection from the moment it is made**, so it begins BEFORE a
  dropped folder is read: a picker hands its files over at once, a drop
  captures its entries synchronously and reads the folders inside the run.
- **The controller's presence is the re-entry guard**; its signal stops the
  limits read on a cancel (`reset()`); its `aborted` flag is how a cancelled
  run knows to say nothing more. Preparation outlives a cancel (a folder being
  read, an archive inflating, a request sent), so a run that could still write
  state after `reset()` would finish over the next selection, and the person
  would upload files they did not choose.
- **The folder read is not stopped on a cancel**: it writes nothing, and the
  check after it is the whole control. Nor is the pipeline, which is why it
  says its status before its first wait (`tests/process.test.ts`): a cancelled
  run then has nothing left to say, and its outcome is dropped at the check.
- **A drop carrying no files starts no run** and leaves the current selection
  alone. A dropped folder with nothing in it to read is the `error` phase
  under the pipeline's own heading ("Can't deploy this", "The folder has no
  files."), since the pipeline is never asked about no files.
- **`dataTransfer.files` is never read.** Every file arrives through its item,
  and a browser lists a dropped folder there as an entry that is not a file.
- **Two steps can throw** (the pipeline never does): reading a dropped folder,
  which refuses one it cannot read whole, and the limits read. Either is the
  `error` phase in the client's own words, never a hook left on
  "Processing...".

Held in `tests/useDrop.test.ts`, "a run's lifetime".

## Quick Reference

```bash
pnpm test                  # watch (main project, jsdom)
pnpm test:ci               # single run
pnpm coverage              # the suite + the ratchet: what CI runs
pnpm test:browser          # capability tier: real Chromium via playwright
pnpm typecheck             # tsc over src AND tests
pnpm lint                  # biome check .
pnpm check:package         # publint + attw over the built artifact
pnpm build                 # tsup (ESM + CJS + dts)
```

## Ship SDK Integration

Drop delegates every algorithm it can to the SDK, and mocks none of them (they
are pure functions):

| Function | Purpose |
|----------|---------|
| `validateFiles(files, limits)` | Validate against the platform's deploy rules and limits |
| `filterJunk(paths)` | A built site's junk: .DS_Store, Thumbs.db, dot files (`.well-known` allowed); THROWS on unbuilt markers. Never run on a project's source |
| `optimizeDeployPaths(paths)` | Common-prefix stripping: the one source of truth for deploy paths |
| `pluralize`, `formatFileSize` | Message formatting |

From `@shipstatic/types` it takes `FileValidationStatus`, `hasUnbuiltMarker`
and `WEB_FILE_ACCEPT`. That package is a **devDependency and is bundled**
(tsup externalizes only `dependencies` and `peerDependencies`), so a constant
added there reaches drop's dist inlined, at no runtime-dependency cost.

The only I/O collaborator is `ship.getLimits()`, and `DropOptions.ship` is
typed `Pick<Ship, 'getLimits'>`, after the SDK's own rule that a factory
depends only on the callbacks it needs. A real `Ship` satisfies it, and no
test needs a cast.

`formatFileSize` is NOT re-exported: every consumer already imports it from
`@shipstatic/ship`, so a pass-through would be surface for nothing.

### The handoff contract

`toValidatable(file)` in `process.ts` is the exact shape drop hands to Ship:

```typescript
{ name: file.path, size: file.size }   // the DEPLOY PATH is the name
```

**The deploy path is the name**, because the platform validates full paths.
`ProcessedFile` structurally satisfies `ValidatableFile` but is deliberately
not passed through: its `name` is the display basename, so it would validate
a different string than the platform does. Pinned in
`tests/process-contract.test.ts`.

**Drop sets `webkitRelativePath` on each File**, and the SDK reads it to keep
the folder structure.

## State Machine

```
idle → processing → ready (success)
                  → error (failed)
```

**Dragging is not a phase.** It is a pointer state orthogonal to the
lifecycle, carried as `isDragging`, so a ready set stays ready while a new
folder is dragged over it. In the phase union it would need an allow-list of
states a drag may leave and a re-scan of file statuses to find the way back: a
second source of truth for something the state already knows. Don't
reintroduce it.

Convenience booleans: `isProcessing`, `isDragging`, `isInteractive` (`idle` or
`ready`), `hasError`. Use `phase` for switch-case.

**State is the only observation channel.** No `onFilesReady` or
`onValidationError` callbacks: the hook re-renders on every transition, so
callbacks would be a second way to learn the same thing, and the one that can
disagree. Consumers run side effects from a `useEffect` on `phase`. There is
no `ClientError` type for the same reason (it renamed `DropStatus`).

## Processing Flow

```
1. Detect source name (ZIP name > folder name > filename)
2. Extract ZIP if a SINGLE ZIP was dropped
3. Detect unbuilt project (hasUnbuiltMarker) → needsBuild
4. If needsBuild: keep the project's source (projectSource: no node_modules, .git or __MACOSX, nothing .gitignore lists)
5. If a built site: filter junk
6. Create ProcessedFile[] with paths
7. Strip common directory prefix (always; see Design Decisions)
8. If needsBuild: ready as it stands (the build decides the site and validates it)
9. validateFiles against ship.getLimits() → ready/error: each file, then the site as a whole, its home page (index.html at its root) among them
```

ZIPs among several files are regular files. **ZIP inflation is asynchronous** (`fflate`'s `unzip`, never `unzipSync`): the
synchronous variant blocks the tab for the whole inflate, on the interaction
where a large folder is the normal case.

### Build-on-Upload Detection

Drop detects an unbuilt project (source with `package.json` or
`node_modules`) and sets `needsBuild: boolean`. When true:

- `traverseFileTree` skips `node_modules` directories entirely (speed: 50K+
  files).
- `projectSource` (`source.ts`) keeps the project as its repository holds it
  (below).
- `filterJunk` does not run: what `projectSource` kept is sent, dot files and
  empty files included.
- Neither the entry-point check nor deploy validation applies, and all files
  go straight to `ready`.

**A project's source is never held to the entry-point rule.** Astro, Next.js,
Nuxt, SvelteKit, Gatsby, Docusaurus and Eleventy have no `index.html` until
built, so a check on the source would refuse every clean copy (a GitHub
"Download ZIP" included) and pass only a folder carrying an old build. The
platform's build decides what the site is and refuses a build that produced
none, so its sentence is the refusal the person sees. Held in
`tests/process.test.ts` from both sides: under "processFiles — unbuilt
projects" an Astro-shaped project is ready, and under "processFiles — entry
point" a built site with no `index.html` at its root is refused.

The web app reads `drop.needsBuild` and passes `build: true, prerender: true`
to the SDK. Drop does not know about `build` or `prerender`; it only detects
and signals.

### A project sent for building is the repository as git holds it

Four things are left out: `node_modules` (the build installs it), `.git`
(git's own record, which no checkout lists), `__MACOSX` (a Mac ZIP's Finder
metadata, whose `._` files trip a build that reads a whole folder), and
whatever the project's `.gitignore` lists. Everything else is sent: dot files
a build reads (`.npmrc`, `.yarnrc.yml`, `.vitepress/`), empty files it
imports, and a `.env` the `.gitignore` does not list. Nothing after
`projectSource` filters the set again: the junk filter judges only a built
site, the SDK carries a build's source as given, and the API keeps empty files
on a build request. Every host that builds from git works this way, and
`railway up` honours `.gitignore` on upload the same way.

- **Why, first:** which site gets published. A stale `dist/` beside a project
  that builds to `out/` could be published in place of the new build, with no
  error. Then size, and then files kept out of git (a key, a service account),
  which no longer leave the person's machine.
- **The cost, accepted:** an app that imports an ignored file fails its build,
  and the build names the file, as a clean CI checkout would.
- **Read as git reads it.** `ignore` does the matching. Each nested
  `.gitignore` is rewritten to the root of the drop and added shallowest
  first, so a deeper file wins as in git, and a folder git excludes keeps
  excluding what its own `.gitignore` re-includes. A `.gitignore` in a folder
  whose name holds a line break is refused: gitignore cannot escape one. The
  folder's name is escaped before it joins a pattern, since `ignore` would
  read `[slug]`, `#1-app` or `!important` as glob syntax and switch every rule
  off. A line that names nothing (`!`, `/`) is no pattern, as in git: rewritten, it
would name the whole folder. Matching
  runs on raw paths, before the common folder is stripped.
- **`tests/source.test.ts` holds the result to git itself**: each case is a
  real repository, and `git ls-files --others --exclude-standard` runs with
  every personal and system setting shut out (`core.excludesFile`, `HOME` and
  `XDG_CONFIG_HOME` included) and `core.ignorecase` pinned on. Every case runs
  twice, the second time inside a folder named `![#] *?`, so a folder name
  that leaks into a pattern turns it red.
- **Only for a project sent for building.** A built site is served as dropped.
- **Silent**, like the `node_modules` rule: "N files ready. We'll build the
  project." counts what is sent. Most people who drop a project never wrote
  its `.gitignore`, so a line about it raises a question rather than
  answering one.
- **`ignore` is pinned exactly** (`7.0.12`), unlike `fflate`'s caret: a caret
  range hands every consumer's next install whatever was published that day.

**Refused:**

- **One `ignore` matcher per `.gitignore`**, asked with paths relative to its
  folder. `ignore` checks a path's parents only inside one matcher, so a
  nested `!generated/` could not re-include what a root `generated/` excludes,
  which git allows; doing it right means git's precedence by hand or
  `ignore`'s private API.
- **Checking the request size at drop time**: a second copy of the SDK's
  request arithmetic, whose sentence already says what to do.
- **Leaving out output folders by name** (`dist/`, `build/`, `out/`): Vue CLI 2
  keeps webpack config in `build/`, and `public/` is source in Vite, Next and
  CRA. The three names that ARE left out are never project content.
- **Skipping ignored folders during the traversal.** The traversal skips only
  `node_modules`, for speed; the rule lives once in `projectSource`, and "a
  picked file set deploys identically to a dropped one" holds it.
- **Reading git's index, `.git/info/exclude` or a global excludes file.** A
  file committed despite `.gitignore` is left out, and the build names it; a
  clean copy carries neither of the others.
- **Matching with case**, as git does on Linux: these projects are made on Mac
  and Windows, where git ignores case.

**It lives in drop because drop is the only client that sends a project** (the
CLI refuses a project folder, ship's `src/node/core/node-files.ts`). It moves
to the SDK the day a second client sends one.

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

`getDropzoneProps()` handles `webkitGetAsEntry` internally for folder
traversal; a manual `processFiles()` caller loses it.

### The picker has a mode, so the mode is an argument

`PickerMode` is `'folder' | 'files'`, and **folder is the default**: a bare
`getInputProps()` or `open()`, and the dropzone's own click, address the
folder picker.

- **Each mode owns its own element and ref**, so a UI offering both renders
  **two inputs**; `open(mode)` clicks whichever is mounted and warns by name
  when it is not (a missing input is otherwise a silent no-op).
- **Exactly one attribute distinguishes them**: `webkitdirectory` in folder
  mode, `accept` in files mode, never both, since a folder picker ignores
  `accept` and emitting it there would advertise a filter that does not apply.
- **`getDropzoneProps`'s `onClick` wraps `open()`** rather than passing it by
  reference: React hands a click handler a `MouseEvent`, which would become the
  mode argument. That is why `open` treats `'files'` as the exception and
  everything else as folder, and why the dropzone click has its own test.

**Refused shapes:** four members (`getFolderInputProps`/`openFolder` plus
`getFilesInputProps`/`openFiles`) spend two names on one axis and leave
`open()` ambiguous forever. Toggling `webkitdirectory` on one live node before
`.click()` writes an attribute behind React's back that a re-render reverts. A
detached `<input>` minted inside `open()` reads as simpler but takes away the
element consumers style, label and query in tests, and a headless hook that
creates DOM has stopped being headless.

### The picker filter is a hint, and the platform owns the rule

Files mode carries `accept={WEB_FILE_ACCEPT}` from `@shipstatic/types`, the
one list every web surface would otherwise invent. It biases what a file
dialog shows first and **decides nothing**: every dialog offers an all-files
escape, and drag and drop ignores `accept` outright.

The verdict on any file is `validateFiles`, downstream of both entry points,
so a picked `.exe` and a dropped `.exe` fail identically with the platform's
message. `tests/useDrop-events.test.ts` ("a picked file set deploys
identically to a dropped one") asserts phase, status, deploy paths,
`webkitRelativePath` and source name are equal across both paths for loose
files, a ZIP, a blocked extension and a missing entry point.

**Never read `accept` as authority.** It is an allowlist while the platform's
rule is a blocklist, so it is *narrower* than what the platform hosts. The
API's suite fences the one invariant that matters, that the picker never
offers what the platform refuses, because the blocklist is the API's.

**So the blocklist reaches drop as DATA.** `validateFiles` reads
`PlatformLimits.blockedExtensions` off the limits `processFiles` receives, so
drop refuses exactly what the platform names at that moment. `PLATFORM_LIMITS`
in the builders carries a SAMPLE list: enough to prove the pipeline honours
what it was given, deliberately not a copy of the platform's policy.

## Status Values

Drop uses `FileValidationStatus` from `@shipstatic/types` by its real name,
never aliased:

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting validation |
| `processing_error` | Failed during processing (before validation) |
| `excluded` | Excluded with a warning (e.g. empty files; not an error) |
| `validation_failed` | Failed validation (blocks deployment) |
| `ready` | Passed validation, ready to deploy |

**Drop adds no statuses of its own, and must not.** Any addition widens
`FileStatus` past `FileValidationStatusType`, which makes `ProcessedFile`
inexpressible as a `ValidatableFile` and forces a hand projection at the
boundary. An `uploading`/`complete` lifecycle would describe states this
package never enters. `ProcessedFile` carries no `md5` or `progress` for the
same reason: the SDK computes checksums, and drop never uploads.

**Atomic validation:** if ANY file fails, ALL non-excluded files are marked
`validation_failed`. Empty files (0 bytes) are `excluded` with warnings and do
not block deployment. `drop.reset()` clears for a retry.

### The words are Ship's

The SDK words a refusal, and drop shows the sentence verbatim.
`status.details` and `status.errors` carry `validateFiles`' messages as
written, with no `path:` prefix: each sentence already names its file once. One
refusal is the `details` itself (one item is not a list); several are listed in `errors` under their
count ("2 things to fix"), because `errors` is a breakdown, and a refusal
about the set (the count, the total, the home page) names no file. Warnings
are listed the same way.

Drop authors only the two headings an error outcome can carry, in plain
words: `Can't deploy this` when the drop was understood and the platform will
not take it (a refused file, a missing entry point, an empty folder, an empty
input), and `Couldn't prepare the files` when the drop could not be read or
the platform could not be asked what it accepts (`process.ts`, `CANT_DEPLOY` /
`COULDNT_PREPARE`; the hook reads both). Sentence case, as every status title.
`tests/process.test.ts` holds an error list equal to Ship's own, the one-issue
form, and the headings by their literal words.

## Design Decisions

- **No MD5 calculation**: the SDK calculates it during deployment.
- **No MIME database**: `ProcessedFile.type` is the browser's own report.
  Bundling `mime-db` to second-guess it would be most of the bundle for a
  field no consumer reads, while the platform derives Content-Type server
  side from the path.
- **No individual file removal**: atomic validation means removing one file
  re-validates all. Call `reset()` and re-drop.
- **Prefix stripping is unconditional.** A `stripPrefix` option's only
  reachable effect on a built site was to leave `index.html` nested and fail
  the entry-point check. An option whose every setting is either correct or
  broken is not an option.

## Key Gotchas

- **`dataTransfer.items` must be read synchronously** in drop handlers; they
  are gone after the first `await`. The hook collects every entry first, then
  traverses. A manual `processFiles()` caller loses folder structure.
- **`stripCommonPrefix` mutates File objects.** It returns new
  `ProcessedFile`s but rewrites `File.webkitRelativePath` directly, on
  purpose: the SDK reads it from the raw Files. Don't mutate it between drop
  and the SDK.
- **`readEntries` batches at 100.** Chromium returns at most 100 entries per
  call and signals the end with an empty batch, so the reader loops; a single
  call silently truncates every folder over 100 files.
- **A drop read only in part is refused, naming what failed when it can.** An
  unreadable folder entry: "We couldn't read my-app/.gitignore. Make sure it's
  on this computer, then try again." A dropped item that gives neither a
  folder nor a file, which leaves no name: "We couldn't read everything you
  dropped. ..." Both under "Couldn't prepare the files"; `getAsFile()` stays
  the fallback where it recovers the file. The folder picker fails the same
  way, at upload. Skipping would deploy a site
  without the file, or send a project without its `.gitignore` (and so with
  the files it keeps private). Held in `tests/entries.test.ts` and
  `tests/useDrop-events.test.ts`.

## Testing

| Project | Path | Environment |
|---------|------|-------------|
| `main` | `tests/**` | jsdom |
| `browser` | `tests-browser/**` | real Chromium (playwright) |

```
tests/
├── architecture/          # Fences: integrity, naming
├── fixtures/builders.ts   # The ONE fixture source
├── <module>.test.ts       # Mirror axis: tests/<m>.test.ts ↔ src/<m>.ts
├── index.test.ts          # Public-surface fence
└── setup.ts               # Hermeticity (no-network guard)
tests-browser/             # Capability tier: real Chromium
```

**`tests/**` is typechecked.** `pnpm typecheck` runs `tsconfig.check.json`
over `src` and `tests` together. Vitest transpiles through esbuild WITHOUT
checking types, so an unchecked test tree can hold a "compile-time check"
that does not hold, mocks whose shapes disagree with Ship's real return type,
and a published `/testing` return type that erases the helpers it returns.

### Testing canon

The cohesion contract. A change that breaks one needs a recorded exception,
not a workaround:

1. **Files are real.** Real `File`/`Blob` objects with real bytes, and real
   archives built with `fflate`'s `zipSync`. Never patch `File.prototype`
   with string content: binary payloads are this package's subject.
2. **Pure SDK functions are never mocked.** `validateFiles`, `filterJunk`,
   `optimizeDeployPaths`, `pluralize` run for real everywhere. The ONLY
   stand-in is `shipStub()`, because `getLimits()` is an HTTP call.
3. **Builders are the only fixture source** (`tests/fixtures/builders.ts`),
   and they take explicit content: no `Date.now()` in an asserted value.
4. **One entry-tree fake, behavioural and recorded** (below).
5. **No outbound network.** `tests/setup.ts` throws on any `fetch`, naming the
   URL; the SDK's default API base is production.
6. **Console policy is config, not per-file spies.** `silent: 'passed-only'`
   keeps passing tests quiet and prints everything a FAILING test logged.
   Only spies a test asserts on are created locally.

### The one unavoidable fake

A synthetic `DataTransfer` cannot produce real `webkitGetAsEntry()` directory
entries in **any** browser, so `traverseFileTree` has no real-runtime tier and
its collaborator is faked in `tests/fixtures/builders.ts` (`fileEntry` /
`dirEntry` / `entryTree`). The fake models the **spec**:

- `readEntries` yields at most `READ_ENTRIES_BATCH_SIZE` (100) entries per
  call and ends with an EMPTY batch (see "Key Gotchas").
- `createReader()` returns a FRESH cursor, so a directory can be read twice.

Everything else (`File` bytes, `webkitRelativePath`, ZIP inflation, the whole
pipeline) needs no fake and is certified for real in `tests-browser/`.

### The three fences

| Fence | Catches |
|---|---|
| `architecture/test-integrity.test.ts` | A test file that reaches NO production code (a tautology, which no coverage ratchet can see). Reach resolves through local helpers; its only exceptions are the two fences, which read the tree as data |
| `architecture/test-naming.test.ts` | Layout drift: a filename describing the test instead of its subject (`-branches`), a mirror file with no `src/` counterpart, an unrecorded or stale aspect split, a `src/` module with no mirror test |
| `coverage.thresholds` | Coverage decay. A ratchet that only goes up: 99 / 93 / 99 / 99 (statements, branches, functions, lines) |

**Recorded aspect splits**: one subject, more than one mirror file, legal as
`<module>-<aspect>.test.ts`; the naming fence fails if a split is not named in
it by full basename:

| Module | Files | Why |
|---|---|---|
| `src/process.ts` | `process`, `process-contract` | The drop→SDK handoff, isolated from the pipeline that performs it: the file that must fail when the SDK moves |
| `src/useDrop.ts` | `useDrop`, `useDrop-events` | The hook's DOM surface (drag and drop, hidden input, prop getters), separate from its state machine and actions |

### Consumer test utilities

The `/testing` subpath exists for one reason: a `DropReturn` has twenty
fields, and a component test that takes `drop` as a prop should not have to
build them. Its exports and how to use them are in the README, "Testing your
components". Four rules hold its surface:

1. **Never ship a spy API.** A hand-rolled `toHaveBeenCalledWith` compares by
   identity where every real framework compares deeply. `createMockDrop` takes
   `Partial<DropReturn>`, so the consumer's own `vi.fn()` passes straight
   through, and there is no separate options vocabulary (every option IS a
   field).
2. **Never ship status factories.** They duplicate production copy and drift
   from it. `DropStatus` is `{title, details}`: construct it inline, or get it
   from a real pipeline run.
3. **A consumer that receives `drop` as a prop needs no module mock**, and
   that is the pattern to steer consumers toward; `mockUseDrop` exists for
   components that call the hook themselves. **Refused: a `<DropProvider>` and
   context hook.** It is the canonical React answer, but it doubles the
   consumption API to save three lines, and one headless hook is the whole
   identity.
4. **Never wrap a one-line constructor.** `createMockFileWithPath` exists only
   because `webkitRelativePath` is read-only and needs `defineProperty`.

---

*Drop is a companion to the Ship SDK. For SDK patterns (auth, HTTP, CLI), see
the `@shipstatic/ship` package.*
