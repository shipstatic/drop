/**
 * Shared test configuration matching production API
 *
 * This file mirrors the values from cloudflare/api/src/lib/config.ts
 * to ensure tests reflect real-world behavior.
 *
 * Keep this in sync with DEPLOYMENT constants in the API.
 */
import type { ConfigResponse } from '@shipstatic/types';

/**
 * Production-like config for integration tests
 * Mirrors DEPLOYMENT constants from cloudflare/api/src/lib/config.ts
 */
export const PRODUCTION_CONFIG: ConfigResponse = {
  maxFileSize: 20 * 1024 * 1024,      // 20MB - matches DEPLOYMENT.MAX_FILE_SIZE
  maxFilesCount: 500,                  // 500 files - matches DEPLOYMENT.MAX_FILES_COUNT
  maxTotalSize: 50 * 1024 * 1024,     // 50MB - matches DEPLOYMENT.MAX_TOTAL_SIZE
};

/**
 * Relaxed config for unit tests where limits aren't the focus
 * Uses higher limits to avoid accidental failures in unrelated tests
 */
export const RELAXED_TEST_CONFIG: ConfigResponse = {
  maxFileSize: 100 * 1024 * 1024,     // 100MB - generous for testing
  maxFilesCount: 10000,                // 10k files - generous for testing
  maxTotalSize: 500 * 1024 * 1024,    // 500MB - generous for testing
};
