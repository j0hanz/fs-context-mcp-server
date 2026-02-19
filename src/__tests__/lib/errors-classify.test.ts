import assert from 'node:assert/strict';
import { constants as osConstants } from 'node:os';
import { it } from 'node:test';

import { createDetailedError, ErrorCode, McpError } from '../../lib/errors.js';

void it('createDetailedError classifies ENOENT messages as not found', () => {
  const detailed = createDetailedError(
    new Error('ENOENT: no such file or directory')
  );
  assert.strictEqual(detailed.code, ErrorCode.E_NOT_FOUND);
});

void it('createDetailedError classifies unknown message-only errors as unknown', () => {
  const detailed = createDetailedError(new Error('Some random error'));
  assert.strictEqual(detailed.code, ErrorCode.E_UNKNOWN);
});

void it('createDetailedError classifies string ENOENT errors as not found', () => {
  const detailed = createDetailedError('ENOENT error');
  assert.strictEqual(detailed.code, ErrorCode.E_NOT_FOUND);
});

void it('createDetailedError classifies non-Error objects as unknown', () => {
  const detailed = createDetailedError({ message: 'permission denied' });
  assert.strictEqual(detailed.code, ErrorCode.E_UNKNOWN);
});

void it('createDetailedError classifies permission denied messages', () => {
  const detailed = createDetailedError(new Error('Permission denied'));
  assert.strictEqual(detailed.code, ErrorCode.E_PERMISSION_DENIED);
});

void it('createDetailedError classifies not-a-directory messages', () => {
  const detailed = createDetailedError(new Error('Not a directory'));
  assert.strictEqual(detailed.code, ErrorCode.E_NOT_DIRECTORY);
});

void it('createDetailedError classifies is-a-directory messages', () => {
  const detailed = createDetailedError(new Error('Is a directory'));
  assert.strictEqual(detailed.code, ErrorCode.E_NOT_FILE);
});

void it('createDetailedError classifies EACCES as permission denied', () => {
  const detailed = createDetailedError(
    Object.assign(new Error('permission denied'), { code: 'EACCES' })
  );
  assert.strictEqual(detailed.code, ErrorCode.E_PERMISSION_DENIED);
});

void it('createDetailedError classifies EPERM as permission denied', () => {
  const detailed = createDetailedError(
    Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
  );
  assert.strictEqual(detailed.code, ErrorCode.E_PERMISSION_DENIED);
});

void it('createDetailedError classifies EISDIR as not file', () => {
  const detailed = createDetailedError(
    Object.assign(new Error('is a directory'), { code: 'EISDIR' })
  );
  assert.strictEqual(detailed.code, ErrorCode.E_NOT_FILE);
});

void it('createDetailedError classifies ENOTDIR as not directory', () => {
  const detailed = createDetailedError(
    Object.assign(new Error('not a directory'), { code: 'ENOTDIR' })
  );
  assert.strictEqual(detailed.code, ErrorCode.E_NOT_DIRECTORY);
});

void it('createDetailedError classifies ELOOP as symlink not allowed', () => {
  const detailed = createDetailedError(
    Object.assign(new Error('too many symbolic links'), { code: 'ELOOP' })
  );
  assert.strictEqual(detailed.code, ErrorCode.E_SYMLINK_NOT_ALLOWED);
});

void it('createDetailedError classifies ETIMEDOUT as timeout', () => {
  const detailed = createDetailedError(
    Object.assign(new Error('operation timed out'), { code: 'ETIMEDOUT' })
  );
  assert.strictEqual(detailed.code, ErrorCode.E_TIMEOUT);
});

void it('createDetailedError uses McpError direct code', () => {
  const detailed = createDetailedError(
    new McpError(ErrorCode.E_TOO_LARGE, 'File too large', '/path/to/file')
  );
  assert.strictEqual(detailed.code, ErrorCode.E_TOO_LARGE);
});

void it('createDetailedError classifies timeout errors in cause chains', () => {
  const timeoutCause = new Error('operation timed out');
  timeoutCause.name = 'TimeoutError';
  const wrapped = new Error('outer wrapper', { cause: timeoutCause });

  const detailed = createDetailedError(wrapped);

  assert.strictEqual(detailed.code, ErrorCode.E_TIMEOUT);
});

void it('createDetailedError classifies ABORT_ERR in cause chains as cancelled', () => {
  const abortCause = Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
  const wrapped = new Error('outer wrapper', { cause: abortCause });

  const detailed = createDetailedError(wrapped);

  assert.strictEqual(detailed.code, ErrorCode.E_CANCELLED);
});

void it('createDetailedError maps errno-only errors via system errno name', () => {
  const enoent = osConstants.errno.ENOENT;
  if (typeof enoent !== 'number') return;

  const errnoOnly = Object.assign(new Error('missing'), { errno: enoent });
  const detailed = createDetailedError(errnoOnly);

  assert.strictEqual(detailed.code, ErrorCode.E_NOT_FOUND);
});
