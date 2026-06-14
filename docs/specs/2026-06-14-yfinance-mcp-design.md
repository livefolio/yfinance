# `@livefolio/yfinance-mcp` Design

**Status:** Draft
**Date:** 2026-06-14
**Owns:** A local, stdio Model Context Protocol (MCP) server that exposes the `@livefolio/yfinance` adapter's read-only Yahoo Finance capabilities — latest quotes and historical daily bars — as agent-callable tools. Published from the `yfinance/` repo as a workspace package alongside `@livefolio/yfinance` (Node adapter) and `@livefolio/yfinance-browser` (streaming).

## Goal

Let an MCP-capable agent (Claude Desktop, Claude Code, Cursor, …) look up Yahoo Finance data conversationally by spawning a single local binary over stdio. Three tools — `get_quote`, `get_quotes`, `get_daily_bars` — map one-to-one onto the adapter's existing quote and bar surface. The server is a thin, faithful, **read-only** wrapper: it adds an MCP protocol layer and nothing else. It calls the adapter's published functions, so data semantics (symbol resolution, total-return adjustment, the in-progress-bar completeness filter, freshest-of-pre/regular/post quote selection) are identical to using the adapter directly.

## Non-goals

- **HTTP / SSE / remote transport.** stdio only; one local process per client. The tool/handler layer stays transport-agnostic so an HTTP entry point is additive later, but no HTTP is built now.
- **Derived / computed helpers** (period return %, summary stats, latest-N bars). The agent post-processes raw OHLCV itself.
- **Symbol search / free-text lookup** ("Apple" → AAPL). Not in the adapter; would reach past the package boundary into `yahoo-finance2`'s search endpoint.
- **Non-equity assets.** Equity only, matching `assetToYahooSymbol` (which throws on other kinds).
- **Non-`1d` frequencies.** Daily only, matching the adapter.
- **Streaming / live ticks.** That's `@livefolio/yfinance-browser`.
- **Caching.** Intentionally stateless — see D1.
- **Auth, multi-tenancy, rate limiting.** A local single-user stdio process needs none.

## Repo layout

`@livefolio/yfinance-mcp` ships as a new workspace inside the existing `yfinance/` repo, sibling to `browser/`. Root `package.json` adds `"mcp"` to its `workspaces` array. Tooling (tsup, vitest, eslint, prettier, strict tsconfig, co-located `*.test.ts`) mirrors the existing packages.

```
yfinance/                          # repo root, workspace root
├── package.json                    # @livefolio/yfinance (existing) + "workspaces": ["browser", "mcp"]
├── src/                            # @livefolio/yfinance source — UNCHANGED
├── browser/                        # @livefolio/yfinance-browser — UNCHANGED
├── mcp/                            # NEW workspace package
│   ├── package.json                # @livefolio/yfinance-mcp, "bin" → dist/index.js
│   ├── tsconfig.json               # extends ../tsconfig.json
│   ├── tsup.config.ts              # entry src/index.ts, esm, node20, shebang banner
│   ├── vitest.config.ts
│   ├── README.md                   # usage + `claude mcp add` / client config snippet
│   └── src/
│       ├── index.ts                # bin entrypoint: createServer() + StdioServerTransport + connect
│       ├── server.ts               # createServer(deps?) → McpServer with the 3 tools registered
│       ├── server.test.ts          # in-memory client/server integration tests
│       ├── tools/
│       │   ├── quote.ts            # get_quote + get_quotes handlers & zod schemas
│       │   └── bars.ts             # get_daily_bars handler & zod schema
│       ├── format.ts               # Quote → output, Bar[] → output (pure)
│       └── format.test.ts
└── docs/specs/2026-06-14-yfinance-mcp-design.md
```

**Why a workspace, not a separate repo:** matches the existing pattern (`browser/` is already a sibling workspace). Keeps the MCP server versioned and released next to the adapter it wraps; the adapter's source files don't move (zero churn on the published `@livefolio/yfinance`).

**ESLint / Prettier** at the repo root are reused by the child via `extends`.

### Dependency wiring

