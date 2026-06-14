import type { Asset, Bar, DateRange, Frequency, Quote } from '@livefolio/sdk';
import { fetchYahooQuoteForAsset, fetchYahooQuoteBatchForAssets, fetchYahooBars } from '@livefolio/yfinance';

/** The adapter surface the tools depend on. Injectable so tests run offline. */
export type ServerDeps = {
  fetchQuote: (asset: Asset) => Promise<Quote>;
  fetchQuoteBatch: (assets: ReadonlyArray<Asset>) => Promise<ReadonlyArray<Quote>>;
  fetchBars: (
    symbol: string,
    range: DateRange,
    freq: Frequency,
    opts: { includeIncompleteToday: boolean },
  ) => Promise<Bar[]>;
};

/** Real adapter exports (stateless — no YfinanceDataFeed, no cache; see spec D1). */
export const defaultDeps: ServerDeps = {
  fetchQuote: fetchYahooQuoteForAsset,
  fetchQuoteBatch: fetchYahooQuoteBatchForAssets,
  fetchBars: (symbol, range, freq, opts) => fetchYahooBars(symbol, range, freq, opts),
};

/** Build a v0.4 equity `Asset` from a ticker. Symbol normalization (e.g. `.`→`-`)
 *  is the adapter's job via `assetToYahooSymbol`. */
export const equityAsset = (symbol: string): Asset => ({ kind: 'equity', id: `yf:${symbol}`, symbol });
