import { describe, it, expect, vi } from 'vitest';
import type { Asset } from '@livefolio/sdk';
import { YfinanceQuoteFeed } from './yfinance-quote-feed';

const AAPL: Asset = { kind: 'equity', id: 'yf:AAPL', symbol: 'AAPL' };
const BRK_B: Asset = { kind: 'equity', id: 'yf:BRK.B', symbol: 'BRK.B' };

type ChartResultInput = {
  currency?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  chartPreviousClose?: number;
  timestamps?: number[];
  closes?: Array<number | null>;
};

function buildChartResponse(input: ChartResultInput): unknown {
  return {
    chart: {
      error: null,
      result: [
        {
          meta: {
            ...(input.currency !== undefined && { currency: input.currency }),
            ...(input.regularMarketPrice !== undefined && { regularMarketPrice: input.regularMarketPrice }),
            ...(input.regularMarketTime !== undefined && { regularMarketTime: input.regularMarketTime }),
            ...(input.chartPreviousClose !== undefined && { chartPreviousClose: input.chartPreviousClose }),
          },
          timestamp: input.timestamps ?? [],
          indicators: {
            quote: [{ close: input.closes ?? [] }],
          },
        },
      ],
    },
  };
}

function mockFetchJson(payload: unknown, init: Partial<Response> = {}): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
    ...init,
  } as Response) as unknown as typeof fetch;
}

