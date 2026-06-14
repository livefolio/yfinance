# @livefolio/yfinance

## Purpose
Yahoo Finance `DataFeed` adapter for `@livefolio/sdk` v0.4. Wraps the `yahoo-finance2` npm library to implement the SDK's `DataFeed.bars` interface — resolves `Asset` to a Yahoo symbol, calls Yahoo's `chart` endpoint, normalizes the response to v0.4 `Bar[]` (UTC-midnight timestamps, OHLCV from Yahoo's adjusted-close path), and applies a structural completeness filter that drops in-progress today bars without hardcoding US-market hours.

The package is intentionally thin: it owns one capability (`bars` at `1d`), defers caching of features to the SDK's `MemoryFeatureCache`, and ships an in-memory range-aware bar cache so a single backtest fetches each symbol once.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Project manifest — `@livefolio/yfinance`, ES module, Node >=20 |
| `tsconfig.json` | TypeScript strict mode, ES2022 target, bundler module resolution, `noUncheckedIndexedAccess` |
| `tsup.config.ts` | tsup bundler configuration, `@livefolio/sdk` marked external |
| `vitest.config.ts` | Vitest test runner configuration |
| `eslint.config.js` | ESLint flat config with typescript-eslint and Prettier |
| `.prettierrc` | Prettier formatting rules (matches the SDK byte-for-byte) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | All TypeScript source code — adapter implementation and co-located tests |
| `test/fixtures/` | Recorded Yahoo responses for offline tests; `record.ts` is run by hand |
| `docs/` | Design specs and implementation plans |

## Workspaces

This repo is an npm-workspaces monorepo. The root package (`@livefolio/yfinance`, source in `src/`) ships alongside two sibling workspaces, each self-contained with its own `package.json`, build, tests, and README:

| Workspace | Package | Purpose |
|-----------|---------|---------|
| `browser/` | `@livefolio/yfinance-browser` | Browser-safe `StreamingDataFeed`/`QuoteFeed` over Yahoo's WebSocket (live ticks, zero Node builtins) |
| `mcp/` | `@livefolio/yfinance-mcp` | Local stdio MCP server exposing this adapter's quotes & daily bars as three read-only agent tools (`get_quote`, `get_quotes`, `get_daily_bars`); runtime deps `@modelcontextprotocol/sdk` + `zod` |

## For AI Agents

### Working In This Directory
- This is an ES module project (`"type": "module"`) — extensionless imports, bundled with tsup
- The SDK is consumed as a peer dependency, devDep-pinned to `^0.4.2` from the npm registry
- `@livefolio/sdk` is marked `external` in `tsup.config.ts` so it is never inlined into `dist/`

### Testing Requirements
- Run `npm test` to execute all Vitest tests
- Tests use Vitest's `vi.mock` and `vi.fn()` for mocking — no real network connection
- The single network-touching script is `test/fixtures/record.ts`, run by hand to refresh fixtures

### Common Patterns
- **Single class export**: `YfinanceDataFeed` is the only consumer-facing surface
- **Injected fetcher seam**: the constructor accepts a `fetcher` option so tests can swap the live Yahoo client for a fixture-backed one
- **Range-aware in-memory cache**: deduplicates bar fetches across overlapping ranges within a backtest
- **Structural in-progress-bar filter**: drops the last bar iff its UTC time-of-day differs from the modal time-of-day of preceding bars — DST-agnostic, provider-trust-only

## Dependencies

### External (runtime)
- `yahoo-finance2` — Wraps Yahoo's chart and quote endpoints

### Peer
- `@livefolio/sdk` — Provides `Asset`, `Bar`, `DateRange`, `Frequency`, and the `DataFeed` interface

### Dev
- `tsup` — Bundler
- `vitest` — Test runner
- `tsx` — Runs `test/fixtures/record.ts` against live Yahoo
- `typescript` — Compiler
- `eslint` + `typescript-eslint` — Linting
- `prettier` — Formatting
