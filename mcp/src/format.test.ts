import { describe, it, expect } from 'vitest';
import type { Bar, Quote } from '@livefolio/sdk';
import { quoteToOutput, quoteSummary, barsToOutput, barsSummary } from './format';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const asset = { kind: 'equity', id: 'yf:AAPL', symbol: 'AAPL' } as const;

describe('quoteToOutput', () => {
  it('maps required fields and ISO time', () => {
    const q: Quote = { asset, t: utc('2026-06-13'), price: 201.45 };
    expect(quoteToOutput('AAPL', q)).toEqual({
      symbol: 'AAPL',
      price: 201.45,
      time: '2026-06-13T00:00:00.000Z',
    });
  });

  it('includes optional fields only when present', () => {
    const q: Quote = { asset, t: utc('2026-06-13'), price: 10, currency: 'USD', bid: 9.9, ask: 10.1 };
    expect(quoteToOutput('AAPL', q)).toEqual({
      symbol: 'AAPL',
      price: 10,
      time: '2026-06-13T00:00:00.000Z',
      currency: 'USD',
      bid: 9.9,
      ask: 10.1,
    });
  });

  it('includes bid alone without currency or ask', () => {
    const q: Quote = { asset, t: utc('2026-06-13'), price: 10, bid: 9.9 };
    expect(quoteToOutput('AAPL', q)).toEqual({
      symbol: 'AAPL',
      price: 10,
      time: '2026-06-13T00:00:00.000Z',
      bid: 9.9,
    });
  });
});

describe('quoteSummary', () => {
  it('renders symbol, price, currency, time', () => {
    expect(quoteSummary({ symbol: 'AAPL', price: 201.45, time: '2026-06-13T00:00:00.000Z', currency: 'USD' })).toBe(
      'AAPL: 201.45 USD (as of 2026-06-13T00:00:00.000Z)',
    );
  });

  it('omits currency segment when absent', () => {
    expect(quoteSummary({ symbol: 'AAPL', price: 5, time: '2026-06-13T00:00:00.000Z' })).toBe(
      'AAPL: 5 (as of 2026-06-13T00:00:00.000Z)',
    );
  });
});

function bar(date: string, o: number, h: number, l: number, c: number, v: number): Bar {
  return { t: utc(date), open: o, high: h, low: l, close: c, volume: v };
}

describe('barsToOutput', () => {
  it('maps bars to compact rows with date-only t and count', () => {
    const out = barsToOutput('AAPL', '2024-01-01', '2024-01-31', [
      bar('2024-01-02', 10, 12, 9, 11, 1000),
      bar('2024-01-03', 11, 13, 10, 12.5, 1100),
    ]);
    expect(out).toEqual({
      symbol: 'AAPL',
      from: '2024-01-01',
      to: '2024-01-31',
      count: 2,
      bars: [
        { t: '2024-01-02', o: 10, h: 12, l: 9, c: 11, v: 1000 },
        { t: '2024-01-03', o: 11, h: 13, l: 10, c: 12.5, v: 1100 },
      ],
    });
  });

  it('handles an empty range', () => {
    const out = barsToOutput('AAPL', '2024-01-01', '2024-01-01', []);
    expect(out.count).toBe(0);
    expect(out.bars).toEqual([]);
  });
});

describe('barsSummary', () => {
  it('summarizes first→last and last close', () => {
    const out = barsToOutput('AAPL', '2024-01-01', '2024-01-31', [
      bar('2024-01-02', 10, 12, 9, 11, 1000),
      bar('2024-01-03', 11, 13, 10, 12.5, 1100),
    ]);
    expect(barsSummary(out)).toBe('AAPL — 2 daily bars, 2024-01-02 → 2024-01-03. Last close 12.5.');
  });

  it('reports an empty range distinctly', () => {
    const out = barsToOutput('AAPL', '2024-01-01', '2024-01-01', []);
    expect(barsSummary(out)).toBe('AAPL — no bars in range 2024-01-01 → 2024-01-01.');
  });
});
