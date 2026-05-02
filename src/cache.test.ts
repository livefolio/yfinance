import { describe, it, expect } from 'vitest';
import type { Bar } from '@livefolio/sdk/interfaces';
import { BarCache } from './cache';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function bar(date: string, close: number): Bar {
  return { t: utc(date), open: close, high: close, low: close, close, volume: 1 };
}

const SPY_2024 = [
  bar('2024-04-01', 100),
  bar('2024-04-02', 101),
  bar('2024-04-03', 102),
  bar('2024-04-04', 103),
  bar('2024-04-05', 104),
];

describe('BarCache', () => {
  it('empty cache miss returns undefined', () => {
    const c = new BarCache();
    const out = c.get('SPY', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d');
    expect(out).toBeUndefined();
  });

  it('exact-range hit returns the full slice', () => {
    const c = new BarCache();
    const range = { from: utc('2024-04-01'), to: utc('2024-04-05') };
    c.set('SPY', '1d', range, SPY_2024);
    const out = c.get('SPY', range, '1d');
    expect(out).toHaveLength(5);
    expect(out?.[0]?.t.toISOString()).toBe('2024-04-01T00:00:00.000Z');
    expect(out?.[4]?.t.toISOString()).toBe('2024-04-05T00:00:00.000Z');
  });

  it('sub-range hit returns the bars within the requested range, inclusive both ends', () => {
    const c = new BarCache();
    c.set('SPY', '1d', { from: utc('2024-04-01'), to: utc('2024-04-05') }, SPY_2024);
    const out = c.get('SPY', { from: utc('2024-04-02'), to: utc('2024-04-04') }, '1d');
    expect(out).toHaveLength(3);
    expect(out?.[0]?.t.toISOString()).toBe('2024-04-02T00:00:00.000Z');
    expect(out?.[2]?.t.toISOString()).toBe('2024-04-04T00:00:00.000Z');
  });

  it('super-range miss: requested range exceeds cached range', () => {
    const c = new BarCache();
    c.set('SPY', '1d', { from: utc('2024-04-02'), to: utc('2024-04-04') }, SPY_2024.slice(1, 4));
    const out = c.get('SPY', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d');
    expect(out).toBeUndefined();
  });

  it('isolates cache entries per symbol', () => {
    const c = new BarCache();
    const range = { from: utc('2024-04-01'), to: utc('2024-04-05') };
    c.set('SPY', '1d', range, SPY_2024);
    expect(c.get('QQQ', range, '1d')).toBeUndefined();
    expect(c.get('SPY', range, '1d')).toHaveLength(5);
  });

  it('isolates cache entries per frequency', () => {
    const c = new BarCache();
    const range = { from: utc('2024-04-01'), to: utc('2024-04-05') };
    c.set('SPY', '1d', range, SPY_2024);
    expect(c.get('SPY', range, '5m')).toBeUndefined();
  });

  it('set: strict-superset widens the cached range', () => {
    const c = new BarCache();
    c.set('SPY', '1d', { from: utc('2024-04-02'), to: utc('2024-04-04') }, SPY_2024.slice(1, 4));
    // Strict superset of the prior range — allowed.
    c.set('SPY', '1d', { from: utc('2024-04-01'), to: utc('2024-04-05') }, SPY_2024);
    const out = c.get('SPY', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d');
    expect(out).toHaveLength(5);
  });

  it('set: throws on partial overlap (YAGNI per plan)', () => {
    const c = new BarCache();
    c.set('SPY', '1d', { from: utc('2024-04-02'), to: utc('2024-04-04') }, SPY_2024.slice(1, 4));
    expect(() =>
      c.set('SPY', '1d', { from: utc('2024-04-03'), to: utc('2024-04-05') }, SPY_2024.slice(2, 5)),
    ).toThrow(/partial overlap/i);
  });
});
