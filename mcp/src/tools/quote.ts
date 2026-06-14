import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDeps } from '../deps';
import { equityAsset } from '../deps';
import { quoteToOutput, quoteSummary, type QuoteOut } from '../format';

const quoteOutputShape = {
  symbol: z.string(),
  price: z.number(),
  time: z.string(),
  currency: z.string().optional(),
  bid: z.number().optional(),
  ask: z.number().optional(),
};

const errorResult = (message: string) => ({
  content: [{ type: 'text' as const, text: `Error: ${message}` }],
  isError: true,
});

export function registerQuoteTools(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'get_quote',
    {
      title: 'Get latest quote',
      description:
        'Latest price quote for a single equity from Yahoo Finance. Returns the freshest of pre-market / regular / post-market price with Yahoo\'s own timestamp. Equities only — e.g. "AAPL"; class shares like "BRK.B" are accepted.',
      inputSchema: { symbol: z.string() },
      outputSchema: quoteOutputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ symbol }) => {
      const sym = symbol.trim();
      if (sym === '') return errorResult('symbol must not be empty.');
      try {
        const q = await deps.fetchQuote(equityAsset(sym));
        const out = quoteToOutput(sym, q);
        return { content: [{ type: 'text', text: quoteSummary(out) }], structuredContent: out };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.registerTool(
    'get_quotes',
    {
      title: 'Get latest quotes (batch)',
      description:
        'Latest quotes for multiple equities in a single Yahoo round-trip. Returns one quote per input symbol, in the same order. Fails the whole call if ANY symbol is unknown (no silent omission). Equities only.',
      inputSchema: { symbols: z.array(z.string()).min(1).max(50) },
      outputSchema: { quotes: z.array(z.object(quoteOutputShape)) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ symbols }) => {
      const syms = symbols.map((s) => s.trim());
      if (syms.some((s) => s === '')) return errorResult('symbols must not be empty.');
      try {
        const quotes = await deps.fetchQuoteBatch(syms.map(equityAsset));
        const out: QuoteOut[] = quotes.map((q, i) => quoteToOutput(syms[i]!, q));
        return {
          content: [{ type: 'text', text: out.map(quoteSummary).join('\n') }],
          structuredContent: { quotes: out },
        };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
