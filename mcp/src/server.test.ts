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
