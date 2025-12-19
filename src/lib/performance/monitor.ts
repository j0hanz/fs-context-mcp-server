import { performance, PerformanceObserver } from 'node:perf_hooks';

interface OperationMetrics {
  operation: string;
  duration: number;
  timestamp: number;
}

class PerformanceMonitor {
  private observer?: PerformanceObserver;
  private metrics: OperationMetrics[] = [];
  private readonly enabled: boolean;

  constructor(enabled = false) {
    this.enabled = enabled;
    if (this.enabled) {
      this.initObserver();
    }
  }

  private initObserver(): void {
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.metrics.push({
          operation: entry.name,
          duration: entry.duration,
          timestamp: entry.startTime,
        });

        // Log slow operations (>1s) to console
        if (entry.duration > 1000) {
          console.warn(
            `[PERF] Slow operation: ${entry.name} took ${entry.duration.toFixed(2)}ms`
          );
        }
      }
    });
    this.observer.observe({ entryTypes: ['measure'] });
  }

  startOperation(name: string): void {
    if (!this.enabled) return;
    performance.mark(`${name}-start`);
  }

  endOperation(name: string): void {
    if (!this.enabled) return;
    const endMark = `${name}-end`;
    performance.mark(endMark);
    performance.measure(name, `${name}-start`, endMark);
  }

  getMetrics(): OperationMetrics[] {
    return [...this.metrics];
  }

  getSummary(): Record<
    string,
    { count: number; avgDuration: number; totalDuration: number }
  > {
    const summary: Record<
      string,
      { count: number; avgDuration: number; totalDuration: number }
    > = {};

    for (const metric of this.metrics) {
      summary[metric.operation] ??= {
        count: 0,
        avgDuration: 0,
        totalDuration: 0,
      };
      const entry = summary[metric.operation];
      if (entry) {
        entry.count++;
        entry.totalDuration += metric.duration;
      }
    }

    for (const op of Object.keys(summary)) {
      const stats = summary[op];
      if (stats) {
        stats.avgDuration = stats.totalDuration / stats.count;
      }
    }

    return summary;
  }

  clear(): void {
    this.metrics = [];
    performance.clearMarks();
    performance.clearMeasures();
  }

  dispose(): void {
    this.observer?.disconnect();
  }
}

// Enable via environment variable
const isEnabled = process.env.ENABLE_PERF_MONITORING === 'true';
export const perfMonitor = new PerformanceMonitor(isEnabled);

// Cleanup on process exit
process.on('beforeExit', () => {
  if (isEnabled) {
    console.error('[PERF] Summary:', perfMonitor.getSummary());
  }
  perfMonitor.dispose();
});
