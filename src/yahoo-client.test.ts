import { describe, it, expect, vi, beforeEach } from 'vitest';

// Default-export the constructor mock so `new YahooFinance()` returns an
// object whose `chart` is the per-test stub.
const { chartMock } = vi.hoisted(() => ({ chartMock: vi.fn() }));

vi.mock('yahoo-finance2', () => {
  class YahooFinance {
    chart = chartMock;
  }
  return { default: YahooFinance };
});

import { fetchYahooBars } from './yahoo-client';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const dt = (date: string, timeOfDay: string) => new Date(`${date}T${timeOfDay}Z`);

type Quote = {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjclose?: number | null;
};

function quotes(rows: Quote[]) {
  chartMock.mockResolvedValueOnce({ meta: {}, quotes: rows });
}

describe('fetchYahooBars', () => {
  beforeEach(() => {
    chartMock.mockReset();
  });

  it('happy path: 3 historical bars at canonical 13:30Z normalize to UTC midnight', async () => {
    quotes([
      { date: dt('2024-04-01', '13:30:00'), open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
      { date: dt('2024-04-02', '13:30:00'), open: 101, high: 102, low: 100, close: 101.5, volume: 1100 },
      { date: dt('2024-04-03', '13:30:00'), open: 102, high: 103, low: 101, close: 102.5, volume: 1200 },
    ]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-03') }, '1d');
    expect(out).toHaveLength(3);
    expect(out[0]?.t.toISOString()).toBe('2024-04-01T00:00:00.000Z');
    expect(out[1]?.t.toISOString()).toBe('2024-04-02T00:00:00.000Z');
    expect(out[2]?.t.toISOString()).toBe('2024-04-03T00:00:00.000Z');
    expect(out[0]).toMatchObject({ open: 100, high: 101, low: 99, close: 100.5, volume: 1000 });
  });

  it('uses adjclose for close field when available (split/dividend-adjusted)', async () => {
    quotes([
      {
        date: dt('2024-04-01', '13:30:00'),
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
        adjclose: 80.4,
      },
      {
        date: dt('2024-04-02', '13:30:00'),
        open: 101,
        high: 102,
        low: 100,
        close: 101.5,
        volume: 1000,
        adjclose: 81.2,
      },
    ]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-02') }, '1d');
    expect(out[0]?.close).toBe(80.4);
    expect(out[1]?.close).toBe(81.2);
  });

  it('throws on non-1d frequencies', async () => {
    await expect(fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-02') }, '5m')).rejects.toThrow(
      /only '1d' is supported/,
    );
  });

  it('drops rows with any null OHLC field', async () => {
    quotes([
      { date: dt('2024-04-01', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-02', '13:30:00'), open: null, high: 102, low: 100, close: 101, volume: 1100 },
      { date: dt('2024-04-03', '13:30:00'), open: 102, high: 103, low: 101, close: 102, volume: 1200 },
    ]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-03') }, '1d');
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.t.toISOString())).toEqual(['2024-04-01T00:00:00.000Z', '2024-04-03T00:00:00.000Z']);
  });

  it('empty quotes array returns []', async () => {
    quotes([]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-03') }, '1d');
    expect(out).toEqual([]);
  });

  it('single-bar response: filter is a no-op (keep the bar)', async () => {
    quotes([{ date: dt('2024-04-01', '17:42:13'), open: 100, high: 101, low: 99, close: 100, volume: 1000 }]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-01') }, '1d');
    expect(out).toHaveLength(1);
    expect(out[0]?.t.toISOString()).toBe('2024-04-01T00:00:00.000Z');
  });

  it('DST-during, in-progress drop: 4 historical at 13:30Z + 5th at 17:42:13Z → 4 bars out', async () => {
    quotes([
      { date: dt('2024-04-01', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-02', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-03', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-04', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-05', '17:42:13'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    ]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d');
    expect(out).toHaveLength(4);
    expect(out.at(-1)?.t.toISOString()).toBe('2024-04-04T00:00:00.000Z');
  });

  it('DST-during, freshly-closed drop: 4 historical at 13:30Z + 5th at 21:00Z → 4 bars out', async () => {
    quotes([
      { date: dt('2024-04-01', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-02', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-03', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-04', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-05', '21:00:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    ]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d');
    expect(out).toHaveLength(4);
  });

  it('DST-during, canonicalized: all 5 bars at 13:30Z → 5 bars out', async () => {
    quotes([
      { date: dt('2024-04-01', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-02', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-03', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-04', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-05', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    ]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d');
    expect(out).toHaveLength(5);
  });

  it('Standard-time scenario: 4 at 14:30Z + 5th at 22:00Z → 4 bars (DST-agnostic)', async () => {
    quotes([
      { date: dt('2024-12-02', '14:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-12-03', '14:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-12-04', '14:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-12-05', '14:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-12-06', '22:00:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    ]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-12-02'), to: utc('2024-12-06') }, '1d');
    expect(out).toHaveLength(4);
  });

  it('DST-boundary scenario: 2 pre-DST 14:30Z + 4 post-DST 13:30Z, last is post-DST canonical → 6 bars', async () => {
    // Plan rationale: bars before and after the DST boundary have different times-of-day,
    // but the modal of "preceding bars" picks the dominant one. When the last bar's
    // time-of-day matches that modal (or the post-DST shape dominates), no drop.
    quotes([
      { date: dt('2024-03-07', '14:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-03-08', '14:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-03-11', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-03-12', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-03-13', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-03-14', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    ]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-03-07'), to: utc('2024-03-14') }, '1d');
    expect(out).toHaveLength(6);
    expect(out.map((b) => b.t.toISOString())).toEqual([
      '2024-03-07T00:00:00.000Z',
      '2024-03-08T00:00:00.000Z',
      '2024-03-11T00:00:00.000Z',
      '2024-03-12T00:00:00.000Z',
      '2024-03-13T00:00:00.000Z',
      '2024-03-14T00:00:00.000Z',
    ]);
  });

  it('opt-in lift: includeIncompleteToday=true keeps the in-progress bar, normalized', async () => {
    quotes([
      { date: dt('2024-04-01', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-02', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-03', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-04', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-05', '17:42:13'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    ]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d', {
      includeIncompleteToday: true,
    });
    expect(out).toHaveLength(5);
    expect(out.at(-1)?.t.toISOString()).toBe('2024-04-05T00:00:00.000Z');
  });

  it('returns bars sorted ascending by t', async () => {
    quotes([
      { date: dt('2024-04-01', '13:30:00'), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: dt('2024-04-02', '13:30:00'), open: 101, high: 102, low: 100, close: 101, volume: 1000 },
      { date: dt('2024-04-03', '13:30:00'), open: 102, high: 103, low: 101, close: 102, volume: 1000 },
    ]);
    const out = await fetchYahooBars('SPY', { from: utc('2024-04-01'), to: utc('2024-04-03') }, '1d');
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.t.getTime()).toBeGreaterThan(out[i - 1]!.t.getTime());
    }
  });
});
