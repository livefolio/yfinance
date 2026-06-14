import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DateRange } from '@livefolio/sdk';
import { assetToYahooSymbol } from '@livefolio/yfinance';
import type { ServerDeps } from '../deps';
import { equityAsset } from '../deps';
import { barsToOutput, barsSummary } from '../format';
import { errorResult } from '../result';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a `YYYY-MM-DD` string as UTC midnight. Returns undefined on bad input or calendar-invalid dates. */
function parseUtcDate(s: string): Date | undefined {
  if (!DATE_RE.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  // Round-trip check: JS Date rolls over calendar-invalid days (e.g. Feb 30 → Mar 1).
  // Reject if the UTC components don't match the input components exactly.
  const [year, month, day] = s.split('-').map(Number) as [number, number, number];
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return undefined;
  return d;
}

const barRowShape = {
  t: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
};

export function registerBarsTool(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'get_daily_bars',
    {
      title: 'Get daily bars',
      description:
        'Historical daily OHLCV bars for an equity over an inclusive date range. Prices are total-return-adjusted (splits & dividends baked into OHLC; volume raw). Daily (1d) only; UTC-midnight day timestamps. Dates are "YYYY-MM-DD". Equities only.',
      inputSchema: {
        symbol: z.string(),
        from: z.string(),
        to: z.string(),
        includeIncompleteToday: z.boolean().optional(),
      },
      outputSchema: {
        symbol: z.string(),
        from: z.string(),
        to: z.string(),
        count: z.number(),
        bars: z.array(z.object(barRowShape)),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ symbol, from, to, includeIncompleteToday }) => {
      const sym = symbol.trim();
      if (sym === '') return errorResult('symbol must not be empty.');
      const fromD = parseUtcDate(from);
      const toD = parseUtcDate(to);
      if (!fromD || !toD) return errorResult('from/to must be valid dates in YYYY-MM-DD format.');
      if (fromD.getTime() > toD.getTime()) return errorResult('from must be on or before to.');
      try {
        const yahooSymbol = assetToYahooSymbol(equityAsset(sym));
        const range: DateRange = { from: fromD, to: toD };
        const bars = await deps.fetchBars(yahooSymbol, range, '1d', {
          includeIncompleteToday: includeIncompleteToday ?? false,
        });
        const out = barsToOutput(sym, from, to, bars);
        return { content: [{ type: 'text', text: barsSummary(out) }], structuredContent: out };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
