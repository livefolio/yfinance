import { describe, it, expect, vi, beforeEach } from 'vitest';

const { quoteMock } = vi.hoisted(() => ({ quoteMock: vi.fn() }));

vi.mock('yahoo-finance2', () => {
  class YahooFinance {
    quote = quoteMock;
  }
  return { default: YahooFinance };
});

import { fetchYahooQuote, fetchYahooQuoteBatch } from './yahoo-quote';

const dt = (iso: string) => new Date(iso);

describe('fetchYahooQuote', () => {
  beforeEach(() => quoteMock.mockReset());

  it('picks regularMarketPrice during REGULAR session', async () => {
    quoteMock.mockResolvedValueOnce({
      symbol: 'AAPL',
      marketState: 'REGULAR',
      currency: 'USD',
      regularMarketPrice: 200,
      regularMarketTime: dt('2026-05-20T18:00:00Z'),
      bid: 199.95,
      ask: 200.05,
    });
    const q = await fetchYahooQuote('AAPL');
    expect(q.price).toBe(200);
    expect(q.t.toISOString()).toBe('2026-05-20T18:00:00.000Z');
    expect(q.currency).toBe('USD');
    expect(q.bid).toBe(199.95);
    expect(q.ask).toBe(200.05);
  });

  it('picks postMarketPrice when stamped after regular close (POST or CLOSED)', async () => {
    quoteMock.mockResolvedValueOnce({
      symbol: 'AAPL',
      marketState: 'POST',
      currency: 'USD',
      regularMarketPrice: 200,
      regularMarketTime: dt('2026-05-20T20:00:00Z'),
      postMarketPrice: 201.5,
      postMarketTime: dt('2026-05-20T23:00:00Z'),
    });
    const q = await fetchYahooQuote('AAPL');
    expect(q.price).toBe(201.5);
    expect(q.t.toISOString()).toBe('2026-05-20T23:00:00.000Z');
  });

  it('picks preMarketPrice when its stamp is the most recent (PRE)', async () => {
    quoteMock.mockResolvedValueOnce({
      symbol: 'AAPL',
      marketState: 'PRE',
      currency: 'USD',
      regularMarketPrice: 200,
      regularMarketTime: dt('2026-05-19T20:00:00Z'),
      postMarketPrice: 201,
      postMarketTime: dt('2026-05-20T00:00:00Z'),
      preMarketPrice: 202,
      preMarketTime: dt('2026-05-20T12:00:00Z'),
    });
    const q = await fetchYahooQuote('AAPL');
    expect(q.price).toBe(202);
    expect(q.t.toISOString()).toBe('2026-05-20T12:00:00.000Z');
  });

  it('falls back to regular when only regular is present', async () => {
    quoteMock.mockResolvedValueOnce({
      symbol: 'AAPL',
      marketState: 'CLOSED',
      regularMarketPrice: 199.5,
      regularMarketTime: dt('2026-05-20T20:00:00Z'),
    });
    const q = await fetchYahooQuote('AAPL');
    expect(q.price).toBe(199.5);
  });

  it('throws when Yahoo returns no usable price', async () => {
    quoteMock.mockResolvedValueOnce({ symbol: 'XYZ', marketState: 'REGULAR' });
    await expect(fetchYahooQuote('XYZ')).rejects.toThrow(/no price/i);
  });

  it('throws when Yahoo returns nothing', async () => {
    quoteMock.mockResolvedValueOnce(undefined);
    await expect(fetchYahooQuote('NOPE')).rejects.toThrow(/no quote/i);
  });
});

describe('fetchYahooQuoteBatch', () => {
  beforeEach(() => quoteMock.mockReset());

  it('returns one quote per requested symbol in input order', async () => {
    quoteMock.mockResolvedValueOnce([
      {
        symbol: 'AAPL',
        marketState: 'REGULAR',
        regularMarketPrice: 200,
        regularMarketTime: dt('2026-05-20T18:00:00Z'),
      },
      {
        symbol: 'TSLA',
        marketState: 'POST',
        regularMarketPrice: 300,
        regularMarketTime: dt('2026-05-20T20:00:00Z'),
        postMarketPrice: 305,
        postMarketTime: dt('2026-05-20T23:00:00Z'),
      },
    ]);
    const qs = await fetchYahooQuoteBatch(['AAPL', 'TSLA']);
    expect(qs).toHaveLength(2);
    expect(qs[0]?.price).toBe(200);
    expect(qs[1]?.price).toBe(305);
  });

  it('preserves request order even when Yahoo returns symbols out of order', async () => {
    quoteMock.mockResolvedValueOnce([
      {
        symbol: 'TSLA',
        marketState: 'REGULAR',
        regularMarketPrice: 300,
        regularMarketTime: dt('2026-05-20T18:00:00Z'),
      },
      {
        symbol: 'AAPL',
        marketState: 'REGULAR',
        regularMarketPrice: 200,
        regularMarketTime: dt('2026-05-20T18:00:00Z'),
      },
    ]);
    const qs = await fetchYahooQuoteBatch(['AAPL', 'TSLA']);
    expect(qs[0]?.price).toBe(200);
    expect(qs[1]?.price).toBe(300);
  });

  it('throws if Yahoo omits a requested symbol', async () => {
    quoteMock.mockResolvedValueOnce([
      {
        symbol: 'AAPL',
        marketState: 'REGULAR',
        regularMarketPrice: 200,
        regularMarketTime: dt('2026-05-20T18:00:00Z'),
      },
    ]);
    await expect(fetchYahooQuoteBatch(['AAPL', 'GHOST'])).rejects.toThrow(/GHOST/);
  });
});
