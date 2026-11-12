/**
 * The `File` ↔ `ProcessedFile` boundary, and the path rules that govern it.
 */
import { optimizeDeployPaths, sitePaths } from '@shipstatic/ship';
import { FileValidationStatus, type FileValidationStatusType } from '@shipstatic/types';
import type { ProcessedFile } from './types';

/**
 * Patch a File's `webkitRelativePath` so the Ship SDK reads our resolved deploy
 * path. The browser-set property is read-only, so it must be redefined;
 * `configurable: true` allows re-patching when prefixes are stripped later.
 */
export function setRelativePath(file: File, path: string): void {
  Object.defineProperty(file, 'webkitRelativePath', {
    value: path,
    writable: false,
    configurable: true,
  });
}

/**
 * The deploy path of a raw File: its folder-relative path when the browser gave
 * us one, otherwise its bare name. Every caller goes through here.
 */
export function filePath(file: File): string {
  return file.webkitRelativePath?.trim() || file.name;
}

/**
 * The single conversion point from `File` to `ProcessedFile`.
 *
 * `type` is the browser's own report: the platform derives Content-Type
 * server-side from the path, so there is nothing to gain from second-guessing it
 * here. MD5 is Ship's job, during upload.
 */
export function createProcessedFile(file: File, options?: { path?: string }): ProcessedFile {
  const path = options?.path || filePath(file);

  return {
    id: crypto.randomUUID(),
    file,
    path,
    size: file.size,
    name: path.split('/').pop() || file.name,
    type: file.type,
    lastModified: file.lastModified,
    status: FileValidationStatus.PENDING,
  };
}

/**
 * A file under the path it will be published at. The path is written back
 * onto the File too, because Ship reads `webkitRelativePath` from the raw
 * Files it is handed.
 */
function published(file: ProcessedFile, path: string): ProcessedFile {
  setRelativePath(file.file, path);
  return { ...file, path, name: path.split('/').pop() || file.name };
}

/**
 * A built site's files under the paths they are published at, its junk set
 * aside.
 *
 * Which files are junk, and in what order that is decided against stripping
 * the common folder, is Ship's `sitePaths`: the one statement of it, so a
 * folder is named the same way dropped here as deployed from a terminal.
 */
export function siteFiles(files: ProcessedFile[]): ProcessedFile[] {
  const paths = sitePaths(files.map((f) => f.path));
  return files.flatMap((file, i) => {
    const path = paths[i];
    return path == null ? [] : [published(file, path)];
  });
}

/**
 * A project's source with the common folder stripped and nothing set aside:
 * what a build reads is decided by `projectSource`, once.
 */
export function stripCommonPrefix(files: ProcessedFile[]): ProcessedFile[] {
  const paths = optimizeDeployPaths(files.map((f) => f.path));
  return files.map((file, i) => published(file, paths[i].path));
}

/**
 * Stamp a status across a file set.
 *
 * Validation is atomic — every file carries the same verdict — so this is the
 * one place that shape is built.
 */
export function applyStatus(
  files: ProcessedFile[],
  status: FileValidationStatusType,
  statusMessage?: string,
): ProcessedFile[] {
  return files.map((f) => ({
    ...f,
    status,
    ...(statusMessage === undefined ? {} : { statusMessage }),
  }));
}
