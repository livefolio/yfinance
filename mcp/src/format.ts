import type { Bar, Quote } from '@livefolio/sdk';

export type QuoteOut = {
  symbol: string;
  price: number;
  time: string;
  currency?: string;
  bid?: number;
  ask?: number;
};

export type BarRow = { t: string; o: number; h: number; l: number; c: number; v: number };

export type BarsOut = {
  symbol: string;
  from: string;
  to: string;
  count: number;
  bars: readonly BarRow[];
};

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Shape an adapter `Quote` into the tool's structured output. `symbol` is the
 *  caller-supplied ticker, echoed verbatim. */
export function quoteToOutput(symbol: string, q: Quote): QuoteOut {
  const out: QuoteOut = { symbol, price: q.price, time: q.t.toISOString() };
  if (q.currency != null) out.currency = q.currency;
  if (q.bid != null) out.bid = q.bid;
  if (q.ask != null) out.ask = q.ask;
  return out;
}

/** Human-readable one-line summary of an already-shaped {@link QuoteOut}. */
export function quoteSummary(q: QuoteOut): string {
  const cur = q.currency != null ? ` ${q.currency}` : '';
  return `${q.symbol}: ${q.price}${cur} (as of ${q.time})`;
}

/** Shape adapter `Bar[]` into compact rows. `t` is the UTC-midnight day as `YYYY-MM-DD`. */
export function barsToOutput(symbol: string, from: string, to: string, bars: ReadonlyArray<Bar>): BarsOut {
  return {
    symbol,
    from,
    to,
    count: bars.length,
    bars: bars.map((b) => ({ t: isoDay(b.t), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume })),
  };
}

/** Human-readable one-line summary of an already-shaped {@link BarsOut}. */
export function barsSummary(out: BarsOut): string {
  if (out.count === 0) {
    return `${out.symbol} — no bars in range ${out.from} → ${out.to}.`;
  }
  const first = out.bars[0]!;
  const last = out.bars[out.count - 1]!;
  return `${out.symbol} — ${out.count} daily bars, ${first.t} → ${last.t}. Last close ${last.c}.`;
}