describe('YfinanceQuoteFeed', () => {
  describe('quote()', () => {
    it('returns the freshest non-null close from the in-day series (regular hours)', async () => {
      // Three minute bars; latest is the freshest valid close.
      const t0 = 1_779_350 * 60;
      const fetchImpl = mockFetchJson(
        buildChartResponse({
          currency: 'USD',
          regularMarketPrice: 199.0,
          timestamps: [t0, t0 + 60, t0 + 120],
          closes: [198.5, 198.9, 199.4],
        }),
      );
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      const quote = await feed.quote(AAPL);

      expect(quote.asset).toBe(AAPL);
      expect(quote.price).toBe(199.4);
      expect(quote.t).toEqual(new Date((t0 + 120) * 1000));
      expect(quote.currency).toBe('USD');
    });

    it('prefers the latest close over the sticky meta.regularMarketPrice during pre-market', async () => {
      // Replicates the 2026-05-21 pre-market scenario: meta is stale, series is fresh.
      const t = 1_779_360 * 60;
      const fetchImpl = mockFetchJson(
        buildChartResponse({
          regularMarketPrice: 741.25, // stale prior close
          timestamps: [t - 60, t],
          closes: [738.5, 738.22],
        }),
      );
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      const quote = await feed.quote(AAPL);

      expect(quote.price).toBe(738.22);
      expect(quote.t).toEqual(new Date(t * 1000));
    });

    it('returns the latest post-market close when post-market bars are present', async () => {
      const t = 1_779_500 * 60;
      const fetchImpl = mockFetchJson(
        buildChartResponse({
          timestamps: [t - 120, t - 60, t],
          closes: [200.1, 200.5, 201.0],
        }),
      );
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      const quote = await feed.quote(AAPL);

      expect(quote.price).toBe(201.0);
      expect(quote.t).toEqual(new Date(t * 1000));
    });

    it('walks past trailing nulls to find the last valid close', async () => {
      const t = 1_779_400 * 60;
      const fetchImpl = mockFetchJson(
        buildChartResponse({
          timestamps: [t - 120, t - 60, t],
          closes: [195.0, 195.3, null], // last bar not yet filled
        }),
      );
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      const quote = await feed.quote(AAPL);

      expect(quote.price).toBe(195.3);
      expect(quote.t).toEqual(new Date((t - 60) * 1000));
    });

    it('weekend / holiday: returns the last close from the prior session', async () => {
      // hasPrePostMarketData unset, closes are last Friday's regular session.
      const tFriClose = Math.floor(new Date('2026-05-15T20:00:00Z').getTime() / 1000);
      const fetchImpl = mockFetchJson(
        buildChartResponse({
          timestamps: [tFriClose - 60, tFriClose],
          closes: [210.5, 211.0],
        }),
      );
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      const quote = await feed.quote(AAPL);

      expect(quote.price).toBe(211.0);
      expect(quote.t).toEqual(new Date(tFriClose * 1000));
      // Caller is responsible for detecting staleness via Quote.t.
    });

    it('hasPrePostMarketData: false (treasuries, mutual funds) — regular session bars still work', async () => {
      const t = Math.floor(new Date('2026-05-21T19:55:00Z').getTime() / 1000);
      const fetchImpl = mockFetchJson(
        buildChartResponse({
          currency: 'USD',
          timestamps: [t - 60, t],
          closes: [4.31, 4.32],
        }),
      );
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      const quote = await feed.quote({ kind: 'equity', id: 'yf:^TNX', symbol: '^TNX' });

      expect(quote.price).toBe(4.32);
      expect(quote.currency).toBe('USD');
    });

    it('halted ticker (all null closes) falls back to meta.regularMarketPrice', async () => {
      const tMeta = Math.floor(new Date('2026-05-21T13:30:00Z').getTime() / 1000);
      const fetchImpl = mockFetchJson(
        buildChartResponse({
          regularMarketPrice: 99.5,
          regularMarketTime: tMeta,
          timestamps: [tMeta - 60, tMeta],
          closes: [null, null],
        }),
      );
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      const quote = await feed.quote(AAPL);

      expect(quote.price).toBe(99.5);
      expect(quote.t).toEqual(new Date(tMeta * 1000));
    });

    it('halted ticker without regularMarketPrice falls back to chartPreviousClose', async () => {
      const fetchImpl = mockFetchJson(
        buildChartResponse({
          chartPreviousClose: 50.0,
          timestamps: [],
          closes: [],
        }),
      );
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      const quote = await feed.quote(AAPL);

      expect(quote.price).toBe(50.0);
    });

    it('translates class-share notation (BRK.B → BRK-B) in the request URL', async () => {
      const t = 1_779_400 * 60;
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(buildChartResponse({ timestamps: [t], closes: [430.0] })),
      } as Response) as unknown as typeof fetch;

      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });
      await feed.quote(BRK_B);

      const calledUrl = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('/chart/BRK-B?');
      expect(calledUrl).toContain('range=1d');
      expect(calledUrl).toContain('interval=1m');
      expect(calledUrl).toContain('includePrePost=true');
    });

    it('sends a non-empty User-Agent header (Yahoo blocks empty UA)', async () => {
      const t = 1_779_400 * 60;
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(buildChartResponse({ timestamps: [t], closes: [1] })),
      } as Response) as unknown as typeof fetch;

      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });
      await feed.quote(AAPL);

      const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['User-Agent']).toBeTruthy();
    });

    it('throws on HTTP non-2xx', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({}),
      } as Response) as unknown as typeof fetch;
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      await expect(feed.quote(AAPL)).rejects.toThrow(/HTTP 429/);
    });

    it('throws on Yahoo error payload', async () => {
      const fetchImpl = mockFetchJson({
        chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } },
      });
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      await expect(feed.quote({ kind: 'equity', id: 'yf:NOPE', symbol: 'NOPE' })).rejects.toThrow(/Not Found/);
    });

    it('throws on empty result', async () => {
      const fetchImpl = mockFetchJson({ chart: { result: [], error: null } });
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      await expect(feed.quote(AAPL)).rejects.toThrow(/empty result/);
    });

    it('throws when both the series and meta carry no price', async () => {
      const fetchImpl = mockFetchJson(buildChartResponse({ timestamps: [], closes: [] }));
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      await expect(feed.quote(AAPL)).rejects.toThrow(/no price/);
    });
  });

  describe('quoteBatch()', () => {
    it('returns quotes in request order', async () => {
      const aaplTs = 1_779_400 * 60;
      const msftTs = 1_779_400 * 60;
      const fetchImpl = vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            url.includes('AAPL')
              ? buildChartResponse({ timestamps: [aaplTs], closes: [200.0] })
              : buildChartResponse({ timestamps: [msftTs], closes: [410.0] }),
          ),
      })) as unknown as typeof fetch;

      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });
      const MSFT: Asset = { kind: 'equity', id: 'yf:MSFT', symbol: 'MSFT' };

      const quotes = await feed.quoteBatch([AAPL, MSFT]);

      expect(quotes).toHaveLength(2);
      expect(quotes[0]?.asset).toBe(AAPL);
      expect(quotes[0]?.price).toBe(200.0);
      expect(quotes[1]?.asset).toBe(MSFT);
      expect(quotes[1]?.price).toBe(410.0);
    });

    it('returns [] for empty input without calling fetch', async () => {
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });

      const quotes = await feed.quoteBatch([]);

      expect(quotes).toEqual([]);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects if any underlying quote() rejects', async () => {
      const fetchImpl = vi.fn().mockImplementation(async (url: string) =>
        url.includes('AAPL')
          ? { ok: false, status: 500, json: () => Promise.resolve({}) }
          : {
              ok: true,
              status: 200,
              json: () => Promise.resolve(buildChartResponse({ timestamps: [1], closes: [1] })),
            },
      ) as unknown as typeof fetch;

      const feed = new YfinanceQuoteFeed({ fetch: fetchImpl });
      const MSFT: Asset = { kind: 'equity', id: 'yf:MSFT', symbol: 'MSFT' };

      await expect(feed.quoteBatch([AAPL, MSFT])).rejects.toThrow(/HTTP 500/);
    });
  });
});
