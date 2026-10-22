/**
 * The drop pipeline — everything between "here are some Files" and "here is a
 * verdict", with no React in sight.
 *
 * It takes `PlatformLimits` rather than a `Ship` client, which is what makes it
 * a plain function: source-name detection, ZIP extraction, unbuilt-project
 * detection and the project's source, junk filtering, path normalization,
 * entry-point and limit validation, all reachable by direct call. `useDrop` is a state machine over
 * this; a non-React consumer can call it directly.
 */
import { filterJunk, pluralize, validateFiles } from '@shipstatic/ship';
import {
  FileValidationStatus,
  hasUnbuiltMarker,
  type PlatformLimits,
  type ValidatableFile,
} from '@shipstatic/types';
import { applyStatus, createProcessedFile, filePath, stripCommonPrefix } from './files';
import { projectSource } from './source';
import type { DropStatus, ProcessedFile } from './types';
import { extractZipToFiles, isZipFile } from './zip';

/**
 * The two headings an error outcome can carry, in plain words. `details` and
 * `errors` beneath them are Ship's sentences, shown verbatim.
 */
/** The drop was understood and the platform will not take it, an empty folder included. */
export const CANT_DEPLOY = "Can't deploy this";
/** The drop could not be read or the platform could not be asked what it accepts. */
export const COULDNT_PREPARE = "Couldn't prepare the files";

export interface ProcessFilesOptions {
  /** Platform limits, from `ship.getLimits()` */
  limits: PlatformLimits;
  /** Progress reporter for long steps */
  onStatus?: (status: DropStatus) => void;
}

/**
 * The verdict. Mirrors the hook's state minus `isDragging`, which is a pointer
 * concern the pipeline knows nothing about.
 *
 * Ready files are `files.filter(f => f.status === FileValidationStatus.READY)` — kept as
 * one derivation rather than a second field that could disagree with the first.
 */
export interface DropOutcome {
  phase: 'ready' | 'error';
  files: ProcessedFile[];
  sourceName: string;
  status: DropStatus;
  needsBuild: boolean;
}

/**
 * The exact shape drop hands to Ship's validator.
 *
 * **The deploy path is the name.** Server-side validation runs on full paths, so
 * sending the basename would validate a different string than the platform will.
 * `ProcessedFile` is not passed through directly even though it satisfies
 * `ValidatableFile`, because its `name` is the display basename.
 */
export function toValidatable(file: ProcessedFile): ValidatableFile {
  return { name: file.path, size: file.size };
}

/** A friendly name for whatever the user dropped. */
export function detectSourceName(files: File[]): string {
  if (files.length === 0) return '';

  const [first] = files;
  if (files.length === 1 && isZipFile(first)) return first.name.replace(/\.zip$/i, '');

  // A folder drop/selection carries its root in webkitRelativePath
  const path = first.webkitRelativePath || '';
  return path.includes('/') ? path.split('/')[0] : first.name;
}

function failure(params: {
  title: string;
  details: string;
  errors?: string[];
  files?: ProcessedFile[];
  sourceName: string;
}): DropOutcome {
  const { title, details, errors, files = [], sourceName } = params;
  // An error outcome is never a project to build: a project to be built is
  // ready as it stands, and its build gives the verdict.
  return {
    phase: 'error',
    files,
    sourceName,
    needsBuild: false,
    // `details` carries the single user-facing message; `errors` is for per-item
    // breakdowns. Omitted when empty, otherwise consumers that render both
    // fields show the message twice.
    status: { title, details, ...(errors?.length ? { errors } : {}) },
  };
}

/**
 * Run the pipeline.
 *
 * Never throws: a missing entry point, a file over the limit, and an
 * unexpected host-object failure all come back as an `error` outcome. Callers
 * need no try/catch.
 */