- **Runtime dependencies:** `@modelcontextprotocol/sdk`, `@livefolio/yfinance` (the adapter), `zod`. (`yahoo-finance2` arrives transitively via the adapter.)
- **Dev / types-only:** `@livefolio/sdk`. Every SDK reference in the adapter and in this package is `import type`, so the SDK never enters the runtime bundle — it's needed only to type-check `Asset` / `Quote` / `Bar` / `DateRange` / `Frequency`.
- **`engines.node` >= 20**, `"type": "module"`, matching the repo.
- **Adapter resolution:** the MCP package declares `"@livefolio/yfinance": "^0.1.1"`. Inside the monorepo, npm links the local workspace root by that name; the adapter must be **built first** (`npm run build` at root) so `@livefolio/yfinance/dist` exists. If workspace linking of the root package proves unreliable, the published `0.1.1` on the registry already exports every function we need (`fetchYahooBars`, `fetchYahooQuoteForAsset`, `fetchYahooQuoteBatchForAssets`, `assetToYahooSymbol`), so a registry fallback is API-compatible. This is the one wiring detail to confirm during implementation.
- **tsup** compiles `src/index.ts` → `dist/index.js` (esm, target node20), prepends a `#!/usr/bin/env node` shebang banner, and externalizes the runtime deps (npm installs them for `npx` consumers). No `.d.ts` emitted — this is an executable, not a library.

## Public API (tools)

All three tools use MCP **structured tool output**: registered with an `outputSchema`, and each call returns both `structuredContent` (the JSON below) and a `content` text block (a short human summary). All three carry read-only annotations (D5).

### `get_quote`

Latest quote for one equity.

```ts
// input
{ symbol: string }            // e.g. "AAPL"; class shares "BRK.B" normalized to "BRK-B"
// output (structuredContent)
{
  symbol: string,
  price: number,
  time: string,               // ISO 8601, Yahoo's vendor stamp (not local clock)
  currency?: string,
  bid?: number,
  ask?: number,
}
// text: `AAPL: 201.45 USD (as of 2026-06-13T20:00:00.000Z)`
```

Maps to `fetchQuote({ kind: 'equity', id: 'yf:<SYM>', symbol })`. The returned price is the freshest of pre / regular / post-market (adapter behavior). Description notes equities only and that during the US overnight session the post-market price may be a stale-but-honest 20:00 ET stamp.

### `get_quotes`

Batch quotes in a single Yahoo round-trip.

```ts
// input
{ symbols: string[] }         // min 1, max 50
// output (structuredContent)
{ quotes: Array<QuoteOut> }   // same shape as get_quote output; SAME ORDER as input
// text: compact one-line-per-symbol summary
```

Maps to `fetchQuoteBatch(assets)`. **Partial failure is all-or-nothing:** the adapter throws if *any* requested symbol is absent from Yahoo's response (the QuoteFeed contract forbids silent omission), so one unknown ticker fails the whole call. This is documented in the tool description and surfaced as a tool error (D7).

### `get_daily_bars`

Historical daily OHLCV over a date range.

```ts
// input
{
  symbol: string,
  from: string,               // inclusive, "YYYY-MM-DD"
  to: string,                 // inclusive, "YYYY-MM-DD"
  includeIncompleteToday?: boolean,   // default false
}
// output (structuredContent)
{
  symbol: string,
  from: string,               // echoed "YYYY-MM-DD"
  to: string,
  count: number,
  bars: Array<{               // compact keys for token efficiency (D4); UTC-midnight day
    t: string,                // "YYYY-MM-DD"
    o: number, h: number, l: number, c: number, v: number,
  }>,
}
// text: `AAPL — 251 daily bars, 2024-01-02 → 2024-12-31. Last close 250.42.`
```

Maps to `fetchBars(assetToYahooSymbol({ kind: 'equity', id: 'yf:<SYM>', symbol }), { from: Date, to: Date }, '1d', { includeIncompleteToday })`. Description states prices are **total-return-adjusted** (splits & dividends baked into OHLC; volume raw), `1d` only, UTC-midnight timestamps — so the model knows what it's consuming. No truncation: the full in-range array is returned (the text summary stays small regardless of range length).

## Design decisions (resolved during brainstorming)

### D1. Stateless calls — no caching

Tools call the adapter's exported functions per request; no `YfinanceDataFeed` instance, no `BarCache`. The adapter's bar cache is range-aware with **no TTL** — built for a single backtest run. In a long-lived stdio server (Claude Desktop can keep the process alive for days), a cached `(symbol, range)` would keep returning the old set and silently miss newly-completed daily bars. Fresh-per-request is the correct trade for interactive lookup; dedup matters little for human-paced calls. Quotes are uncached in the adapter regardless, so this only changes bar behavior.

