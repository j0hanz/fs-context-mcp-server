export function needsStatsForSort(sortBy: string): boolean {
  return sortBy === 'size' || sortBy === 'modified';
}

export function withOptionalStoppedReason<T extends object, R extends string>(
  summary: T,
  stoppedReason: R | undefined
): T | (T & { stoppedReason: R }) {
  if (stoppedReason === undefined) {
    return summary;
  }
  return { ...summary, stoppedReason };
}
