import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getFileType,
  headFile,
  isHidden,
  isProbablyBinary,
  readFile,
  tailFile,
} from '../../lib/fs-helpers.js';
import { normalizePath } from '../../lib/path-utils.js';
import { setAllowedDirectories } from '../../lib/path-validation.js';

describe('FS Helpers', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-fshelpers-test-'));

    // Create test files
    await fs.writeFile(
      path.join(testDir, 'README.md'),
      '# Test Project\nThis is a test.\n'
    );

    // Create a multi-line file for head/tail tests
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join(
      '\n'
    );
    await fs.writeFile(path.join(testDir, 'multiline.txt'), lines);

    // Create a simple binary file
    const binaryData = Buffer.from([0, 1, 2, 3, 4]);
    await fs.writeFile(path.join(testDir, 'binary.bin'), binaryData);

    setAllowedDirectories([normalizePath(testDir)]);
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('readFile', () => {
    it('should read file contents', async () => {
      const result = await readFile(path.join(testDir, 'README.md'));
      expect(result.content).toContain('# Test Project');
    });

    it('should read specific line ranges', async () => {
      const result = await readFile(path.join(testDir, 'multiline.txt'), {
        lineRange: { start: 1, end: 5 },
      });
      expect(result.content).toContain('Line 1');
      expect(result.content).toContain('Line 5');
      expect(result.truncated).toBe(true);
    });

    it('should reject non-files', async () => {
      await expect(readFile(testDir)).rejects.toThrow('Not a file');
    });
  });

  describe('headFile', () => {
    it('should return first N lines', async () => {
      const content = await headFile(path.join(testDir, 'multiline.txt'), 5);
      const lines = content.split('\n');
      expect(lines[0]).toBe('Line 1');
      expect(lines.length).toBeLessThanOrEqual(5);
    });
  });

  describe('tailFile', () => {
    it('should return last N lines', async () => {
      const content = await tailFile(path.join(testDir, 'multiline.txt'), 5);
      const lines = content.split('\n').filter((l) => l);
      expect(lines[lines.length - 1]).toBe('Line 100');
    });
  });

  describe('getFileType', () => {
    it('should identify files', async () => {
      const stats = await fs.stat(path.join(testDir, 'README.md'));
      expect(getFileType(stats)).toBe('file');
    });

    it('should identify directories', async () => {
      const stats = await fs.stat(testDir);
      expect(getFileType(stats)).toBe('directory');
    });
  });

  describe('isHidden', () => {
    it('should identify hidden files', () => {
      expect(isHidden('.git')).toBe(true);
      expect(isHidden('file.txt')).toBe(false);
    });
  });

  describe('isProbablyBinary', () => {
    it('should identify binary files', async () => {
      const isBinary = await isProbablyBinary(path.join(testDir, 'binary.bin'));
      expect(isBinary).toBe(true);
    });

    it('should identify text files', async () => {
      const isBinary = await isProbablyBinary(path.join(testDir, 'README.md'));
      expect(isBinary).toBe(false);
    });

    it('should identify empty files as text', async () => {
      const emptyFile = path.join(testDir, 'empty.txt');
      await fs.writeFile(emptyFile, '');
      const isBinary = await isProbablyBinary(emptyFile);
      expect(isBinary).toBe(false);
      await fs.rm(emptyFile);
    });

    it('should identify UTF-8 BOM files as text', async () => {
      const bomFile = path.join(testDir, 'bom.txt');
      // UTF-8 BOM: EF BB BF followed by text
      const content = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('Hello World'),
      ]);
      await fs.writeFile(bomFile, content);
      const isBinary = await isProbablyBinary(bomFile);
      expect(isBinary).toBe(false);
      await fs.rm(bomFile);
    });
  });

  describe('readFile edge cases', () => {
    it('should reject reading with both head and tail', async () => {
      await expect(
        readFile(path.join(testDir, 'multiline.txt'), {
          head: 5,
          tail: 5,
        })
      ).rejects.toThrow(/Cannot specify multiple/);
    });

    it('should reject reading with both lineRange and head', async () => {
      await expect(
        readFile(path.join(testDir, 'multiline.txt'), {
          lineRange: { start: 1, end: 5 },
          head: 5,
        })
      ).rejects.toThrow(/Cannot specify multiple/);
    });

    it('should reject invalid lineRange start', async () => {
      await expect(
        readFile(path.join(testDir, 'multiline.txt'), {
          lineRange: { start: 0, end: 5 },
        })
      ).rejects.toThrow(/start must be at least 1/);
    });

    it('should reject lineRange where end < start', async () => {
      await expect(
        readFile(path.join(testDir, 'multiline.txt'), {
          lineRange: { start: 10, end: 5 },
        })
      ).rejects.toThrow(/end.*must be >= start/);
    });

    it('should handle reading beyond file length gracefully', async () => {
      const result = await readFile(path.join(testDir, 'multiline.txt'), {
        lineRange: { start: 95, end: 200 },
      });
      // Should return lines 95-100 (the file has 100 lines)
      expect(result.content).toContain('Line 100');
      expect(result.truncated).toBe(true);
    });

    it('should handle empty file', async () => {
      const emptyFile = path.join(testDir, 'empty-read.txt');
      await fs.writeFile(emptyFile, '');

      const result = await readFile(emptyFile);
      expect(result.content).toBe('');
      expect(result.truncated).toBe(false);

      await fs.rm(emptyFile);
    });
  });

  describe('headFile edge cases', () => {
    it('should handle requesting more lines than file has', async () => {
      const content = await headFile(path.join(testDir, 'multiline.txt'), 200);
      const lines = content.split('\n');
      expect(lines.length).toBe(100);
    });

    it('should handle empty file', async () => {
      const emptyFile = path.join(testDir, 'empty-head.txt');
      await fs.writeFile(emptyFile, '');

      const content = await headFile(emptyFile, 5);
      expect(content).toBe('');

      await fs.rm(emptyFile);
    });
  });

  describe('tailFile edge cases', () => {
    it('should handle requesting more lines than file has', async () => {
      const content = await tailFile(path.join(testDir, 'multiline.txt'), 200);
      const lines = content.split('\n').filter((l) => l);
      expect(lines.length).toBe(100);
    });

    it('should handle empty file', async () => {
      const emptyFile = path.join(testDir, 'empty-tail.txt');
      await fs.writeFile(emptyFile, '');

      const content = await tailFile(emptyFile, 5);
      expect(content).toBe('');

      await fs.rm(emptyFile);
    });

    it('should handle single line file', async () => {
      const singleLineFile = path.join(testDir, 'single-line.txt');
      await fs.writeFile(singleLineFile, 'Only one line');

      const content = await tailFile(singleLineFile, 5);
      expect(content).toBe('Only one line');

      await fs.rm(singleLineFile);
    });
  });
});
