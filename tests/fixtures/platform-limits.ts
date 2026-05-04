/**
 * Shared test platform limits matching production API.
 *
 * Mirrors the values from `cloudflare/api/src/lib/config.ts` to keep tests
 * aligned with real-world behavior. Keep in sync with the `DEPLOYMENT`
 * constants in the API.
 */
import type { PlatformLimits } from '@shipstatic/types';

/**
 * Production-like limits for integration tests.
 * Mirrors `DEPLOYMENT` constants from `cloudflare/api/src/lib/config.ts`.
 */
export const PRODUCTION_LIMITS: PlatformLimits = {
  maxFileSize: 20 * 1024 * 1024,      // 20MB — matches DEPLOYMENT.MAX_FILE_SIZE
  maxFilesCount: 500,                  // 500 files — matches DEPLOYMENT.MAX_FILES_COUNT
  maxTotalSize: 50 * 1024 * 1024,      // 50MB — matches DEPLOYMENT.MAX_TOTAL_SIZE
};

/**
 * Relaxed limits for unit tests where caps aren't the focus.
 * Uses higher values to avoid accidental failures in unrelated tests.
 */
export const RELAXED_TEST_LIMITS: PlatformLimits = {
  maxFileSize: 100 * 1024 * 1024,     // 100MB — generous for testing
  maxFilesCount: 10000,                // 10k files — generous for testing
  maxTotalSize: 500 * 1024 * 1024,     // 500MB — generous for testing
};
