/**
 * The `File` ↔ `ProcessedFile` boundary, and the path rules that govern it.
 */
import { optimizeDeployPaths } from '@shipstatic/ship';
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
 * Strip the common directory prefix from a set of deploy paths.
 *
 * The path algorithm is Ship's `optimizeDeployPaths` — the single source of
 * truth for deploy-path normalization. The stripped path is written back onto
 * each underlying File, because Ship reads `webkitRelativePath` from the raw
 * File objects it is handed.
 */
export function stripCommonPrefix(files: ProcessedFile[]): ProcessedFile[] {
  if (files.length === 0) return files;

  const deployFiles = optimizeDeployPaths(files.map((f) => f.path));

  return files.map((f, i) => {
    const newPath = deployFiles[i].path;
    setRelativePath(f.file, newPath);
    return { ...f, path: newPath, name: newPath.split('/').pop() || f.name };
  });
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
