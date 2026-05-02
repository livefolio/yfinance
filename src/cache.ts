import type { Bar, DateRange, Frequency } from '@livefolio/sdk/interfaces';

type Entry = { range: DateRange; bars: Bar[] };

/**
 * Range-aware in-memory bar cache, keyed by `(symbol, freq)`.
 *
 * `get` returns `undefined` if the cached range doesn't cover the requested
 * range; otherwise it returns the bars sliced to `[range.from, range.to]`
 * inclusive on both ends.
 *
 * `set` widens the cached range when the new range is a strict superset of the
 * old; it **throws** on partial overlap (YAGNI per plan — the call pattern
 * always fetches `[earliest, latest]` once per symbol per backtest).
 *
 * No expiry, no eviction. Lifetime tied to the owning `YfinanceDataFeed`.
 */
export class BarCache {
  private store = new Map<string, Entry>();

  private key(symbol: string, freq: Frequency): string {
    return `${symbol}:${freq}`;
  }

  get(symbol: string, range: DateRange, freq: Frequency): Bar[] | undefined {
    const entry = this.store.get(this.key(symbol, freq));
    if (!entry) return undefined;
    if (entry.range.from.getTime() > range.from.getTime()) return undefined;
    if (entry.range.to.getTime() < range.to.getTime()) return undefined;
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    return entry.bars.filter((b) => {
      const t = b.t.getTime();
      return t >= fromMs && t <= toMs;
    });
  }

  set(symbol: string, freq: Frequency, range: DateRange, bars: Bar[]): void {
    const k = this.key(symbol, freq);
    const prior = this.store.get(k);
    if (!prior) {
      this.store.set(k, { range: { from: range.from, to: range.to }, bars: [...bars] });
      return;
    }

    const priorFrom = prior.range.from.getTime();
    const priorTo = prior.range.to.getTime();
    const newFrom = range.from.getTime();
    const newTo = range.to.getTime();

    // New strictly contains prior → widen.
    if (newFrom <= priorFrom && newTo >= priorTo) {
      this.store.set(k, { range: { from: range.from, to: range.to }, bars: [...bars] });
      return;
    }

    // New is contained by prior → no-op (prior already covers it).
    if (newFrom >= priorFrom && newTo <= priorTo) {
      return;
    }

    throw new Error(
      `BarCache.set: partial overlap on ${k} — ` +
        `prior=[${prior.range.from.toISOString()},${prior.range.to.toISOString()}], ` +
        `new=[${range.from.toISOString()},${range.to.toISOString()}]. ` +
        'Range merging is YAGNI in v0.1; fetch the full union range instead.',
    );
  }
}
