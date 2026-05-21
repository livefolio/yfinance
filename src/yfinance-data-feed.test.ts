import { describe, it, expect, vi } from 'vitest';
import type { Asset, Bar, DateRange, Quote } from '@livefolio/sdk';
import { YfinanceDataFeed } from './yfinance-data-feed';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function bar(date: string, close: number): Bar {
  return { t: utc(date), open: close, high: close, low: close, close, volume: 1 };
}

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };
const QQQ: Asset = { kind: 'equity', id: 'us:QQQ', symbol: 'QQQ' };

const SPY_BARS = [bar('2024-04-01', 100), bar('2024-04-02', 101), bar('2024-04-03', 102), bar('2024-04-04', 103)];

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('YfinanceDataFeed', () => {
  it('iterates bars on a single call (fetch then yield)', async () => {
    const fetcher = vi.fn(async () => SPY_BARS);
    const feed = new YfinanceDataFeed({ fetcher });
    const range: DateRange = { from: utc('2024-04-01'), to: utc('2024-04-04') };
    const out = await collect(feed.bars(SPY, range, '1d'));
    expect(out).toHaveLength(4);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('SPY', range, '1d', { includeIncompleteToday: false });
  });

  it('cache hit on second call: fetcher invoked exactly once across two overlapping calls', async () => {
    const fetcher = vi.fn(async () => SPY_BARS);
    const feed = new YfinanceDataFeed({ fetcher });
    await collect(feed.bars(SPY, { from: utc('2024-04-01'), to: utc('2024-04-04') }, '1d'));
    const second = await collect(feed.bars(SPY, { from: utc('2024-04-02'), to: utc('2024-04-03') }, '1d'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second).toHaveLength(2);
    expect(second[0]?.t.toISOString()).toBe('2024-04-02T00:00:00.000Z');
  });

  it('concurrent calls for the same (symbol, freq) issue at most one fetch', async () => {
    let resolveFn: ((v: Bar[]) => void) | undefined;
    const fetcher = vi.fn(
      () =>
        new Promise<Bar[]>((res) => {
          resolveFn = res;
        }),
    );
    const feed = new YfinanceDataFeed({ fetcher });
    const range: DateRange = { from: utc('2024-04-01'), to: utc('2024-04-04') };
    const a = collect(feed.bars(SPY, range, '1d'));
    const b = collect(feed.bars(SPY, range, '1d'));
    // Yield to event loop so both starts have registered.
    await new Promise((r) => setImmediate(r));
    resolveFn!(SPY_BARS);
    const [aOut, bOut] = await Promise.all([a, b]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(aOut).toHaveLength(4);
    expect(bOut).toHaveLength(4);
  });

  it('isolates fetches across symbols', async () => {
    const fetcher = vi.fn(async (sym: string) => (sym === 'SPY' ? SPY_BARS : SPY_BARS.slice(0, 2)));
    const feed = new YfinanceDataFeed({ fetcher });
    const range: DateRange = { from: utc('2024-04-01'), to: utc('2024-04-04') };
    const spy = await collect(feed.bars(SPY, range, '1d'));
    const qqq = await collect(feed.bars(QQQ, range, '1d'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(spy).toHaveLength(4);
    expect(qqq).toHaveLength(2);
  });

  it('forwards includeIncompleteToday to the fetcher', async () => {
    const fetcher = vi.fn(async () => SPY_BARS);
    const feed = new YfinanceDataFeed({ fetcher, includeIncompleteToday: true });
    const range: DateRange = { from: utc('2024-04-01'), to: utc('2024-04-04') };
    await collect(feed.bars(SPY, range, '1d'));
    expect(fetcher).toHaveBeenCalledWith('SPY', range, '1d', { includeIncompleteToday: true });
  });

  it('propagates errors from the fetcher (e.g. wrong freq throw)', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("yfinance: only '1d' is supported in v0.1");
    });
    const feed = new YfinanceDataFeed({ fetcher });
    const range: DateRange = { from: utc('2024-04-01'), to: utc('2024-04-04') };
    await expect(collect(feed.bars(SPY, range, '5m'))).rejects.toThrow(/only '1d'/);
  });

  it('does not define fundamentals/events properties on the instance', () => {
    const feed = new YfinanceDataFeed();
    expect('fundamentals' in feed).toBe(false);
    expect('events' in feed).toBe(false);
  });

  describe('QuoteFeed', () => {
    it('quote() delegates to the injected quote fetcher and returns its result', async () => {
      const expected: Quote = { asset: SPY, t: utc('2026-05-20'), price: 500 };
      const quoteFetcher = vi.fn(async () => expected);
      const feed = new YfinanceDataFeed({ quoteFetcher });
      const q = await feed.quote(SPY);
      expect(q).toBe(expected);
      expect(quoteFetcher).toHaveBeenCalledWith(SPY);
    });

    it('quoteBatch() delegates to the injected batch fetcher and preserves order', async () => {
      const quoteBatchFetcher = vi.fn(async (assets: ReadonlyArray<Asset>) =>
        assets.map((a, i) => ({ asset: a, t: utc('2026-05-20'), price: 100 + i })),
      );
      const feed = new YfinanceDataFeed({ quoteBatchFetcher });
      const qs = await feed.quoteBatch([SPY, QQQ]);
      expect(qs.map((q) => q.asset.symbol)).toEqual(['SPY', 'QQQ']);
      expect(qs.map((q) => q.price)).toEqual([100, 101]);
      expect(quoteBatchFetcher).toHaveBeenCalledWith([SPY, QQQ]);
    });

    it('does not cache quotes — each quote() call hits the fetcher', async () => {
      const quoteFetcher = vi.fn(async (a: Asset) => ({ asset: a, t: utc('2026-05-20'), price: 1 }));
      const feed = new YfinanceDataFeed({ quoteFetcher });
      await feed.quote(SPY);
      await feed.quote(SPY);
      expect(quoteFetcher).toHaveBeenCalledTimes(2);
    });
  });
});
