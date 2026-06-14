import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDeps } from '../deps';
import { equityAsset } from '../deps';
import { quoteToOutput, quoteSummary } from '../format';

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
}
