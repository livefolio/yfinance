# @livefolio/yfinance

Yahoo Finance `DataFeed` adapter for [`@livefolio/sdk`](https://github.com/livefolio/sdk) v0.4. Wraps [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2) to implement the SDK's `DataFeed.bars` interface — resolves an `Asset` to a Yahoo symbol, calls the `chart` endpoint, normalizes the response to v0.4 `Bar[]` (UTC-midnight timestamps, OHLCV from Yahoo's adjusted-close path), and applies a structural completeness filter that drops in-progress today bars without hardcoding US-market hours. A range-aware in-memory cache deduplicates fetches inside a single backtest.

> **Pre-1.0 — expect breaking changes.** Tracks the SDK's v0.4 surface (`@livefolio/sdk@^0.4.0`).

## Install

```sh
npm install @livefolio/yfinance
```

`@livefolio/sdk@^0.4.0` is a peer dependency — install it alongside.

## Usage

```ts
import { YfinanceDataFeed } from '@livefolio/yfinance';
import { FeatureRuntime, MemoryFeatureCache } from '@livefolio/sdk';

const dataFeed = new YfinanceDataFeed();
const runtime = new FeatureRuntime({
  dataFeed,
  featureCache: new MemoryFeatureCache(),
  range: { from: new Date('2024-01-01'), to: new Date('2024-12-31') },
  freq: '1d',
});
```

Pass `runtime` into `tactical.fromSpec` (or any v0.4 strategy) and the SDK's `runBacktest` does the rest.

## Capabilities

| Capability | Status | Notes |
|---|---|---|
| `bars` | OK | Daily (`1d`) only |
| `fundamentals` | not implemented | Optional on the interface; absent on the instance |
| `events` | not implemented | Optional on the interface; absent on the instance |
| Frequencies | `1d` only | Other frequencies throw |

**Bars are total-return-adjusted.** Yahoo's `adjclose / close` ratio is applied uniformly to OHL on each bar so splits and dividends are baked in across all four price fields (volume stays raw). This keeps `high ≥ close ≥ low` consistent across corporate-action days and matches the v0.4 spec's accepted fidelity bar. Pairing this adapter with a live broker executor isn't a supported configuration — for live trading, use the broker's own data feed (e.g. a future `@livefolio/alpaca` exporting both `DataFeed` and `Executor`).

## Stability

Pre-1.0. The class shape (`YfinanceDataFeed`) is stable; constructor options may grow additively. Any breaking change to the `Bar` shape would come from the SDK's `Bar` type, not from this package.

## License

MIT
