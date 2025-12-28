export type ReadMode = 'lineRange' | 'tail' | 'head' | 'full';

export interface ReadFileOptions {
  encoding?: BufferEncoding;
  maxSize?: number;
  lineRange?: { start: number; end: number };
  head?: number;
  tail?: number;
  skipBinary?: boolean;
  signal?: AbortSignal;
}

export interface NormalizedOptions {
  encoding: BufferEncoding;
  maxSize: number;
  lineRange?: { start: number; end: number };
  head?: number;
  tail?: number;
  skipBinary: boolean;
  signal?: AbortSignal;
}

export interface ReadFileResult {
  path: string;
  content: string;
  truncated: boolean;
  totalLines?: number;
  readMode: ReadMode;
  lineStart?: number;
  lineEnd?: number;
  head?: number;
  tail?: number;
  linesRead?: number;
  hasMoreLines?: boolean;
}

export type ReadResultMetadata = Omit<
  ReadFileResult,
  'path' | 'content' | 'truncated' | 'totalLines'
>;
