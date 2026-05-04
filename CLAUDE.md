@AGENTS.md

## Project Conventions

- **ES Modules**: Extensionless imports (`import { Foo } from './foo'`), bundled with tsup
- **Strict TypeScript**: `strict: true`, `noUncheckedIndexedAccess: true`
- **Tests**: Co-located `*.test.ts` files, run with `npm test` (Vitest)
- **Formatting**: Prettier on save, ESLint with typescript-eslint rules
- **SDK consumption**: `@livefolio/sdk` is a peer dependency, devDep-pinned to `^0.4.0` from the npm registry. All v0.4 types are re-exported from the main barrel — import from bare `@livefolio/sdk`, no subpath imports needed.

## Key Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run all tests (no network) |
| `npm run build` | Bundle with tsup to `dist/` |
| `npm run lint` | Check ESLint rules |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format with Prettier |
| `npm run format:check` | Check formatting |
| `npm run fixtures:record` | **Manual only** — hits live Yahoo to refresh `test/fixtures/*.json` |

## Do Not

- **Don't edit anything in `node_modules/@livefolio/sdk/`** — the SDK is consumed read-only from the npm registry. Changes to the SDK live in its own repo, are published, then bumped here.
- **Don't make live network calls in tests** — every `*.test.ts` mocks the Yahoo client via `vi.mock` or injects a fixture-backed fetcher. The only sanctioned network code is `test/fixtures/record.ts`, run by hand.
- **Don't hand-edit `test/fixtures/*.json`** — they are captured Yahoo responses and must be refreshed via `npm run fixtures:record` so they stay representative of real provider output.
- **Don't pair `YfinanceDataFeed` with a live broker `Executor`** — bars are total-return-adjusted (Yahoo's `adjclose/close` ratio applied uniformly to OHL), which is correct for backtests but breaks limit-order semantics and historical re-scaling for live trading. For live, use the broker's own data feed (e.g. a future `@livefolio/alpaca` exporting both `DataFeed` and `Executor`).
- **Don't add a `fundamentals` or `events` stub** that throws — they are intentionally absent on the instance so consumers feature-detect via `'fundamentals' in feed`. Adding throw-stubs would silently break that pattern.