export async function processFiles(
  input: File[],
  { limits, onStatus }: ProcessFilesOptions,
): Promise<DropOutcome> {
  // Assigned inside the try: reading `webkitRelativePath` touches host objects,
  // and the no-throw guarantee has to cover the very first one.
  let sourceName = '';

  try {
    sourceName = detectSourceName(input);

    // Step 1: a lone ZIP is extracted; ZIPs among several files stay as files
    let files: File[];
    if (input.length === 1 && isZipFile(input[0])) {
      onStatus?.({ title: 'Extracting...', details: `Extracting ${input[0].name}...` });
      const { files: extracted, errors } = await extractZipToFiles(input[0]);
      if (errors.length > 0) console.warn('ZIP extraction errors:', errors);
      files = extracted;
    } else {
      files = input;
    }

    // Step 2: unbuilt-project detection. When the server will build, source
    // files are legitimate input rather than a mistake, and the project is
    // sent as its repository holds it: `projectSource` decides which files
    // that is, once.
    const needsBuild = files.some((f) => hasUnbuiltMarker(filePath(f)));
    if (needsBuild) files = await projectSource(files);

    // Step 3: junk filtering, for a built site only. A project's source is
    // never filtered again: a build reads its dot files.
    if (!needsBuild) {
      const kept = new Set(filterJunk(files.map(filePath)));
      files = files.filter((f) => kept.has(filePath(f)));
    }

    // Step 4: convert to ProcessedFile, then strip the common directory prefix.
    // Empty files are kept: a built site's are marked EXCLUDED with a warning
    // by validation, and a project's are source the build may import.
    const finalFiles = stripCommonPrefix(files.map((f) => createProcessedFile(f)));

    // Step 5: a project to be built is ready as it stands. The build decides
    // what the site is, so neither the entry point nor the deploy limits apply
    // to its source: many frameworks (Astro, Next.js, SvelteKit, Eleventy) have
    // no index.html until they are built, and the build service refuses a build
    // that produced no site, in its own words.
    if (needsBuild) {
      const ready = applyStatus(finalFiles, FileValidationStatus.READY);
      return {
        phase: 'ready',
        files: ready,
        sourceName,
        needsBuild: true,
        status: {
          title: 'Ready',
          details: `${pluralize(ready.length, 'file', 'files', true)} ready. We'll build the project.`,
        },
      };
    }

    // Step 6: the platform's deploy rules, through Ship: each file, then the
    // site as a whole, a home page (index.html at its root) among them.
    const validation = validateFiles(finalFiles.map(toValidatable), limits);

    const validated = finalFiles.map((file, i) => ({
      ...file,
      status: validation.files[i]?.status ?? file.status,
      statusMessage: validation.files[i]?.statusMessage ?? file.statusMessage,
    }));

    // Atomic validation: any error fails the whole set. Each issue is Ship's
    // sentence as written: it already names its file, or the site when it is
    // about the site, so nothing is prefixed. One issue is the message itself;
    // several are listed under their count, since `errors` is a breakdown and
    // one item is not one.
    if (!validation.canDeploy) {
      const issues = validation.errors.map((e) => e.message);
      return failure({
        title: CANT_DEPLOY,
        ...(issues.length === 1
          ? { details: issues[0] }
          : { details: `${issues.length} things to fix`, errors: issues }),
        files: validated,
        sourceName,
      });
    }

    // Deployable means the deploy rules found files to publish, a home page
    // among them, so at least one file is ready; empty files are excluded
    // beside them with a warning.
    const readyCount = validated.filter((f) => f.status === FileValidationStatus.READY).length;
    const warnings = validation.warnings.map((w) => w.message);
    let details = `${pluralize(readyCount, 'file', 'files', true)} ready`;
    if (validation.warnings.length > 0) {
      details += ` (${pluralize(validation.warnings.length, 'empty file', 'empty files', true)} excluded)`;
    }
    return {
      phase: 'ready',
      files: validated,
      sourceName,
      needsBuild: false,
      status: { title: 'Ready', details, ...(warnings.length ? { warnings } : {}) },
    };
  } catch (error) {
    // Every refusal above is returned, never thrown, so what lands here is a
    // failure to read the files: a host object, an archive, a .gitignore.
    const message = error instanceof Error ? error.message : String(error);
    return failure({
      title: COULDNT_PREPARE,
      details: message,
      sourceName,
    });
  }
}
