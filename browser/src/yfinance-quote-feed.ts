import type { Asset, Quote, QuoteFeed } from '@livefolio/sdk';
import { assetToYahooSymbol } from './asset';

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// Yahoo blocks empty User-Agent. Any non-empty value works.
const DEFAULT_HEADERS: Readonly<Record<string, string>> = { 'User-Agent': 'Mozilla/5.0' };

type ChartResult = {
  meta?: {
    currency?: string;
    regularMarketPrice?: number;
    regularMarketTime?: number;
    chartPreviousClose?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
    }>;
  };
};

type ChartResponse = {
  chart?: {
    result?: ChartResult[];
    error?: { code?: string; description?: string } | null;
  };
};

export type YfinanceQuoteFeedOptions = {
  /**
   * Replaces the global `fetch`. Use in tests to inject fixture responses
   * without touching the network.
   */
  fetch?: typeof fetch;
};

/**
 * Browser-safe {@link QuoteFeed} that reads the latest non-null minute close
 * from Yahoo's public `/v8/finance/chart` endpoint with `includePrePost=true`.
 *
 * **Why the chart endpoint and not `quote()`:** Yahoo's REST `quote` response
 * surfaces `regularMarketPrice` which is sticky on the prior session's close
 * during pre-market — verified $741.25 vs UI's live $738.41 on 2026-05-21.
 * The chart endpoint's minute-resolution `indicators.quote[0].close` array
 * carries the live pre/post-market prints.
 *
 * **Freshness contract:**
 * - Regular hours, pre-market (~04:00–09:30 ET), post-market (~16:00–20:00 ET):
 *   latency ≈ 1 minute, vendor-stamped via the corresponding `timestamp[]`.
 * - Overnight gap (~20:00 ET → 04:00 ET): Yahoo doesn't carry ATS bars; the
 *   returned `Quote.t` is the last post-market print and may be hours stale.
 *   Callers must inspect `Quote.t` for staleness — this adapter never
 *   fabricates a fresh stamp.
 * - Weekends / holidays: falls through to the prior session's last close.
 * - `meta.hasPrePostMarketData: false` (treasuries, mutual funds, thinly-traded
 *   ETFs): regular-session bars are still in the close array, so this works.
 *
 * **No caching.** Each `quote()` call fires a fresh HTTP request. `quoteBatch`
 * fans out one request per asset in parallel — Yahoo's chart endpoint is
 * per-symbol, so there is no true single-round-trip batch.
 */
export class YfinanceQuoteFeed implements QuoteFeed {
  private readonly fetchImpl: typeof fetch;

  constructor(opts: YfinanceQuoteFeedOptions = {}) {
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
  }

  async quote(asset: Asset): Promise<Quote> {
    const symbol = assetToYahooSymbol(asset);
    const result = await this.fetchChart(symbol);
    return resultToQuote(asset, symbol, result);
  }

  async quoteBatch(assets: ReadonlyArray<Asset>): Promise<ReadonlyArray<Quote>> {
    return Promise.all(assets.map((a) => this.quote(a)));
  }

  private async fetchChart(symbol: string): Promise<ChartResult> {
    const url = `${CHART_URL}${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=true`;
    const res = await this.fetchImpl(url, { headers: DEFAULT_HEADERS });
    if (!res.ok) {
      throw new Error(`yfinance quote ${symbol}: HTTP ${res.status}`);
    }
    const json = (await res.json()) as ChartResponse;
    const err = json.chart?.error;
    if (err) {
      throw new Error(`yfinance quote ${symbol}: ${err.code ?? 'error'} ${err.description ?? ''}`.trim());
    }
    const result = json.chart?.result?.[0];
    if (!result) {
      throw new Error(`yfinance quote ${symbol}: empty result`);
    }
    return result;
  }
}

function resultToQuote(asset: Asset, symbol: string, r: ChartResult): Quote {
  const timestamps = r.timestamp ?? [];
  const closes = r.indicators?.quote?.[0]?.close ?? [];

  // Walk back to the most recent non-null close — Yahoo occasionally nulls the
  // very last in-day bar before fill.
  for (let i = closes.length - 1; i >= 0; i--) {
    const c = closes[i];
    const t = timestamps[i];
    if (typeof c === 'number' && typeof t === 'number') {
      const quote: Quote = { asset, t: new Date(t * 1000), price: c };
      if (r.meta?.currency != null) quote.currency = r.meta.currency;
      return quote;
    }
  }

  // Empty / all-null series — fall back to meta for halted or de-listed tickers.
  const meta = r.meta;
  const price = meta?.regularMarketPrice ?? meta?.chartPreviousClose;
  if (typeof price !== 'number') {
    throw new Error(`yfinance quote ${symbol}: no price`);
  }
  const t = typeof meta?.regularMarketTime === 'number' ? new Date(meta.regularMarketTime * 1000) : new Date();
  const quote: Quote = { asset, t, price };
  if (meta?.currency != null) quote.currency = meta.currency;
  return quote;
}
