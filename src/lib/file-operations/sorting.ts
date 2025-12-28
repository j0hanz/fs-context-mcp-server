import * as path from 'node:path';

import type { FileType } from '../../config/types.js';

type SortField = 'name' | 'size' | 'modified' | 'type' | 'path';

interface Sortable {
  name?: string;
  size?: number;
  modified?: Date;
  type?: FileType;
  path?: string;
}

function compareString(a?: string, b?: string): number {
  return (a ?? '').localeCompare(b ?? '');
}

function compareNameThenPath(a: Sortable, b: Sortable): number {
  const nameCompare = compareString(a.name, b.name);
  if (nameCompare !== 0) return nameCompare;
  return compareString(a.path, b.path);
}

function comparePathThenName(a: Sortable, b: Sortable): number {
  const pathCompare = compareString(a.path, b.path);
  if (pathCompare !== 0) return pathCompare;
  return compareString(a.name, b.name);
}

function compareOptionalNumberDesc(
  left: number | undefined,
  right: number | undefined,
  tieBreak: () => number
): number {
  const diff = (right ?? 0) - (left ?? 0);
  if (diff !== 0) return diff;
  return tieBreak();
}

function compareTypeThenName(a: Sortable, b: Sortable): number {
  if (a.type === b.type) return compareNameThenPath(a, b);
  return a.type === 'directory' ? -1 : 1;
}

const SORT_COMPARATORS: Readonly<
  Record<SortField, (a: Sortable, b: Sortable) => number>
> = {
  size: (a, b) =>
    compareOptionalNumberDesc(a.size, b.size, () => compareNameThenPath(a, b)),
  modified: (a, b) =>
    compareOptionalNumberDesc(
      a.modified?.getTime(),
      b.modified?.getTime(),
      () => compareNameThenPath(a, b)
    ),
  type: (a, b) => compareTypeThenName(a, b),
  path: (a, b) => comparePathThenName(a, b),
  name: (a, b) => compareNameThenPath(a, b),
};

export function sortByField(items: Sortable[], sortBy: SortField): void {
  const comparator = SORT_COMPARATORS[sortBy];
  items.sort(comparator);
}

export function sortSearchResults(
  results: Sortable[],
  sortBy: 'name' | 'size' | 'modified' | 'path'
): void {
  if (sortBy === 'name') {
    const decorated = results.map((item, index) => ({
      item,
      baseName: path.basename(item.path ?? ''),
      index,
    }));
    decorated.sort((a, b) => {
      const baseCompare = compareString(a.baseName, b.baseName);
      if (baseCompare !== 0) return baseCompare;
      const pathCompare = compareString(a.item.path, b.item.path);
      if (pathCompare !== 0) return pathCompare;
      return a.index - b.index;
    });
    results.splice(0, results.length, ...decorated.map((entry) => entry.item));
    return;
  }

  const comparator = SORT_COMPARATORS[sortBy];
  results.sort(comparator);
}
