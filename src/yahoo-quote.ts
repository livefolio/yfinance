import YahooFinance from 'yahoo-finance2';
import type { Asset, Quote } from '@livefolio/sdk';
import { assetToYahooSymbol } from './asset';

const yf = new YahooFinance();

type YahooQuoteShape = {
  symbol?: string;
  currency?: string;
  bid?: number;
  ask?: number;
  regularMarketPrice?: number;
  regularMarketTime?: Date;
  preMarketPrice?: number;
  preMarketTime?: Date;
  postMarketPrice?: number;
  postMarketTime?: Date;
};

type PricedSnapshot = { price: number; t: Date };

/**
 * Pick the freshest (price, time) pair across Yahoo's three session slots
 * (pre / regular / post). This is REST-only — during the US overnight session
 * (20:00–04:00 ET) Yahoo's quote endpoint freezes `postMarketPrice` at the
 * 20:00 ET stamp, so callers will observe a stale-but-honest post-market
 * quote. Real overnight (Blue Ocean/BATS) ticks are only available via Yahoo's
 * WebSocket streamer — see `@livefolio/yfinance-browser`.
 */
function pickFreshest(raw: YahooQuoteShape): PricedSnapshot | undefined {
  const candidates: PricedSnapshot[] = [];
  if (raw.regularMarketPrice != null && raw.regularMarketTime != null) {
    candidates.push({ price: raw.regularMarketPrice, t: raw.regularMarketTime });
  }
  if (raw.preMarketPrice != null && raw.preMarketTime != null) {
    candidates.push({ price: raw.preMarketPrice, t: raw.preMarketTime });
  }
  if (raw.postMarketPrice != null && raw.postMarketTime != null) {
    candidates.push({ price: raw.postMarketPrice, t: raw.postMarketTime });
  }
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, c) => (c.t.getTime() > best.t.getTime() ? c : best));
}

function toQuote(asset: Asset, raw: YahooQuoteShape): Quote {
  const snap = pickFreshest(raw);
  if (!snap) {
    throw new Error(`yfinance: no price available for ${assetToYahooSymbol(asset)}`);
  }
  const quote: Quote = { asset, t: snap.t, price: snap.price };
  if (raw.currency != null) quote.currency = raw.currency;
  if (raw.bid != null) quote.bid = raw.bid;
  if (raw.ask != null) quote.ask = raw.ask;
  return quote;
}

/**
 * Fetch a single freshly-stamped quote for `symbol`. The returned `t` is
 * Yahoo's vendor stamp (never the local clock); the price is whichever of
 * pre/regular/post is most recent. Throws if Yahoo returns no usable price.
 */
export async function fetchYahooQuote(symbol: string): Promise<Quote> {
  const raw = (await yf.quote(symbol)) as YahooQuoteShape | undefined;
  if (!raw) {
    throw new Error(`yfinance: no quote returned for ${symbol}`);
  }
  // Synthesize a minimal Asset so toQuote can format error messages; callers
  // that need the canonical Asset use the QuoteFeed method on the feed class.
  return toQuote({ kind: 'equity', id: `yf:${symbol}`, symbol }, raw);
}

/**
 * Batch-fetch quotes in a single Yahoo round-trip. The returned array is in
 * the SAME order as `symbols`. Throws if any requested symbol is absent from
 * Yahoo's response — the QuoteFeed contract forbids silent omission.
 */
export async function fetchYahooQuoteBatch(symbols: ReadonlyArray<string>): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const raws = (await yf.quote(symbols as string[])) as YahooQuoteShape[] | undefined;
  const list = Array.isArray(raws) ? raws : [];
  const bySymbol = new Map<string, YahooQuoteShape>();
  for (const r of list) {
    if (r.symbol != null) bySymbol.set(r.symbol, r);
  }
  return symbols.map((s) => {
    const raw = bySymbol.get(s);
    if (!raw) {
      throw new Error(`yfinance: no quote returned for ${s}`);
    }
    return toQuote({ kind: 'equity', id: `yf:${s}`, symbol: s }, raw);
  });
}

/**
 * Variant of {@link fetchYahooQuote} that stamps the original `Asset` onto
 * the returned `Quote` — used by the `QuoteFeed` method on the data feed so
 * callers get back exactly the asset they passed in.
 */
export async function fetchYahooQuoteForAsset(asset: Asset): Promise<Quote> {
  const symbol = assetToYahooSymbol(asset);
  const raw = (await yf.quote(symbol)) as YahooQuoteShape | undefined;
  if (!raw) {
    throw new Error(`yfinance: no quote returned for ${symbol}`);
  }
  return toQuote(asset, raw);
}

/**
 * Asset-preserving batch variant. Returned quotes carry the input `Asset`
 * (not a synthesized one) and preserve input order.
 */
export async function fetchYahooQuoteBatchForAssets(assets: ReadonlyArray<Asset>): Promise<Quote[]> {
  if (assets.length === 0) return [];
  const symbols = assets.map(assetToYahooSymbol);
  const raws = (await yf.quote(symbols)) as YahooQuoteShape[] | undefined;
  const list = Array.isArray(raws) ? raws : [];
  const bySymbol = new Map<string, YahooQuoteShape>();
  for (const r of list) {
    if (r.symbol != null) bySymbol.set(r.symbol, r);
  }
  return assets.map((asset, i) => {
    const sym = symbols[i]!;
    const raw = bySymbol.get(sym);
    if (!raw) {
      throw new Error(`yfinance: no quote returned for ${sym}`);
    }
    return toQuote(asset, raw);
  });
}
