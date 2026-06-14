# `@livefolio/yfinance-mcp` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@livefolio/yfinance-mcp` — a local stdio MCP server that exposes the `@livefolio/yfinance` adapter's read-only quote and daily-bar capabilities as three agent-callable tools (`get_quote`, `get_quotes`, `get_daily_bars`).

**Architecture:** New npm-workspace package nested under `mcp/` in the existing `yfinance/` repo, sibling to `browser/`. A `createServer(deps?)` factory builds an `McpServer` and registers three tools; the three tools call the adapter's exported functions **statelessly** (no `YfinanceDataFeed`, no cache). `deps` is a dependency-injection seam (defaulting to the real adapter exports) so tests run fully offline. `index.ts` is a thin bin entrypoint that connects a `StdioServerTransport`. All tools use MCP structured output (`outputSchema` + `structuredContent` + a text summary) and carry `readOnlyHint`/`openWorldHint` annotations.

**Tech Stack:** TypeScript ESM, `@modelcontextprotocol/sdk` (high-level `McpServer` + `registerTool`), `zod` for schemas, tsup bundler (shebang banner), Vitest (`InMemoryTransport` for in-process client/server tests). Runtime dep `@livefolio/yfinance@^0.1.1`; `@livefolio/sdk@^0.4.2` is type-only (dev).

**Spec:** `docs/specs/2026-06-14-yfinance-mcp-design.md`

**Resolved pre-work (confirmed during planning):**
- The published `@livefolio/yfinance@0.1.1` (tag `yfinance-v0.1.1`) already exports `fetchYahooBars`, `fetchYahooQuoteForAsset`, `fetchYahooQuoteBatchForAssets`, `assetToYahooSymbol`. So depending on `^0.1.1` resolves a fully-compatible adapter whether npm links the local workspace root or fetches the registry tarball. Task 0 builds the root adapter first and verifies the import, covering both resolution paths.
- The adapter is **type-only** on `@livefolio/sdk` (every SDK import is `import type`), so `@livefolio/sdk` never enters the runtime bundle — it is a dev/types-only dependency here.

---

## File Structure

```
yfinance/                                # repo root, workspace root
├── package.json                          # MODIFY: "workspaces": ["browser", "mcp"]
├── mcp/                                  # CREATE: workspace child
│   ├── package.json                      # CREATE: @livefolio/yfinance-mcp, "bin"
│   ├── tsconfig.json                     # CREATE: extends ../tsconfig.json
│   ├── tsup.config.ts                    # CREATE: esm, node20, shebang banner
│   ├── vitest.config.ts                  # CREATE
│   ├── README.md                         # CREATE: usage + client config snippet
│   └── src/
│       ├── index.ts                      # CREATE: bin entrypoint (stdio transport)
│       ├── deps.ts                       # CREATE: ServerDeps type, defaultDeps, equityAsset
│       ├── server.ts                     # CREATE: createServer(deps?)
│       ├── format.ts                     # CREATE: pure output shapers
│       ├── format.test.ts                # CREATE
│       ├── tools/
│       │   ├── quote.ts                  # CREATE: registerQuoteTools (get_quote + get_quotes)
│       │   └── bars.ts                   # CREATE: registerBarsTool (get_daily_bars)
│       └── server.test.ts                # CREATE: in-memory client/server integration tests
└── docs/
    ├── specs/2026-06-14-yfinance-mcp-design.md   # exists
    └── plans/2026-06-14-yfinance-mcp.md           # this file
```

One responsibility per file:
- `deps.ts` — the injectable `ServerDeps` contract, its real-adapter default, and the `equityAsset` helper (a leaf module so `server.ts` and both tool files import it without a cycle).
- `format.ts` — pure `Quote`/`Bar[]` → output-shape + summary-text functions (no I/O, no throws).
- `tools/quote.ts` / `tools/bars.ts` — register tools on a passed `McpServer`, closing over injected `deps`.
- `server.ts` — `createServer(deps?)` wires the `McpServer` and calls the register functions.
- `index.ts` — the only file that touches process I/O: connect stdio, install stderr crash handlers.

Module graph is acyclic: `deps.ts` and `format.ts` are leaves → `tools/*` → `server.ts` → `index.ts`.

---

## Task 0: Workspace shell

