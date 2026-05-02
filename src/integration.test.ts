import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromSpec, type TacticalSpec } from '@livefolio/sdk/tactical';
import { runBacktest } from '@livefolio/sdk/strategy';
import { FeatureRuntime } from '@livefolio/sdk/features';
import { USEquityCalendar, MemoryFeatureCache, BacktestExecutor } from '@livefolio/sdk/reference';
import type { Asset, Bar, DateRange } from '@livefolio/sdk/interfaces';
import { YfinanceDataFeed } from './yfinance-data-feed';
import { fixtureFetcher } from './test-utils/fixture-fetcher';

const here = dirname(fileURLToPath(import.meta.url));
const SPY_FIXTURE = resolve(here, '../test/fixtures/SPY-2020-2024.json');
const IEF_FIXTURE = resolve(here, '../test/fixtures/IEF-2020-2024.json');

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const SPY_REF = { id: 'us:SPY', symbol: 'SPY' };
const IEF_REF = { id: 'us:IEF', symbol: 'IEF' };

/**
 * Multiplexes per-symbol fixture fetchers into a single fetcher dispatched on
 * the requested symbol.
 */
function multiFixtureFetcher(map: Record<string, string>) {
  const fetchers = new Map<string, ReturnType<typeof fixtureFetcher>>();
  for (const [sym, path] of Object.entries(map)) {
    fetchers.set(sym, fixtureFetcher(path));
  }
  return async (
    symbol: string,
    range: DateRange,
    freq: '1m' | '5m' | '15m' | '1h' | '1d',
    opts: { includeIncompleteToday: boolean },
  ) => {
    const f = fetchers.get(symbol);
    if (!f) throw new Error(`integration test: no fixture configured for symbol "${symbol}"`);
    return f(symbol, range, freq, opts);
  };
}

describe('integration: YfinanceDataFeed + tactical/v0 + runBacktest', () => {
  it('runs a binary SMA-crossover spec end to end and produces deterministic snapshots', async () => {
    const range: DateRange = { from: utc('2020-06-01'), to: utc('2020-12-31') };
    const calendar = new USEquityCalendar();

    const dataFeed = new YfinanceDataFeed({
      fetcher: multiFixtureFetcher({ SPY: SPY_FIXTURE, IEF: IEF_FIXTURE }),
    });

    const spec: TacticalSpec = {
      kind: 'tactical/v0',
      universe: [SPY_REF, IEF_REF],
      features: [
        { id: 'spy_price', kind: 'price', asset: SPY_REF },
        { id: 'spy_sma20', kind: 'sma', asset: SPY_REF, period: 20 },
      ],
      rules: {
        op: 'if',
        cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma20' } },
        then: { op: 'allocate', weights: { 'us:SPY': 1 } },
        else: { op: 'allocate', weights: { 'us:IEF': 1 } },
      },
    };

    const runtime = new FeatureRuntime({
      dataFeed,
      featureCache: new MemoryFeatureCache(),
      range,
      freq: '1d',
    });

    // Build a per-asset map of next-open prices from the fixtures so the
    // executor can resolve fills without making any live calls.
    const symbolToAsset = new Map<string, Asset>([
      ['SPY', { kind: 'equity', id: 'us:SPY', symbol: 'SPY' }],
      ['IEF', { kind: 'equity', id: 'us:IEF', symbol: 'IEF' }],
    ]);
    const barsByAsset = new Map<string, Bar[]>();
    for (const sym of ['SPY', 'IEF']) {
      const it = dataFeed.bars(symbolToAsset.get(sym)!, range, '1d');
      const collected: Bar[] = [];
      for await (const b of it) collected.push(b);
      barsByAsset.set(sym, collected);
    }

    const executor = new BacktestExecutor({
      calendar,
      nextOpen: async (asset, t) => {
        const series = barsByAsset.get(asset.symbol);
        if (!series) throw new Error(`no bars for ${asset.symbol}`);
        const next = series.find((b) => b.t.getTime() > t.getTime());
        return next ? { t: next.t, price: next.open } : { t, price: series.at(-1)?.close ?? 0 };
      },
    });

    const initialPortfolio = { cash: 100_000, positions: [], t: range.from };

    const strategy = fromSpec(spec, { runtime, calendar });
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio,
      dataFeed,
      executor,
      calendar,
    });

    const sessions = calendar.sessions(range);
    expect(result.snapshots.length).toBe(sessions.length);
    expect(result.finalPortfolio.cash).toBeGreaterThanOrEqual(0);

    // Each non-empty portfolio holds exactly one of SPY or IEF (binary spec).
    let everHeldSPY = false;
    let everHeldIEF = false;
    for (const snap of result.snapshots) {
      const symbols = new Set(snap.portfolio.positions.map((p) => p.asset.symbol));
      expect(symbols.size).toBeLessThanOrEqual(1);
      if (symbols.has('SPY')) everHeldSPY = true;
      if (symbols.has('IEF')) everHeldIEF = true;
    }

    // SPY/IEF rotation across the COVID-rebound window: both should appear.
    expect(everHeldSPY).toBe(true);
    expect(everHeldIEF).toBe(true);

    // Deterministic: re-running with a fresh feed produces identical final cash.
    const dataFeed2 = new YfinanceDataFeed({
      fetcher: multiFixtureFetcher({ SPY: SPY_FIXTURE, IEF: IEF_FIXTURE }),
    });
    const runtime2 = new FeatureRuntime({
      dataFeed: dataFeed2,
      featureCache: new MemoryFeatureCache(),
      range,
      freq: '1d',
    });
    const barsByAsset2 = new Map<string, Bar[]>();
    for (const sym of ['SPY', 'IEF']) {
      const it = dataFeed2.bars(symbolToAsset.get(sym)!, range, '1d');
      const collected: Bar[] = [];
      for await (const b of it) collected.push(b);
      barsByAsset2.set(sym, collected);
    }
    const executor2 = new BacktestExecutor({
      calendar,
      nextOpen: async (asset, t) => {
        const series = barsByAsset2.get(asset.symbol);
        if (!series) throw new Error(`no bars for ${asset.symbol}`);
        const next = series.find((b) => b.t.getTime() > t.getTime());
        return next ? { t: next.t, price: next.open } : { t, price: series.at(-1)?.close ?? 0 };
      },
    });
    const result2 = await runBacktest({
      strategy: fromSpec(spec, { runtime: runtime2, calendar }),
      range,
      initialPortfolio,
      dataFeed: dataFeed2,
      executor: executor2,
      calendar,
    });
    expect(result2.finalPortfolio.cash).toBeCloseTo(result.finalPortfolio.cash, 8);
    expect(result2.snapshots.length).toBe(result.snapshots.length);
  });
});
