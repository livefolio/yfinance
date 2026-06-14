import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Asset, Bar, Quote } from '@livefolio/sdk';
import { createServer, type ServerDeps } from './server';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeDeps(over: Partial<ServerDeps> = {}): ServerDeps {
  return {
    fetchQuote: vi.fn(async (a: Asset): Promise<Quote> => ({ asset: a, t: utc('2026-06-13'), price: 100 })),
    fetchQuoteBatch: vi.fn(
      async (assets: ReadonlyArray<Asset>): Promise<Quote[]> =>
        assets.map((a, i) => ({ asset: a, t: utc('2026-06-13'), price: 100 + i })),
    ),
    fetchBars: vi.fn(async (): Promise<Bar[]> => []),
    ...over,
  };
}

async function connect(deps: ServerDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(deps).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

// Narrow the loosely-typed CallTool result for assertions.
// The SDK 1.29 callTool return is a union; cast through unknown to extract the text content.
const textOf = (res: unknown): string => (res as { content: Array<{ text: string }> }).content[0]!.text;

describe('tool discovery', () => {
  it('exposes get_quote as a read-only, open-world tool', async () => {
    const client = await connect(makeDeps());
    const { tools } = await client.listTools();
    const quote = tools.find((t) => t.name === 'get_quote');
    expect(quote).toBeDefined();
    expect(quote!.annotations?.readOnlyHint).toBe(true);
    expect(quote!.annotations?.openWorldHint).toBe(true);
  });
});

describe('get_quote', () => {
  it('returns structured content and a summary text', async () => {
    const fetchQuote = vi.fn(
      async (a: Asset): Promise<Quote> => ({ asset: a, t: utc('2026-06-13'), price: 201.45, currency: 'USD' }),
    );
    const client = await connect(makeDeps({ fetchQuote }));
    const res = await client.callTool({ name: 'get_quote', arguments: { symbol: 'AAPL' } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ symbol: 'AAPL', price: 201.45, currency: 'USD' });
    expect(textOf(res)).toContain('AAPL: 201.45 USD');
  });

  it('passes the caller symbol verbatim on an equity asset', async () => {
    const fetchQuote = vi.fn(async (a: Asset): Promise<Quote> => ({ asset: a, t: utc('2026-06-13'), price: 1 }));
    const client = await connect(makeDeps({ fetchQuote }));
    await client.callTool({ name: 'get_quote', arguments: { symbol: 'BRK.B' } });
    expect(fetchQuote).toHaveBeenCalledWith({ kind: 'equity', id: 'yf:BRK.B', symbol: 'BRK.B' });
  });

  it('rejects an empty symbol without calling the adapter', async () => {
    const fetchQuote = vi.fn(async (a: Asset): Promise<Quote> => ({ asset: a, t: utc('2026-06-13'), price: 1 }));
    const client = await connect(makeDeps({ fetchQuote }));
    const res = await client.callTool({ name: 'get_quote', arguments: { symbol: '   ' } });
    expect(res.isError).toBe(true);
    expect(fetchQuote).not.toHaveBeenCalled();
  });

  it('surfaces adapter errors as tool errors', async () => {
    const fetchQuote = vi.fn(async (): Promise<Quote> => {
      throw new Error('yfinance: no quote returned for ZZZZ');
    });
    const client = await connect(makeDeps({ fetchQuote }));
    const res = await client.callTool({ name: 'get_quote', arguments: { symbol: 'ZZZZ' } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('no quote returned for ZZZZ');
  });
});

describe('get_quotes', () => {
  it('is listed as a read-only tool', async () => {
    const client = await connect(makeDeps());
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === 'get_quotes');
    expect(t).toBeDefined();
    expect(t!.annotations?.readOnlyHint).toBe(true);
    expect(t!.annotations?.openWorldHint).toBe(true);
  });

  it('preserves input order', async () => {
    const client = await connect(makeDeps());
    const res = await client.callTool({ name: 'get_quotes', arguments: { symbols: ['SPY', 'QQQ'] } });
    expect(res.isError).toBeFalsy();
    const quotes = (res.structuredContent as { quotes: Array<{ symbol: string; price: number }> }).quotes;
    expect(quotes.map((q) => q.symbol)).toEqual(['SPY', 'QQQ']);
    expect(quotes.map((q) => q.price)).toEqual([100, 101]);
  });

  it('passes equity assets in order to the batch fetcher', async () => {
    const fetchQuoteBatch = vi.fn(
      async (assets: ReadonlyArray<Asset>): Promise<Quote[]> =>
        assets.map((a) => ({ asset: a, t: utc('2026-06-13'), price: 1 })),
    );
    const client = await connect(makeDeps({ fetchQuoteBatch }));
    await client.callTool({ name: 'get_quotes', arguments: { symbols: ['SPY', 'QQQ'] } });
    expect(fetchQuoteBatch).toHaveBeenCalledWith([
      { kind: 'equity', id: 'yf:SPY', symbol: 'SPY' },
      { kind: 'equity', id: 'yf:QQQ', symbol: 'QQQ' },
    ]);
  });

  it('fails the whole call if the adapter throws on any symbol', async () => {
    const fetchQuoteBatch = vi.fn(async (): Promise<Quote[]> => {
      throw new Error('yfinance: no quote returned for ZZZZ');
    });
    const client = await connect(makeDeps({ fetchQuoteBatch }));
    const res = await client.callTool({ name: 'get_quotes', arguments: { symbols: ['SPY', 'ZZZZ'] } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('no quote returned for ZZZZ');
  });

  it('rejects a blank symbol in the array before any adapter call', async () => {
    const fetchQuoteBatch = vi.fn(async (): Promise<Quote[]> => []);
    const client = await connect(makeDeps({ fetchQuoteBatch }));
    const res = await client.callTool({ name: 'get_quotes', arguments: { symbols: ['SPY', '  '] } });
    expect(res.isError).toBe(true);
    expect(fetchQuoteBatch).not.toHaveBeenCalled();
  });
});

describe('get_daily_bars', () => {
  const argsOf = (over: Record<string, unknown> = {}) => ({
    symbol: 'AAPL',
    from: '2024-01-01',
    to: '2024-01-31',
    ...over,
  });

  it('is listed as a read-only tool', async () => {
    const client = await connect(makeDeps());
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === 'get_daily_bars');
    expect(t).toBeDefined();
    expect(t!.annotations?.readOnlyHint).toBe(true);
    expect(t!.annotations?.openWorldHint).toBe(true);
  });

  it('maps bars to compact rows with count and range echo', async () => {
    const fetchBars = vi.fn(
      async (): Promise<Bar[]> => [
        { t: utc('2024-01-02'), open: 10, high: 12, low: 9, close: 11, volume: 1000 },
        { t: utc('2024-01-03'), open: 11, high: 13, low: 10, close: 12.5, volume: 1100 },
      ],
    );
    const client = await connect(makeDeps({ fetchBars }));
    const res = await client.callTool({ name: 'get_daily_bars', arguments: argsOf() });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      count: number;
      from: string;
      to: string;
      bars: Array<Record<string, number | string>>;
    };
    expect(sc.count).toBe(2);
    expect(sc.from).toBe('2024-01-01');
    expect(sc.to).toBe('2024-01-31');
    expect(sc.bars[0]).toEqual({ t: '2024-01-02', o: 10, h: 12, l: 9, c: 11, v: 1000 });
    expect(textOf(res)).toContain('2 daily bars');
  });

  it('normalizes the symbol before fetching (BRK.B → BRK-B)', async () => {
    const fetchBars: ServerDeps['fetchBars'] = vi.fn(async () => []);
    const client = await connect(makeDeps({ fetchBars }));
    await client.callTool({ name: 'get_daily_bars', arguments: argsOf({ symbol: 'BRK.B' }) });
    expect((fetchBars as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('BRK-B');
  });

  it('forwards includeIncompleteToday (default false, then true)', async () => {
    const fetchBars: ServerDeps['fetchBars'] = vi.fn(async () => []);
    const client = await connect(makeDeps({ fetchBars }));
    await client.callTool({ name: 'get_daily_bars', arguments: argsOf() });
    expect((fetchBars as ReturnType<typeof vi.fn>).mock.calls[0]![3]).toEqual({ includeIncompleteToday: false });
    await client.callTool({ name: 'get_daily_bars', arguments: argsOf({ includeIncompleteToday: true }) });
    expect((fetchBars as ReturnType<typeof vi.fn>).mock.calls[1]![3]).toEqual({ includeIncompleteToday: true });
  });

  it('passes a UTC-midnight DateRange to the adapter', async () => {
    const fetchBars: ServerDeps['fetchBars'] = vi.fn(async () => []);
    const client = await connect(makeDeps({ fetchBars }));
    await client.callTool({ name: 'get_daily_bars', arguments: argsOf() });
    const range = (fetchBars as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { from: Date; to: Date };
    expect(range.from.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2024-01-31T00:00:00.000Z');
  });

  it('rejects from > to without calling the adapter', async () => {
    const fetchBars = vi.fn(async (): Promise<Bar[]> => []);
    const client = await connect(makeDeps({ fetchBars }));
    const res = await client.callTool({
      name: 'get_daily_bars',
      arguments: argsOf({ from: '2024-02-01', to: '2024-01-01' }),
    });
    expect(res.isError).toBe(true);
    expect(fetchBars).not.toHaveBeenCalled();
  });

  it('rejects malformed dates without calling the adapter', async () => {
    const fetchBars = vi.fn(async (): Promise<Bar[]> => []);
    const client = await connect(makeDeps({ fetchBars }));
    const res = await client.callTool({ name: 'get_daily_bars', arguments: argsOf({ from: 'nope' }) });
    expect(res.isError).toBe(true);
    expect(fetchBars).not.toHaveBeenCalled();
  });

  it('rejects calendar-invalid from date (Feb 30) without calling the adapter', async () => {
    const fetchBars = vi.fn(async (): Promise<Bar[]> => []);
    const client = await connect(makeDeps({ fetchBars }));
    const res = await client.callTool({
      name: 'get_daily_bars',
      arguments: argsOf({ from: '2024-02-30', to: '2024-03-31' }),
    });
    expect(res.isError).toBe(true);
    expect(fetchBars).not.toHaveBeenCalled();
  });

  it('rejects calendar-invalid to date (Apr 31) without calling the adapter', async () => {
    const fetchBars = vi.fn(async (): Promise<Bar[]> => []);
    const client = await connect(makeDeps({ fetchBars }));
    const res = await client.callTool({
      name: 'get_daily_bars',
      arguments: argsOf({ from: '2024-04-01', to: '2024-04-31' }),
    });
    expect(res.isError).toBe(true);
    expect(fetchBars).not.toHaveBeenCalled();
  });

  it('treats an empty range as a normal (non-error) result', async () => {
    const client = await connect(makeDeps({ fetchBars: vi.fn(async (): Promise<Bar[]> => []) }));
    const res = await client.callTool({
      name: 'get_daily_bars',
      arguments: argsOf({ from: '2024-01-01', to: '2024-01-01' }),
    });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { count: number }).count).toBe(0);
    expect(textOf(res)).toContain('no bars');
  });
});