**Goal:** Make `mcp/` a published-but-empty workspace package whose toolchain (TS, tsup, Vitest, ESLint) is wired to the repo root, and confirm the `@livefolio/yfinance` adapter import resolves with the exports we need.

**Files:**
- Modify: `package.json` (root)
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/tsup.config.ts`
- Create: `mcp/vitest.config.ts`
- Create: `mcp/README.md`
- Create: `mcp/src/index.ts` (placeholder so build/test don't fail; replaced in Task 5)

**Acceptance Criteria:**
- [ ] `npm install` from repo root succeeds and creates a `node_modules/@livefolio/yfinance-mcp` symlink
- [ ] The adapter import check prints `adapter OK` (all four functions are present)
- [ ] `npm run build --workspace @livefolio/yfinance-mcp` produces `mcp/dist/index.js` with a `#!/usr/bin/env node` first line
- [ ] `npm test --workspace @livefolio/yfinance-mcp` exits 0 (no tests yet, via `passWithNoTests`)
- [ ] Existing root `npm test` still passes (no regression on `@livefolio/yfinance`)

**Verify:**
```bash
npm install && \
npm run build --workspace @livefolio/yfinance && \
node --input-type=module -e "import('@livefolio/yfinance').then(m=>{const miss=['fetchYahooBars','fetchYahooQuoteForAsset','fetchYahooQuoteBatchForAssets','assetToYahooSymbol'].filter(k=>typeof m[k]!=='function'); if(miss.length){console.error('MISSING',miss);process.exit(1);} console.log('adapter OK');})" && \
npm run build --workspace @livefolio/yfinance-mcp && \
head -1 mcp/dist/index.js && \
npm test --workspace @livefolio/yfinance-mcp && \
npm test
```
Expected: `adapter OK`, the `head -1` prints `#!/usr/bin/env node`, all commands exit 0.

**Steps:**

- [ ] **Step 1: Add `mcp` to the root workspaces array**

Edit `package.json` at the repo root. Change the existing `workspaces` line:

```json
  "workspaces": [
    "browser"
  ],
```

to:

```json
  "workspaces": [
    "browser",
    "mcp"
  ],
```

- [ ] **Step 2: Create `mcp/package.json`**

```json
{
  "name": "@livefolio/yfinance-mcp",
  "version": "0.1.0",
  "description": "Local stdio MCP server exposing @livefolio/yfinance quotes and daily bars as read-only tools.",
  "type": "module",
  "bin": {
    "yfinance-mcp": "./dist/index.js"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "keywords": [
    "yahoo-finance",
    "mcp",
    "model-context-protocol",
    "quotes",
    "ohlcv",
    "livefolio"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/livefolio/yfinance.git",
    "directory": "mcp"
  },
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsup",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write 'src/**/*.ts'",
    "format:check": "prettier --check 'src/**/*.ts'",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@livefolio/yfinance": "^0.1.1",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@livefolio/sdk": "^0.4.2"
  }
}
```

Notes: tsup / Vitest / TypeScript / ESLint / Prettier / `@types/node` are inherited from the root devDependencies via workspace hoisting (same as `browser/`). After `npm install`, if npm resolves `@modelcontextprotocol/sdk` or `zod` to newer ranges, accept whatever it writes — the import paths used in later tasks (`server/mcp.js`, `server/stdio.js`, `client/index.js`, `inMemory.js`) and `registerTool`/`outputSchema`/`annotations` are stable across current 1.x. If a path differs in the installed version, adjust the import to match.

- [ ] **Step 3: Create `mcp/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "outDir": "./dist"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create `mcp/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  external: ['@livefolio/sdk', '@livefolio/yfinance', '@modelcontextprotocol/sdk', 'zod', 'yahoo-finance2'],
});
```

- [ ] **Step 5: Create `mcp/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
```

- [ ] **Step 6: Create `mcp/README.md`** (stub; expanded in Task 5)

```markdown
# @livefolio/yfinance-mcp

