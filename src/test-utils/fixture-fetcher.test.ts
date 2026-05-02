import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureFetcher } from './fixture-fetcher';

const here = dirname(fileURLToPath(import.meta.url));
const SPY_FIXTURE = resolve(here, '../../test/fixtures/SPY-2020-2024.json');

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

describe('fixtureFetcher', () => {
  it('returns bars filtered to the requested sub-range when fixture covers it', async () => {
    const fetch = fixtureFetcher(SPY_FIXTURE);
    const bars = await fetch('SPY', { from: utc('2020-06-01'), to: utc('2020-06-30') }, '1d', {
      includeIncompleteToday: false,
    });
    expect(bars.length).toBeGreaterThan(15); // ~22 trading days in June 2020
    expect(bars.length).toBeLessThan(25);
    for (const b of bars) {
      expect(b.t.getTime()).toBeGreaterThanOrEqual(utc('2020-06-01').getTime());
      expect(b.t.getTime()).toBeLessThanOrEqual(utc('2020-06-30').getTime());
    }
  });

  it('deserializes ISO timestamps back to Date objects', async () => {
    const fetch = fixtureFetcher(SPY_FIXTURE);
    const bars = await fetch('SPY', { from: utc('2020-06-01'), to: utc('2020-06-05') }, '1d', {
      includeIncompleteToday: false,
    });
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0]?.t).toBeInstanceOf(Date);
    expect(bars[0]?.t.toISOString().endsWith('T00:00:00.000Z')).toBe(true);
  });

  it('throws when the requested range is not covered by the fixture', async () => {
    const fetch = fixtureFetcher(SPY_FIXTURE);
    await expect(
      fetch('SPY', { from: utc('2019-01-01'), to: utc('2019-12-31') }, '1d', { includeIncompleteToday: false }),
    ).rejects.toThrow(/not covered by fixture/);
  });

  it('throws when the fixture symbol does not match the requested symbol', async () => {
    const fetch = fixtureFetcher(SPY_FIXTURE);
    await expect(
      fetch('QQQ', { from: utc('2020-06-01'), to: utc('2020-06-30') }, '1d', { includeIncompleteToday: false }),
    ).rejects.toThrow(/fixture is for "SPY"/);
  });

  it('throws on non-1d frequency', async () => {
    const fetch = fixtureFetcher(SPY_FIXTURE);
    await expect(
      fetch('SPY', { from: utc('2020-06-01'), to: utc('2020-06-30') }, '5m', { includeIncompleteToday: false }),
    ).rejects.toThrow(/only '1d'/);
  });
});