### D2. Reuse the adapter's public exports, not `yahoo-finance2` directly

The server imports `fetchYahooQuoteForAsset`, `fetchYahooQuoteBatchForAssets`, `fetchYahooBars`, and `assetToYahooSymbol` from `@livefolio/yfinance`. Identical normalization, total-return adjustment, completeness filter, and freshest-price selection — and it honors the package boundary (no reaching around the adapter into the underlying library).

### D3. Dependency-injection seam for offline tests

`createServer(deps?: { fetchQuote, fetchQuoteBatch, fetchBars })` defaults to the real adapter exports; tests inject `vi.fn()` stubs returning plain `Quote` / `Bar` objects. Parallel to the adapter's own `fetcher` constructor option (called out in AGENTS.md). No network and no new fixtures in tests.

### D4. Structured tool output; compact bar keys

Each tool registers an `outputSchema` and returns `structuredContent` + a text summary. Quote outputs use full field names (`price`, `currency`, `bid`, `ask`) — single objects. Bar rows use compact `t/o/h/l/c/v` keys: a long range is hundreds of rows, and short keys (documented in the `outputSchema`) cut token cost materially while staying unambiguous. The text summary always carries the human-readable gist.

### D5. Read-only annotations

Every tool registration includes `annotations: { readOnlyHint: true, openWorldHint: true }`:
- `readOnlyHint: true` — the tool mutates nothing. Defaults to `false`, so it **must** be set explicitly or clients assume possible mutation.
- `openWorldHint: true` — the tool reaches an external service (Yahoo). Already the default; set explicitly for clarity.
- `destructiveHint` / `idempotentHint` are omitted — the spec defines them as meaningful only when `readOnlyHint` is `false`.

These are **advisory hints, not guarantees**: per the MCP spec, clients treat annotations as untrusted and must not make security decisions on them alone. Whether Claude Desktop renders a "read-only" badge or offers an auto-approve toggle depends on that client's version; the annotation is the standard, sufficient signal on the server side.

### D6. stdout is reserved for the protocol

The stdio transport uses **stdout** as the JSON-RPC channel. All diagnostic logging goes to **stderr** only. Writing anything else to stdout corrupts the protocol stream. The entrypoint installs `unhandledRejection` / `uncaughtException` handlers that log to stderr and exit non-zero.

### D7. Errors become tool errors, never protocol throws

Each handler wraps its body in try/catch and returns an MCP tool error (`isError: true` with a text message) rather than throwing across the protocol. The adapter's own messages (e.g. `yfinance: no quote returned for XYZ`) pass through; no stack traces. Semantic input validation (unparseable date, `from > to`, empty symbol) returns a clear tool error before any Yahoo call. Schema-level validation (wrong types) is handled by the SDK from the zod `inputSchema`.

### D8. Two-tool quote split

`get_quote` (one symbol → one quote) and `get_quotes` (array → array). Rationale: a clean single-symbol common case plus an explicit batch that's one Yahoo round-trip. The alternative — a single array-only tool — was considered and rejected as slightly worse ergonomics for the dominant single-lookup case.

## Internal architecture

### Components

```
index.ts        Bin entrypoint. createServer() → connect(new StdioServerTransport()).
                Installs stderr-only crash handlers. The only file that touches process I/O.

server.ts       createServer(deps?) → new McpServer({ name: 'yfinance', version }).
                Registers the 3 tools via registerTool(name, { title, description,
                inputSchema, outputSchema, annotations }, handler). deps default to the
                real adapter exports; injectable for tests. Pure of process I/O — returns
                the server object, does not connect a transport.

tools/quote.ts  Builds the get_quote and get_quotes handlers from injected fetchers.
                Constructs equity Assets, calls the fetcher, shapes via format.ts,
                catches errors → tool error.

tools/bars.ts   Builds the get_daily_bars handler. Validates/parses dates, normalizes the
                symbol via assetToYahooSymbol, builds the DateRange, calls fetchBars,
                shapes via format.ts, catches errors → tool error.

format.ts       Pure shapers: quoteToOutput(Quote) → { symbol, price, time, currency?,
                bid?, ask? } + summary text; barsToOutput(symbol, from, to, Bar[]) →
                { symbol, from, to, count, bars } + summary text. No I/O, no throws.
```

### Data flow (per tool call)

