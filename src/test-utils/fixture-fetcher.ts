import { readFileSync } from 'node:fs';
import type { Bar, DateRange, Frequency } from '@livefolio/sdk';
import type { YfinanceFetcher } from '../yfinance-data-feed';

type RawBar = { t: string; open: number; high: number; low: number; close: number; volume: number };

type FixtureFile = {
  symbol: string;
  range: { from: string; to: string };
  bars: RawBar[];
};

/**
 * Returns a `YfinanceFetcher`-shaped function backed by a JSON fixture
 * captured by `test/fixtures/record.ts`. Used by tests to drive
 * `YfinanceDataFeed` fully offline.
 *
 * Throws loudly when the fixture's recorded range doesn't cover the requested
 * range — silent gaps would mask test bugs.
 */
export function fixtureFetcher(fixturePath: string): YfinanceFetcher {
  const raw = readFileSync(fixturePath, 'utf-8');
  const parsed = JSON.parse(raw) as FixtureFile;
  const bars: Bar[] = parsed.bars.map((b) => ({
    t: new Date(b.t),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
  const fixtureFrom = new Date(parsed.range.from).getTime();
  const fixtureTo = new Date(parsed.range.to).getTime();

  return async (symbol: string, range: DateRange, freq: Frequency, _opts) => {
    if (freq !== '1d') {
      throw new Error(`fixtureFetcher: only '1d' supported (got '${freq}')`);
    }
    const reqFrom = range.from.getTime();
    const reqTo = range.to.getTime();
    if (reqFrom < fixtureFrom || reqTo > fixtureTo) {
      throw new Error(
        `fixtureFetcher(${parsed.symbol}): requested range ` +
          `[${range.from.toISOString()},${range.to.toISOString()}] ` +
          `not covered by fixture [${parsed.range.from},${parsed.range.to}]`,
      );
    }
    if (parsed.symbol !== symbol) {
      throw new Error(`fixtureFetcher: fixture is for "${parsed.symbol}" but request asked for "${symbol}"`);
    }
    return bars.filter((b) => b.t.getTime() >= reqFrom && b.t.getTime() <= reqTo);
  };
}
