import YahooFinance from 'yahoo-finance2';
import type { Bar, DateRange, Frequency } from '@livefolio/sdk';

const yf = new YahooFinance();

export type FetchYahooBarsOptions = {
  /**
   * If true, the structural completeness filter is skipped — the in-progress /
   * not-yet-canonicalized today bar is returned as-is (with its raw timestamp
   * normalized to UTC midnight). Default false; v0.4 backtests always want false.
   */
  includeIncompleteToday?: boolean;
};

type RawQuote = {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjclose?: number | null;
};

const todSeconds = (d: Date): number => d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();

const utcMidnight = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Fetch daily bars from Yahoo Finance for `symbol` over `range`.
 *
 * Returns v0.4 `Bar[]` with UTC-midnight timestamps and OHLCV from Yahoo's
 * adjusted-close path (close = adjclose when present, splits/dividends baked in).
 *
 * Applies the DST-agnostic structural completeness filter — drops the last bar
 * iff its UTC time-of-day differs from the modal time-of-day of the preceding
 * bars. Single-bar responses are kept verbatim. Pass
 * `{ includeIncompleteToday: true }` to lift the filter for live-trading use.
 *
 * Throws if `freq !== '1d'`. Frequencies other than `1d` are out of scope for
 * v0.1 of the adapter.
 */
export async function fetchYahooBars(
  symbol: string,
  range: DateRange,
  freq: Frequency,
  opts?: FetchYahooBarsOptions,
): Promise<Bar[]> {
  if (freq !== '1d') {
    throw new Error(`yfinance: only '1d' is supported in v0.1 (got '${freq}')`);
  }

  const result = await yf.chart(symbol, {
    period1: range.from,
    period2: range.to,
    interval: '1d',
  });

  let quotes: RawQuote[] = (result.quotes ?? []) as RawQuote[];

  // Defensive: ensure ascending by date.
  quotes = [...quotes].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Structural completeness filter (default-on).
  if (!opts?.includeIncompleteToday && quotes.length >= 2) {
    const last = quotes[quotes.length - 1]!;
    const prior = quotes.slice(0, -1);
    const counts = new Map<number, number>();
    for (const q of prior) {
      const t = todSeconds(q.date);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const modal = sorted[0]![0];
    if (todSeconds(last.date) !== modal) {
      quotes = prior;
    }
  }

  const bars: Bar[] = [];
  for (const q of quotes) {
    if (q.open === null || q.high === null || q.low === null || q.close === null || q.volume === null) {
      continue;
    }
    // Apply Yahoo's adjclose ratio uniformly to OHL so bars stay internally
    // consistent (high ≥ close ≥ low) across dividend and split days. Volume is
    // a count of units, not a price, so it stays raw. The v0.4 spec accepts
    // total-return-adjusted bars as the fidelity bar; pairing this adapter
    // with a live broker executor isn't a supported configuration (use the
    // broker's own data feed for live).
    const ratio = q.adjclose != null && q.close > 0 ? q.adjclose / q.close : 1;
    bars.push({
      t: utcMidnight(q.date),
      open: q.open * ratio,
      high: q.high * ratio,
      low: q.low * ratio,
      close: q.adjclose ?? q.close,
      volume: q.volume,
    });
  }

  return bars;
}