```
client callTool(name, args)
  → SDK validates args against the zod inputSchema
  → handler: semantic validation (dates, non-empty) → tool error on failure
  → construct equity Asset / normalize symbol / build DateRange (UTC-midnight Dates)
  → injected adapter fn → @livefolio/yfinance → yahoo-finance2 → Yahoo → normalized Quote | Bar[]
  → format.ts → { content: [{ type:'text', text: summary }], structuredContent: {...} }
  → (any throw) → catch → { content:[{type:'text', text:'Error: …'}], isError: true }
```

`index.ts` is intentionally tiny — build server, connect transport — so all logic lives in transport-agnostic, unit-testable units.

## Error handling & edge cases

- **Unknown symbol (quote):** adapter throws `yfinance: no quote returned for XYZ` → tool error.
- **Batch partial failure:** any unknown symbol throws → whole `get_quotes` call is a tool error (documented; no silent omission).
- **Empty range (no trading days):** `count: 0`, `bars: []`, text "no bars in range" — a normal result, **not** an error.
- **Invalid input:** bad date format, `from > to`, empty symbol, empty `symbols` array → tool error before any network call.
- **Non-equity / unresolvable symbol:** `assetToYahooSymbol` throws for non-equity kinds; all tool inputs are typed as equity tickers, so this only fires on adapter-internal guards → tool error.
- **Date semantics:** `from` / `to` are `YYYY-MM-DD` parsed as UTC midnight (`new Date("2024-01-01")`), matching the adapter's UTC-midnight bar convention. Both bounds inclusive.
- **`includeIncompleteToday`:** default `false` (drops the in-progress today bar, the canonical session view); `true` forwards through to the adapter.
- **Process-level:** `unhandledRejection` / `uncaughtException` and a failed `connect()` log to stderr and exit non-zero. Never write to stdout outside the transport.

## Testing strategy

Offline-only, co-located `*.test.ts`, Vitest, no network and **no new fixtures** — the DI seam (D3) stubs at the adapter-function boundary with plain `Quote` / `Bar` objects.

**`format.test.ts`** — pure unit tests:
- `quoteToOutput`: full fields; optional `currency` / `bid` / `ask` omitted when absent; ISO time string; summary text.
- `barsToOutput`: compact `t/o/h/l/c/v` rows; `count` matches; empty array → `count: 0` + "no bars" summary; `t` rendered `YYYY-MM-DD`.

**`server.test.ts`** — full request→response via the SDK's `InMemoryTransport.createLinkedPair()` linking a `Client` to `createServer(stubs)`:

| Behavior | Verifies |
|---|---|
| Tool discovery | `listTools` returns the 3 tools with `readOnlyHint: true`, `openWorldHint: true` |
| `get_quote` success | Stub Quote → `structuredContent` shape + summary text |
| Symbol normalization | input `BRK.B` → stub called with `BRK-B` (via `assetToYahooSymbol`) |
| `get_quotes` order | input order preserved in `quotes[]` |
| `get_quotes` partial failure | stub throws on one symbol → `isError: true` |
| `get_daily_bars` success | Stub Bar[] → compact rows, `count`, range echo |
| Bars empty range | `count: 0`, "no bars" summary, not an error |
| Date validation | `from > to` and malformed date → `isError: true`, no fetcher call |
| `includeIncompleteToday` | default `false` forwarded; `true` forwarded when set |
| Adapter throw → tool error | fetcher rejects → `isError: true`, message passed through, server stays up |

No coverage-threshold gate. No live-Yahoo integration test (matches the adapter — manual fixture recording only, and not needed here since stubs cover the boundary).

## Out-of-scope / explicitly NOT done

- HTTP / SSE transport (tool layer kept transport-agnostic for a future additive entry point).
- Derived/computed tools, symbol search, non-equity assets, non-`1d` frequencies, streaming.
- Caching / dedup (stateless by D1).
- Auth, rate limiting, multi-tenancy.
- Bundling the adapter source directly (consumed via package name per D2).

## Open questions / follow-ups

- **Release CI wiring.** The repo's version-bump release flow will need an entry for the new `mcp` workspace (publish `@livefolio/yfinance-mcp`). Flagged as a follow-up, not built into this spec; the package is publishable (`publishConfig.access: public`, `repository.directory: "mcp"`) but CI integration is a separate change.
- **Adapter resolution in the monorepo** (workspace link of the root package vs registry fallback) — confirm during implementation per the Dependency wiring note. Low risk: the published API is compatible either way.
- **Initial version:** `0.1.0`.