Local stdio [Model Context Protocol](https://modelcontextprotocol.io) server exposing
[`@livefolio/yfinance`](https://github.com/livefolio/yfinance) read-only Yahoo Finance
data — latest quotes and historical daily bars — as agent-callable tools.

> Status: scaffolding. Tools land in subsequent tasks.
```

- [ ] **Step 7: Create placeholder `mcp/src/index.ts`** (replaced in Task 5)

```ts
// Placeholder entrypoint — the real stdio server is wired in Task 5.
process.stderr.write('yfinance-mcp: not yet implemented\n');
```

- [ ] **Step 8: Install, build adapter + package, run verification**

Run the full **Verify** block above. All commands must exit 0; `head -1 mcp/dist/index.js` must print `#!/usr/bin/env node`; the adapter check must print `adapter OK`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json mcp/
git commit -m "chore(mcp): scaffold @livefolio/yfinance-mcp workspace package"
```

---

## Task 1: `format.ts` — pure output shapers

**Goal:** Pure functions that turn an adapter `Quote` / `Bar[]` into the structured output shapes and human summary strings the tools return. No MCP, no adapter, no I/O — the easiest unit to TDD first.

**Files:**
- Create: `mcp/src/format.ts`
- Test: `mcp/src/format.test.ts`

**Acceptance Criteria:**
- [ ] `quoteToOutput` maps required fields and includes `currency`/`bid`/`ask` only when present
- [ ] `barsToOutput` maps `Bar` → compact `{ t, o, h, l, c, v }` rows with `t` as `YYYY-MM-DD`, and sets `count`
- [ ] `barsSummary` produces a first→last summary, and a distinct "no bars" message when empty
- [ ] `npm test --workspace @livefolio/yfinance-mcp` passes

**Verify:** `npm test --workspace @livefolio/yfinance-mcp` → all format tests green.

**Steps:**

- [ ] **Step 1: Write the failing tests** — create `mcp/src/format.test.ts`

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace @livefolio/yfinance-mcp`
Expected: FAIL — `format.ts` does not exist / exports undefined.

- [ ] **Step 3: Write `mcp/src/format.ts`**

```ts
import type { Bar, Quote } from '@livefolio/sdk';

export type QuoteOut = {
  symbol: string;
  price: number;
  time: string;
  currency?: string;
  bid?: number;
  ask?: number;
};

export type BarRow = { t: string; o: number; h: number; l: number; c: number; v: number };

export type BarsOut = {
  symbol: string;
  from: string;
  to: string;
  count: number;
  bars: BarRow[];
};

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Shape an adapter `Quote` into the tool's structured output. `symbol` is the
 *  caller-supplied ticker, echoed verbatim. */
export function quoteToOutput(symbol: string, q: Quote): QuoteOut {
  const out: QuoteOut = { symbol, price: q.price, time: q.t.toISOString() };
  if (q.currency != null) out.currency = q.currency;
  if (q.bid != null) out.bid = q.bid;
  if (q.ask != null) out.ask = q.ask;
  return out;
}

export function quoteSummary(q: QuoteOut): string {
  const cur = q.currency != null ? ` ${q.currency}` : '';
  return `${q.symbol}: ${q.price}${cur} (as of ${q.time})`;
}

/** Shape adapter `Bar[]` into compact rows. `t` is the UTC-midnight day as `YYYY-MM-DD`. */
export function barsToOutput(symbol: string, from: string, to: string, bars: ReadonlyArray<Bar>): BarsOut {
  return {
    symbol,
    from,
    to,
    count: bars.length,
    bars: bars.map((b) => ({ t: isoDay(b.t), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume })),
  };
}

export function barsSummary(out: BarsOut): string {
  if (out.count === 0) {
    return `${out.symbol} — no bars in range ${out.from} → ${out.to}.`;
  }
  const first = out.bars[0]!;
  const last = out.bars[out.count - 1]!;
  return `${out.symbol} — ${out.count} daily bars, ${first.t} → ${last.t}. Last close ${last.c}.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace @livefolio/yfinance-mcp`
Expected: PASS — all `format` tests green.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/format.ts mcp/src/format.test.ts
git commit -m "feat(mcp): add pure quote/bars output shapers"
```

---

## Task 2: Server harness + `get_quote`

**Goal:** Stand up `createServer(deps?)` with the injectable `ServerDeps` seam and register the first tool, `get_quote`. Prove the whole request→response path with in-process `InMemoryTransport` tests, including tool discovery with read-only annotations.

**Files:**
- Create: `mcp/src/deps.ts`
- Create: `mcp/src/server.ts`
- Create: `mcp/src/tools/quote.ts`
- Test: `mcp/src/server.test.ts`

**Acceptance Criteria:**
- [ ] `listTools` returns `get_quote` with `annotations.readOnlyHint === true` and `openWorldHint === true`
- [ ] `get_quote` returns `structuredContent` matching the `QuoteOut` shape plus a summary text block
- [ ] The injected `fetchQuote` is called with an equity `Asset` carrying the caller's symbol verbatim
- [ ] An adapter throw becomes an `isError: true` tool result (server stays up)
- [ ] `npm test --workspace @livefolio/yfinance-mcp` passes

**Verify:** `npm test --workspace @livefolio/yfinance-mcp` → green.

**Steps:**

- [ ] **Step 1: Write `mcp/src/deps.ts`** (the DI contract + real defaults + asset helper)

```ts
import type { Asset, Bar, DateRange, Frequency, Quote } from '@livefolio/sdk';
import {
  fetchYahooQuoteForAsset,
  fetchYahooQuoteBatchForAssets,
  fetchYahooBars,
} from '@livefolio/yfinance';

/** The adapter surface the tools depend on. Injectable so tests run offline. */
export type ServerDeps = {
  fetchQuote: (asset: Asset) => Promise<Quote>;
  fetchQuoteBatch: (assets: ReadonlyArray<Asset>) => Promise<ReadonlyArray<Quote>>;
  fetchBars: (
    symbol: string,
    range: DateRange,
    freq: Frequency,
    opts: { includeIncompleteToday: boolean },
  ) => Promise<Bar[]>;
};

/** Real adapter exports (stateless — no YfinanceDataFeed, no cache; see spec D1). */
export const defaultDeps: ServerDeps = {
  fetchQuote: fetchYahooQuoteForAsset,
  fetchQuoteBatch: fetchYahooQuoteBatchForAssets,
  fetchBars: (symbol, range, freq, opts) => fetchYahooBars(symbol, range, freq, opts),
};

/** Build a v0.4 equity `Asset` from a ticker. Symbol normalization (e.g. `.`→`-`)
 *  is the adapter's job via `assetToYahooSymbol`. */
export const equityAsset = (symbol: string): Asset => ({ kind: 'equity', id: `yf:${symbol}`, symbol });
```

- [ ] **Step 2: Write `mcp/src/tools/quote.ts`** (only `get_quote` in this task; `get_quotes` added in Task 3)

```ts
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
```

- [ ] **Step 3: Write `mcp/src/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defaultDeps, type ServerDeps } from './deps';
import { registerQuoteTools } from './tools/quote';

export type { ServerDeps } from './deps';

export const SERVER_NAME = 'yfinance';
export const SERVER_VERSION = '0.1.0';

/** Build the MCP server with all tools registered. `deps` defaults to the real
 *  adapter exports; tests inject stubs for offline runs. Does not connect a
 *  transport — the caller does that. */
export function createServer(deps: ServerDeps = defaultDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerQuoteTools(server, deps);
  return server;
}
```

- [ ] **Step 4: Write the failing tests** — create `mcp/src/server.test.ts`

```ts
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
const textOf = (res: { content?: unknown }): string => (res.content as Array<{ text: string }>)[0]!.text;

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
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm test --workspace @livefolio/yfinance-mcp`
Expected: FAIL — `server.ts` / `tools/quote.ts` not yet importable, or assertions unmet. (If they already exist from prior steps, the failure is a real assertion failure to drive the implementation.)

> Note: Steps 1–3 already wrote the implementation. TDD ordering here is "test fails → implementation makes it pass"; since the implementation files are small and interdependent (the server can't be tested without them), write them first, then confirm the tests in Step 4 drive any remaining fixes. If you prefer strict red-first, stub `createServer` to `throw new Error('not implemented')` before Step 4 and watch it fail.

- [ ] **Step 6: Make tests pass**

Run: `npm test --workspace @livefolio/yfinance-mcp`
Expected: PASS. Fix any mismatch (import paths against the installed `@modelcontextprotocol/sdk`, result shape) until green.

- [ ] **Step 7: Commit**

```bash
git add mcp/src/deps.ts mcp/src/server.ts mcp/src/tools/quote.ts mcp/src/server.test.ts
git commit -m "feat(mcp): add createServer harness and get_quote tool"
```

---

## Task 3: `get_quotes` (batch)

**Goal:** Add the batch quote tool to `tools/quote.ts`, registered alongside `get_quote`. One Yahoo round-trip; output preserves input order; any unknown symbol fails the whole call (adapter contract).

**Files:**
- Modify: `mcp/src/tools/quote.ts`
- Test: `mcp/src/server.test.ts` (add a `get_quotes` describe block)

**Acceptance Criteria:**
- [ ] `listTools` now returns `get_quotes` with read-only/open-world annotations
- [ ] `get_quotes` returns `{ quotes: [...] }` in the same order as the input symbols
- [ ] The injected `fetchQuoteBatch` receives equity assets in input order
- [ ] An adapter throw (any unknown symbol) yields `isError: true`
- [ ] An empty symbol in the array is rejected before any adapter call
- [ ] `npm test --workspace @livefolio/yfinance-mcp` passes

**Verify:** `npm test --workspace @livefolio/yfinance-mcp` → green.

**Steps:**

- [ ] **Step 1: Add `get_quotes` tests** — append to `mcp/src/server.test.ts`

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace @livefolio/yfinance-mcp`
Expected: FAIL — `get_quotes` is not registered yet.

- [ ] **Step 3: Add `get_quotes` to `mcp/src/tools/quote.ts`**

Add the import of `QuoteOut` to the existing format import line:

```ts
import { quoteToOutput, quoteSummary, type QuoteOut } from '../format';
```

Then, inside `registerQuoteTools`, after the existing `get_quote` registration, add:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace @livefolio/yfinance-mcp`
Expected: PASS — all quote tests (single + batch) green.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/tools/quote.ts mcp/src/server.test.ts
git commit -m "feat(mcp): add get_quotes batch tool"
```

---

## Task 4: `get_daily_bars`

**Goal:** Add the historical daily-bars tool with `YYYY-MM-DD` date parsing/validation, symbol normalization via `assetToYahooSymbol`, and the `includeIncompleteToday` passthrough. Empty range is a valid (non-error) result.

**Files:**
- Create: `mcp/src/tools/bars.ts`
- Modify: `mcp/src/server.ts` (register the bars tool)
- Test: `mcp/src/server.test.ts` (add a `get_daily_bars` describe block)

**Acceptance Criteria:**
- [ ] `listTools` returns `get_daily_bars` with read-only/open-world annotations
- [ ] Success maps `Bar[]` → compact rows with `count` and echoes `from`/`to`
- [ ] The symbol is normalized (`BRK.B` → `BRK-B`) before `fetchBars` is called
- [ ] `includeIncompleteToday` defaults to `false` and is forwarded when `true`
- [ ] Malformed dates and `from > to` return `isError: true` without calling the adapter
- [ ] Empty range returns `count: 0`, not an error
- [ ] `npm test --workspace @livefolio/yfinance-mcp` passes

**Verify:** `npm test --workspace @livefolio/yfinance-mcp` → green.

**Steps:**

- [ ] **Step 1: Add `get_daily_bars` tests** — append to `mcp/src/server.test.ts`

```ts
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
    const fetchBars = vi.fn(async (): Promise<Bar[]> => [
      { t: utc('2024-01-02'), open: 10, high: 12, low: 9, close: 11, volume: 1000 },
      { t: utc('2024-01-03'), open: 11, high: 13, low: 10, close: 12.5, volume: 1100 },
    ]);
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
    const fetchBars = vi.fn(async (): Promise<Bar[]> => []);
    const client = await connect(makeDeps({ fetchBars }));
    await client.callTool({ name: 'get_daily_bars', arguments: argsOf({ symbol: 'BRK.B' }) });
    expect(fetchBars.mock.calls[0]![0]).toBe('BRK-B');
  });

  it('forwards includeIncompleteToday (default false, then true)', async () => {
    const fetchBars = vi.fn(async (): Promise<Bar[]> => []);
    const client = await connect(makeDeps({ fetchBars }));
    await client.callTool({ name: 'get_daily_bars', arguments: argsOf() });
    expect(fetchBars.mock.calls[0]![3]).toEqual({ includeIncompleteToday: false });
    await client.callTool({ name: 'get_daily_bars', arguments: argsOf({ includeIncompleteToday: true }) });
    expect(fetchBars.mock.calls[1]![3]).toEqual({ includeIncompleteToday: true });
  });

  it('passes a UTC-midnight DateRange to the adapter', async () => {
    const fetchBars = vi.fn(async (): Promise<Bar[]> => []);
    const client = await connect(makeDeps({ fetchBars }));
    await client.callTool({ name: 'get_daily_bars', arguments: argsOf() });
    const range = fetchBars.mock.calls[0]![1] as { from: Date; to: Date };
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace @livefolio/yfinance-mcp`
Expected: FAIL — `get_daily_bars` not registered.

- [ ] **Step 3: Write `mcp/src/tools/bars.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DateRange } from '@livefolio/sdk';
import { assetToYahooSymbol } from '@livefolio/yfinance';
import type { ServerDeps } from '../deps';
import { equityAsset } from '../deps';
import { barsToOutput, barsSummary } from '../format';

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

const errorResult = (message: string) => ({
  content: [{ type: 'text' as const, text: `Error: ${message}` }],
  isError: true,
});

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
```

- [ ] **Step 4: Register the bars tool in `mcp/src/server.ts`**

Add the import near the existing tool import:

```ts
import { registerBarsTool } from './tools/bars';
```

And call it inside `createServer`, after `registerQuoteTools`:

```ts
  registerQuoteTools(server, deps);
  registerBarsTool(server, deps);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace @livefolio/yfinance-mcp`
Expected: PASS — all three tools' tests green.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/tools/bars.ts mcp/src/server.ts mcp/src/server.test.ts
git commit -m "feat(mcp): add get_daily_bars tool with date validation"
```

---

## Task 5: Bin entrypoint, smoke test, and README

**Goal:** Replace the placeholder `index.ts` with the real stdio entrypoint (transport + stderr-only crash handlers), prove the built binary speaks MCP over stdio with a black-box smoke test, and write the user-facing README with a client-registration snippet.

**Files:**
- Modify: `mcp/src/index.ts`
- Modify: `mcp/README.md`
- Test: `mcp/src/smoke.test.ts` (spawns the built bin, drives one JSON-RPC round-trip)

**Acceptance Criteria:**
- [ ] `index.ts` connects a `StdioServerTransport` and never writes to stdout except via the transport
- [ ] `unhandledRejection` / `uncaughtException` log to stderr and exit non-zero
- [ ] The smoke test: spawn `node mcp/dist/index.js`, send `initialize` + `tools/list`, and assert the three tool names come back over stdout
- [ ] `npm run build --workspace @livefolio/yfinance-mcp && npm test --workspace @livefolio/yfinance-mcp` both pass
- [ ] README documents the three tools and shows a `claude mcp add` invocation

**Verify:**
```bash
npm run build --workspace @livefolio/yfinance-mcp && \
npm test --workspace @livefolio/yfinance-mcp && \
npm test
```
Expected: build emits `mcp/dist/index.js` (shebang first line), all tests (incl. the smoke test) pass, root suite unaffected.

**Steps:**

- [ ] **Step 1: Replace `mcp/src/index.ts` with the real entrypoint**

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';

// stdout is the JSON-RPC channel for the stdio transport — log only to stderr.
const logErr = (msg: string): void => {
  process.stderr.write(`yfinance-mcp: ${msg}\n`);
};

process.on('unhandledRejection', (reason) => {
  logErr(`unhandledRejection: ${String(reason)}`);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logErr(`uncaughtException: ${(err as Error).message}`);
  process.exit(1);
});

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logErr('server connected over stdio');
}

main().catch((err) => {
  logErr(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Write the failing smoke test** — create `mcp/src/smoke.test.ts`

This is a black-box test of the *built* binary. It writes newline-delimited JSON-RPC to the child's stdin and reads framed responses from stdout. It requires `mcp/dist/index.js` to exist (the Verify block builds first).

```ts
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../dist/index.js', import.meta.url));

type Rpc = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: unknown };

/** Drive the bin over stdio: send the requests, resolve when a response with
 *  `id === stopAtId` arrives. Parses newline-delimited JSON from stdout. */
async function driveBin(requests: Rpc[], stopAtId: number): Promise<Rpc[]> {
  const child = spawn('node', [BIN], { stdio: ['pipe', 'pipe', 'pipe'] });
  const responses: Rpc[] = [];
  let buf = '';
  const done = new Promise<void>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === '') continue;
        const msg = JSON.parse(line) as Rpc;
        responses.push(msg);
        if (msg.id === stopAtId) resolve();
      }
    });
  });
  for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
  await Promise.race([done, once(child, 'exit').then(() => undefined)]);
  child.kill();
  return responses;
}

describe('bin smoke test', () => {
  it('responds to initialize and lists the three tools over stdio', async () => {
    const responses = await driveBin(
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'smoke', version: '0.0.0' },
          },
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ],
      2,
    );
    const list = responses.find((r) => r.id === 2);
    expect(list).toBeDefined();
    const names = ((list!.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name).sort();
    expect(names).toEqual(['get_daily_bars', 'get_quote', 'get_quotes']);
  }, 20000);
});
```

- [ ] **Step 3: Build, then run tests to verify the smoke test passes**

Run:
```bash
npm run build --workspace @livefolio/yfinance-mcp && npm test --workspace @livefolio/yfinance-mcp
```
Expected: build succeeds; the smoke test plus all unit/integration tests pass. If the smoke test times out, confirm `index.ts` connects the transport before any stdout write and that logging uses `process.stderr`.

> If `vitest` runs before a build exists in a fresh checkout, the smoke test fails on a missing `dist/index.js`. That's expected — the Verify block (and CI) always build first. The unit/integration tests in `server.test.ts` do not depend on `dist/`.

- [ ] **Step 4: Expand `mcp/README.md`**

```markdown
# @livefolio/yfinance-mcp

Local stdio [Model Context Protocol](https://modelcontextprotocol.io) server exposing
[`@livefolio/yfinance`](https://github.com/livefolio/yfinance) read-only Yahoo Finance
data — latest quotes and historical daily bars — as agent-callable tools.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `get_quote` | `symbol` | Latest quote (freshest of pre/regular/post-market): `price`, `time`, optional `currency`/`bid`/`ask`. |
| `get_quotes` | `symbols[]` (1–50) | One quote per symbol, in input order, in a single round-trip. Fails if any symbol is unknown. |
| `get_daily_bars` | `symbol`, `from`, `to` (`YYYY-MM-DD`), optional `includeIncompleteToday` | Total-return-adjusted daily OHLCV bars (UTC-midnight days). `1d` only. |

All three are **read-only** (`readOnlyHint: true`) and reach an external service (`openWorldHint: true`).
Equities only. Bars are total-return-adjusted (splits/dividends baked into OHLC; volume raw),
which is correct for analysis/backtests — not for live order placement.

## Install / run

```sh
npx @livefolio/yfinance-mcp
```

The process speaks MCP over stdio; spawn it from an MCP client.

### Claude Code

```sh
claude mcp add yfinance -- npx -y @livefolio/yfinance-mcp
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "yfinance": {
      "command": "npx",
      "args": ["-y", "@livefolio/yfinance-mcp"]
    }
  }
}
```

## License

MIT
```

- [ ] **Step 5: Run the full Verify block and commit**

```bash
npm run build --workspace @livefolio/yfinance-mcp && \
npm test --workspace @livefolio/yfinance-mcp && \
npm test
```
Then:
```bash
git add mcp/src/index.ts mcp/src/smoke.test.ts mcp/README.md
git commit -m "feat(mcp): wire stdio bin entrypoint, smoke test, and README"
```

---

## Out of scope (do NOT build)

- HTTP/SSE transport, derived/computed tools, symbol search, non-equity assets, non-`1d` frequencies, streaming, caching, auth/rate-limiting (see spec Non-goals).
- Release-CI wiring for publishing `@livefolio/yfinance-mcp` — tracked as a follow-up in the spec; not part of this plan.

## Notes for the implementer

- **MCP SDK version drift:** the import specifiers (`@modelcontextprotocol/sdk/server/mcp.js`, `.../server/stdio.js`, `.../client/index.js`, `.../inMemory.js`) and the `registerTool(name, { title, description, inputSchema, outputSchema, annotations }, handler)` signature are current 1.x. If `npm install` resolves a version where a path or signature differs, adjust imports to match the installed package — the structure of the plan is unaffected.
- **`inputSchema`/`outputSchema` are ZodRawShape** (plain objects of zod types), not `z.object(...)`. The SDK wraps them and infers the handler argument types.
- **Error results skip `outputSchema` validation** — returning `{ content, isError: true }` without `structuredContent` is valid even though the tool declares an `outputSchema`.
- **Never write to stdout** outside the transport; all diagnostics go to stderr (D6).
```
