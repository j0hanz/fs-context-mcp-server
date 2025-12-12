import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { normalizePath } from '../../lib/path-utils.js';
import {
  getAllowedDirectories,
  setAllowedDirectories,
  validateExistingPath,
} from '../../lib/path-validation.js';

describe('Path Validation', () => {
  let testDir: string;
  let subDir: string;
  let testFile: string;

  beforeAll(async () => {
    // Create a temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    subDir = path.join(testDir, 'subdir');
    await fs.mkdir(subDir);
    testFile = path.join(subDir, 'test.txt');
    await fs.writeFile(testFile, 'test content');

    // Set allowed directories to our test directory
    setAllowedDirectories([normalizePath(testDir)]);
  });

  afterAll(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('setAllowedDirectories / getAllowedDirectories', () => {
    it('should set and get allowed directories', () => {
      const dirs = ['/test/dir1', '/test/dir2'];
      setAllowedDirectories(dirs.map(normalizePath));
      const result = getAllowedDirectories();
      expect(result.length).toBe(2);

      // Reset to test directory
      setAllowedDirectories([normalizePath(testDir)]);
    });

    it('should return empty array when no directories set', () => {
      setAllowedDirectories([]);
      expect(getAllowedDirectories()).toEqual([]);

      // Reset to test directory
      setAllowedDirectories([normalizePath(testDir)]);
    });
  });

  describe('validateExistingPath', () => {
    it('should allow paths within allowed directories', async () => {
      const result = await validateExistingPath(testFile);
      expect(result).toContain('test.txt');
    });

    it('should allow the allowed directory itself', async () => {
      const result = await validateExistingPath(testDir);
      expect(result).toBeTruthy();
    });

    it('should allow subdirectories within allowed directories', async () => {
      const result = await validateExistingPath(subDir);
      expect(result).toContain('subdir');
    });

    it('should reject paths outside allowed directories', async () => {
      await expect(validateExistingPath('/etc/passwd')).rejects.toThrow();
    });

    it('should reject paths with .. traversal attempts', async () => {
      const traversalPath = path.join(testDir, '..', 'etc', 'passwd');
      await expect(validateExistingPath(traversalPath)).rejects.toThrow();
    });

    it('should reject non-existent paths', async () => {
      const nonExistent = path.join(testDir, 'non-existent-file.txt');
      await expect(validateExistingPath(nonExistent)).rejects.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle paths with spaces', async () => {
      const dirWithSpaces = path.join(testDir, 'dir with spaces');
      await fs.mkdir(dirWithSpaces);
      const fileInDir = path.join(dirWithSpaces, 'file.txt');
      await fs.writeFile(fileInDir, 'content');

      const result = await validateExistingPath(fileInDir);
      expect(result).toContain('file.txt');

      await fs.rm(dirWithSpaces, { recursive: true });
    });

    it('should handle paths with special characters', async () => {
      const specialDir = path.join(testDir, 'special-chars_123');
      await fs.mkdir(specialDir);
      const fileInDir = path.join(specialDir, 'test_file-1.txt');
      await fs.writeFile(fileInDir, 'content');

      const result = await validateExistingPath(fileInDir);
      expect(result).toContain('test_file-1.txt');

      await fs.rm(specialDir, { recursive: true });
    });

    it('should reject empty path', async () => {
      await expect(validateExistingPath('')).rejects.toThrow(
        /empty|whitespace/i
      );
    });

    it('should reject whitespace-only path', async () => {
      await expect(validateExistingPath('   ')).rejects.toThrow(
        /empty|whitespace/i
      );
    });

    it('should reject path with null bytes', async () => {
      // Paths with null bytes are invalid on most filesystems
      const pathWithNull = path.join(testDir, 'file\0name.txt');
      await expect(validateExistingPath(pathWithNull)).rejects.toThrow();
    });
  });
});
