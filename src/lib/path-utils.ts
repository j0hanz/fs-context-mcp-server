/**
 * Path normalization utilities for cross-platform consistency.
 */
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Expand home directory shorthand (~/) to actual home path.
 */
function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

/**
 * Normalize a path to a canonical, absolute form.
 *
 * - Expands ~ to home directory
 * - Resolves to absolute path
 * - On Windows, normalizes drive letter to lowercase for consistent comparison
 *
 * @param p - The path to normalize (relative or absolute)
 * @returns The normalized absolute path
 */
export function normalizePath(p: string): string {
  const expanded = expandHome(p);
  const resolved = path.resolve(expanded);

  // On Windows, normalize drive letter to lowercase (C: -> c:)
  if (process.platform === 'win32' && /^[A-Z]:/.test(resolved)) {
    return resolved.charAt(0).toLowerCase() + resolved.slice(1);
  }

  return resolved;
}
