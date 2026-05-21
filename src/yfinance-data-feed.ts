import type { Asset, Bar, DataFeed, DateRange, Frequency, Quote, QuoteFeed } from '@livefolio/sdk';
import { assetToYahooSymbol } from './asset';
import { fetchYahooBars } from './yahoo-client';
import { fetchYahooQuoteForAsset, fetchYahooQuoteBatchForAssets } from './yahoo-quote';
import { BarCache } from './cache';

export type YfinanceFetcher = (
  symbol: string,
  range: DateRange,
  freq: Frequency,
  opts: { includeIncompleteToday: boolean },
) => Promise<Bar[]>;

export type YfinanceQuoteFetcher = (asset: Asset) => Promise<Quote>;
export type YfinanceQuoteBatchFetcher = (assets: ReadonlyArray<Asset>) => Promise<ReadonlyArray<Quote>>;

export type YfinanceDataFeedOptions = {
  /**
   * Override the live Yahoo client. Tests inject a fixture-backed fetcher
   * so the test suite is offline-safe end to end.
   */
  fetcher?: YfinanceFetcher;
  /**
   * Forwarded into every fetch as `opts.includeIncompleteToday`. Default `false`
   * — backtests want canonical session bars only and the structural completeness
   * filter must be on. See `fetchYahooBars` for the rationale.
   */
  includeIncompleteToday?: boolean;
  /**
   * Override the live Yahoo quote client. Tests inject a stub so the suite
   * remains offline. Defaults to {@link fetchYahooQuoteForAsset}.
   */
  quoteFetcher?: YfinanceQuoteFetcher;
  /**
   * Override the live Yahoo batch-quote client. Defaults to
   * {@link fetchYahooQuoteBatchForAssets}.
   */
  quoteBatchFetcher?: YfinanceQuoteBatchFetcher;
};

const defaultFetcher: YfinanceFetcher = (symbol, range, freq, opts) => fetchYahooBars(symbol, range, freq, opts);

/**
 * Implements `@livefolio/sdk` v0.4's `DataFeed.bars` and `QuoteFeed` over
 * Yahoo Finance.
 *
 * Composition for bars: `assetToYahooSymbol` → `BarCache` → `fetchYahooBars`.
 * A per-instance `BarCache` deduplicates fetches inside a backtest; an
 * in-flight map further dedupes concurrent calls for the same `(symbol, freq)`
 * so a race never doubles up on Yahoo.
 *
 * Quotes are uncached and round-trip to Yahoo on every call — the SDK
 * contract requires a freshly-fetched price. Callers that want to coalesce
 * bursts should wrap with their own short-TTL cache.
 *
 * `fundamentals` and `events` are intentionally *not* defined on the instance
 * — the SDK's interface marks them optional, and consumers feature-detect via
 * `'fundamentals' in feed`.
 */
export class YfinanceDataFeed implements DataFeed, QuoteFeed {
  private readonly fetcher: YfinanceFetcher;
  private readonly includeIncompleteToday: boolean;
  private readonly quoteFetcher: YfinanceQuoteFetcher;
  private readonly quoteBatchFetcher: YfinanceQuoteBatchFetcher;
  private readonly cache = new BarCache();
  private readonly inflight = new Map<string, Promise<Bar[]>>();

  constructor(opts: YfinanceDataFeedOptions = {}) {
    this.fetcher = opts.fetcher ?? defaultFetcher;
    this.includeIncompleteToday = opts.includeIncompleteToday ?? false;
    this.quoteFetcher = opts.quoteFetcher ?? fetchYahooQuoteForAsset;
    this.quoteBatchFetcher = opts.quoteBatchFetcher ?? fetchYahooQuoteBatchForAssets;
  }

  quote(asset: Asset): Promise<Quote> {
    return this.quoteFetcher(asset);
  }

  async quoteBatch(assets: ReadonlyArray<Asset>): Promise<ReadonlyArray<Quote>> {
    return this.quoteBatchFetcher(assets);
  }

  bars(asset: Asset, range: DateRange, freq: Frequency): AsyncIterable<Bar> {
    return this.iterate(asset, range, freq);
  }

  private async *iterate(asset: Asset, range: DateRange, freq: Frequency): AsyncIterable<Bar> {
    const symbol = assetToYahooSymbol(asset);

    const cached = this.cache.get(symbol, range, freq);
    if (cached !== undefined) {
      for (const b of cached) yield b;
      return;
    }

    const inflightKey = `${symbol}:${freq}`;
    let pending = this.inflight.get(inflightKey);
    if (!pending) {
      pending = (async () => {
        try {
          const bars = await this.fetcher(symbol, range, freq, {
            includeIncompleteToday: this.includeIncompleteToday,
          });
          this.cache.set(symbol, freq, range, bars);
          return bars;
        } finally {
          this.inflight.delete(inflightKey);
        }
      })();
      this.inflight.set(inflightKey, pending);
    }

    await pending;

    // After the fetch, the cache should serve the requested range. If the
    // concurrent fetch was for a different range, fall back to the resolved
    // bars filtered to this caller's range.
    const post = this.cache.get(symbol, range, freq);
    if (post !== undefined) {
      for (const b of post) yield b;
      return;
    }

    const bars = await pending;
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    for (const b of bars) {
      const t = b.t.getTime();
      if (t >= fromMs && t <= toMs) yield b;
    }
  }
}
