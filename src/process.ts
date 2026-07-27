/**
 * The drop pipeline — everything between "here are some Files" and "here is a
 * verdict", with no React in sight.
 *
 * It takes `PlatformLimits` rather than a `Ship` client, which is what makes it
 * a plain function: source-name detection, ZIP extraction, unbuilt-project
 * detection, junk filtering, path normalization, entry-point and limit
 * validation, all reachable by direct call. `useDrop` is a state machine over
 * this; a non-React consumer can call it directly.
 */
import { filterJunk, pluralize, validateFiles } from '@shipstatic/ship';
import {
  FileValidationStatus,
  hasUnbuiltMarker,
  isShipError,
  type PlatformLimits,
  type ValidatableFile,
} from '@shipstatic/types';
import { applyStatus, createProcessedFile, filePath, stripCommonPrefix } from './files';
import type { DropStatus, ProcessedFile } from './types';
import { extractZipToFiles, isZipFile } from './zip';

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
  needsBuild?: boolean;
}): DropOutcome {
  const { title, details, errors, files = [], sourceName, needsBuild = false } = params;
  return {
    phase: 'error',
    files,
    sourceName,
    needsBuild,
    // `details` carries the single user-facing message; `errors` is for per-item
    // breakdowns. Omitted when empty, otherwise consumers that render both
    // fields show the message twice.
    status: { title, details, ...(errors?.length ? { errors } : {}) },
  };
}

/**
 * Run the pipeline.
 *
 * Never throws: an unbuilt project rejected by `filterJunk`, a missing entry
 * point, a file over the limit, and an unexpected host-object failure all come
 * back as an `error` outcome. Callers need no try/catch.
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
    // files are legitimate input rather than a mistake.
    const needsBuild = files.some((f) => hasUnbuiltMarker(filePath(f)));

    // Strip node_modules for build uploads. Drag-drop skips it during traversal;
    // the folder picker (webkitdirectory) hands it over anyway.
    if (needsBuild) {
      files = files.filter(
        (f) => !filePath(f).replace(/\\/g, '/').split('/').includes('node_modules'),
      );
    }

    // Step 3: junk filtering (throws ShipError on an unbuilt project unless allowed)
    const kept = new Set(filterJunk(files.map(filePath), { allowUnbuilt: needsBuild }));

    // Step 4: convert to ProcessedFile, then strip the common directory prefix.
    // Empty files are kept — validation marks them EXCLUDED with a warning
    // rather than failing the deploy.
    const finalFiles = stripCommonPrefix(
      files.filter((f) => kept.has(filePath(f))).map((f) => createProcessedFile(f)),
    );

    // Step 5: entry point. A built site must serve index.html from the root; an
    // unbuilt project may keep it anywhere, since the build decides the output.
    if (finalFiles.length > 0) {
      const hasIndex = needsBuild
        ? finalFiles.some((f) => f.path === 'index.html' || f.path.endsWith('/index.html'))
        : finalFiles.some((f) => f.path === 'index.html');

      if (!hasIndex) {
        const details = needsBuild
          ? 'No index.html found — every web project needs an index.html entry point'
          : 'No index.html at root — the entry point must be in the top-level directory';
        return failure({
          title: 'Validation Failed',
          details,
          sourceName,
          needsBuild,
          files: applyStatus(finalFiles, FileValidationStatus.VALIDATION_FAILED, details),
        });
      }
    }

    // Step 6: build uploads skip deploy validation — the build service validates
    // its own output, and source files are not deploy output.
    if (needsBuild) {
      const ready = applyStatus(finalFiles, FileValidationStatus.READY);
      return {
        phase: 'ready',
        files: ready,
        sourceName,
        needsBuild: true,
        status: {
          title: 'Ready',
          details: `${pluralize(ready.length, 'file', 'files', true)} ready — project will be built`,
        },
      };
    }

    // Step 7: validate against platform limits
    const validation = validateFiles(finalFiles.map(toValidatable), limits);

    const validated = finalFiles.map((file, i) => ({
      ...file,
      status: validation.files[i]?.status ?? file.status,
      statusMessage: validation.files[i]?.statusMessage ?? file.statusMessage,
    }));

    // Atomic validation: any error fails the whole set
    if (!validation.canDeploy) {
      return failure({
        title: 'Validation Failed',
        details: `${pluralize(validation.errors.length, 'file', 'files', true)} failed validation`,
        errors: validation.errors.map((e) => `${e.file}: ${e.message}`),
        files: validated,
        sourceName,
      });
    }

    const readyCount = validated.filter((f) => f.status === FileValidationStatus.READY).length;
    const warnings = validation.warnings.map((w) => `${w.file}: ${w.message}`);

    if (readyCount > 0) {
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
    }

    // Nothing deployable. Warnings alone (e.g. every file empty) is not an error
    // state — no ready files already disables the deploy action.
    if (validation.errors.length === 0 && validation.warnings.length > 0) {
      return {
        phase: 'ready',
        files: validated,
        sourceName,
        needsBuild: false,
        status: {
          title: 'All files excluded',
          details: `${pluralize(validation.warnings.length, 'file', 'files', true)} excluded (empty files cannot be deployed)`,
          warnings,
        },
      };
    }

    return failure({
      title: 'No Valid Files',
      details: 'None of the provided files could be processed.',
      files: validated,
      sourceName,
    });
  } catch (error) {
    // A ShipError here is a validation rejection thrown by filterJunk (unbuilt
    // project); anything else is an unexpected processing failure.
    const message = error instanceof Error ? error.message : String(error);
    const isValidation = isShipError(error);
    return failure({
      title: isValidation ? 'Validation Failed' : 'Processing Failed',
      details: isValidation ? message : `Failed to process files: ${message}`,
      sourceName,
    });
  }
}
