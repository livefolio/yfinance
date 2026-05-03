# `@livefolio/yfinance-browser` Design

**Status:** Draft
**Date:** 2026-05-03
**Owns:** Browser-safe `StreamingDataFeed` adapter for Yahoo Finance, published from the `yfinance/` repo as a workspace package alongside the existing Node-only `@livefolio/yfinance`.

## Goal

Deliver a `StreamingDataFeed` implementation (per `@livefolio/sdk@^0.4`) that streams live ticks from Yahoo Finance's WebSocket endpoint, runs in the browser with zero Node builtins, and slots into `runLive` without further glue.

The implementation ports `market/src/stream/yahoo-stream.ts` (v0.3 `PriceStream`) to the v0.4 async-iterable interface. The v0.3 code is the reference; the v0.4 surface is what we publish.

## Non-goals

- Multi-vendor abstraction. Yahoo only.
- Non-equity assets. Equity only, matching `@livefolio/yfinance`.
- Historical bars. That's `@livefolio/yfinance` (Node-only).
- Persistent storage / replay.
- Bounded backpressure / drop policies (additive later if needed).
- Bid/ask quote-side data. `Bar` has nowhere to land it.
- Multi-frequency streaming. Adapter emits raw ticks; runtime owns aggregation per Phase 9 streaming spec.

## Repo layout

`@livefolio/yfinance-browser` ships as a workspace inside the existing `yfinance/` repo. The existing `@livefolio/yfinance` package stays at the repo root; the new package nests under `browser/`.

```
yfinance/                          # repo root, workspace root
├── package.json                    # @livefolio/yfinance (existing) + "workspaces": ["browser"]
├── src/                            # @livefolio/yfinance source — UNCHANGED
├── test/fixtures/                  # UNCHANGED
├── browser/                        # NEW workspace package
│   ├── package.json                # @livefolio/yfinance-browser, peer @livefolio/sdk ^0.4
│   ├── tsconfig.json               # extends ../tsconfig.json
│   ├── tsup.config.ts
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts
│       ├── asset.ts                # assetToYahooSymbol (duplicated from ../src/asset.ts)
│       ├── decode-ticker.ts
│       ├── decode-ticker.test.ts
│       ├── yfinance-streaming-data-feed.ts
│       └── yfinance-streaming-data-feed.test.ts
└── docs/specs/2026-05-03-yfinance-browser-design.md
```

**Why a workspace, not a separate repo:** the v0.4 multi-repo spec (`sdk/docs/specs/2026-04-29-v0.4-multi-repo-interface-design.md`) explicitly calls for vendor-named repos that publish a `<vendor>` and a `<vendor>-browser` package out of the same repo when a Node/browser split exists.

**Why `browser/` at root, not `packages/{yfinance,yfinance-browser}/`:** the existing `@livefolio/yfinance@0.1.0` source files don't move — zero churn on the published package, no path-changes in imports/tests. Root `package.json` stays both a published package and a workspace root (npm supports this).

**Why duplicate `assetToYahooSymbol` rather than extract:** the helper is ~10 lines of pure code, no ongoing maintenance. A shared internal package would be over-engineering. If divergence emerges, refactoring takes minutes.

ESLint and Prettier configs at the repo root are reused by the child via `extends`. Husky/lint-staged stay at root.

## Public API

```ts
// browser/src/index.ts
export { YfinanceStreamingDataFeed } from './yfinance-streaming-data-feed';
export type { YfinanceStreamingDataFeedOptions } from './yfinance-streaming-data-feed';
export { assetToYahooSymbol } from './asset';
export { decodeTicker } from './decode-ticker';
export type { Ticker } from './decode-ticker';
```

```ts
export type YfinanceStreamingDataFeedOptions = {
  /** Override the WebSocket constructor — tests inject a MockWebSocket. */
  webSocketFactory?: (url: string) => WebSocket;
  /** Yahoo streamer endpoint. Defaults to wss://streamer.finance.yahoo.com/. */
  url?: string;
  /** Initial reconnect delay in ms; doubles up to maxReconnectDelayMs. Defaults to 500. */
  reconnectBaseDelayMs?: number;
  /** Reconnect backoff cap in ms. Defaults to 8000. */
  maxReconnectDelayMs?: number;
  /** Operational signal — 'reconnecting' on socket open attempt, 'connected' on open, 'disconnected' on close. */
  onStatus?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
  /** Decode failures and WebSocket errors. Iterator never throws — errors are reported here. */
  onError?: (error: Error) => void;
};

export class YfinanceStreamingDataFeed implements StreamingDataFeed {
  constructor(opts?: YfinanceStreamingDataFeedOptions);
  subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar>;
  /** Optional: tear down the connection eagerly. Normally not needed — refcount via subscriber count. */
  close(): void;
}
```

**Class style** matches `YfinanceDataFeed` (the Node sibling), not the v0.3 `createYahooPriceStream` factory.

**No `unsubscribe` method.** Cancellation is "break the `for await` loop" — engine calls `iterator.return()`, which decrements refcounts and tears down the socket if no subscribers remain.

**`close()`** is a manual override for app shutdown / hot-reload — terminates all active iterators cleanly (no throw).

**`webSocketFactory`** is the test seam, parallel to `fetcher` on `YfinanceDataFeed`.

## Design decisions (resolved during brainstorming)

### D1. Cancellation lifecycle: refcounted across `subscribe()` calls

When a consumer breaks the `for await` loop, the engine invokes `iterator.return()`. We:
1. Mark the subscriber done; resolve any pending waiter with `{done:true}`.
2. Decrement `refCounts[symbol]` for each subscribed symbol.
3. If a symbol's refcount hits zero, send an updated `{subscribe: [...remaining symbols]}` to Yahoo.
4. If no subscribers remain on the feed, close the WebSocket. The next `subscribe()` call lazily reopens it.

Rationale: matches the pull-based async-iterable model; lets a UI re-subscribe on remount without socket churn; one feed instance maps to one shared WebSocket regardless of how many consumers attach.

### D2. Reconnection / error surfacing: silent reconnect + opt-in callbacks

The v0.4 `StreamingDataFeed` interface is a plain async iterable — no `status`/`error` event channel. We:
- **Silently reconnect** with exponential backoff (500 → 1000 → … → 8000 ms cap, reset on successful open). Iterators stay alive across the gap; ticks are simply absent during reconnect.
- **Never throw from the iterator.** Decode failures and socket errors are swallowed for iteration purposes.
- **Surface observability via `onStatus` / `onError` constructor callbacks.** Apps that want to monitor connection health subscribe; apps that don't pass nothing.

Rationale: keeps the `StreamingDataFeed` contract clean (open-ended, doesn't terminate spuriously); preserves the v0.3 operational signal without bolting it onto the interface.

### D3. Tick → `StreamingBar` shape

For each decoded `Ticker { id, price, time, lastSize? }`:
- Look up the corresponding `Asset` via the subscriber's `symbolToAsset` map (built from `assetToYahooSymbol(asset) === ticker.id`).
- Emit `{ asset, bar: { t: new Date(time), open: price, high: price, low: price, close: price, volume: lastSize ?? 0 } }`.

`bar.t` uses Yahoo's tick timestamp, not local arrival time — closer to the trade's true time, and what `runLive` will treat as the tick's logical time.

`asset` echoes the exact `Asset` object the consumer passed in — avoids fabricating an `Asset` from just a Yahoo symbol string.

`volume` is populated from Yahoo's `lastSize` (proto field 22) when present, `0` otherwise. A `0`-volume bar is a lie when real trade size is on the wire.

### D4. Decoder scope

Owned in this package as `decode-ticker.ts`, inspired by but not copied from `market/src/stream/decode-ticker.ts`. Decodes:
- Field 1 (`id`, string)
- Field 2 (`price`, float)
- Field 3 (`time`, sint64 → number ms)
- Field 22 (`lastSize`, sint64 → number)

All other fields (currency, exchange, dayHigh/dayLow, bid/ask, etc.) are skipped via wire-type-aware advancement. Filling `bar.high`/`bar.low` from session-aggregate `dayHigh`/`dayLow` would conflate aggregate with tick — explicitly rejected.

## Internal architecture

### Components

```
YfinanceStreamingDataFeed
├── socket: WebSocket | null            # lazy: created on first subscribe()
├── reconnectAttempt, reconnectTimer    # exponential backoff state
├── closed: boolean                     # set by close() — terminal
├── subscribers: Set<Subscriber>        # one per active subscribe() call
└── refCounts: Map<symbol, number>      # how many subscribers want each symbol

Subscriber (per subscribe() call)
├── assets: ReadonlyArray<Asset>        # caller-provided
├── symbolToAsset: Map<symbol, Asset>   # via assetToYahooSymbol, for echo-back
├── queue: StreamingBar[]               # FIFO buffer of pending ticks
├── waiter: { resolve, reject } | null  # set when iterator awaits next()
└── done: boolean                       # set on iterator return() or feed close()
```

### Data flow per tick

```
WebSocket.onmessage (base64 string)
  → atob → Uint8Array
  → decodeTicker → { id, price, time, lastSize? }
  → for each subscriber whose symbolToAsset has `id`:
      build StreamingBar { asset, bar: { t: new Date(time), open=high=low=close=price, volume: lastSize ?? 0 } }
      if subscriber.waiter: resolve(value); waiter = null
      else: subscriber.queue.push(bar)
```

### Subscribe lifecycle

```
subscribe(assets)
  1. If closed: return immediately-done iterator
  2. Create Subscriber, build symbolToAsset map
  3. For each new symbol: refCounts[s]++; if went 0→1, mark dirty
  4. If dirty: openSocketIfNeeded() then send {subscribe: [...all symbols with refCount>0]}
  5. Return async iterable wrapping this subscriber

iterator.next()
  if subscriber.queue.length: shift → return value
  else if subscriber.done: return { done: true }
  else: install waiter promise; resolve when next matching tick arrives

iterator.return() (called on break, early exit, error)
  1. subscriber.done = true; resolve any pending waiter with {done:true}
  2. subscribers.delete(subscriber)
  3. For each symbol in subscriber: refCounts[s]--; if went 1→0, mark dirty
  4. If dirty:
       if any subscribers remain: send updated {subscribe: [...]}
       else: close the socket (refcount-driven teardown per D1)
```

### Reconnect

- `socket.onclose` (when not `closed`): emit `onStatus('disconnected')`, schedule reconnect with `min(maxDelay, base * 2^attempt)`.
- `socket.onopen`: reset `attempt = 0`, emit `onStatus('connected')`, re-send full subscribe of all symbols with `refCount > 0`.
- During reconnect gap: ticks absent; queues intact; iterators idle on waiters until ticks resume.
- Decode/socket errors → `onError(err)`; iterators never see throws.

### Ordering guarantee

Yahoo delivers ticks per-symbol in chronological order on the wire. We enqueue per-subscriber in receipt order, so `bar.t` is monotonic per asset within each subscriber's iterable — satisfies the interface contract. No defensive sorting; out-of-order ticks are a vendor bug to surface, not silently smooth.

### `close()` semantics

`closed = true`, clear reconnect timer, mark all subscribers `done`, resolve waiters with `{done:true}`, clear listeners on the socket, call `socket.close()`. Subsequent `subscribe()` calls return immediately-done iterators.

## Error handling & edge cases

**Cancellation paths** all converge on the same cleanup:
- Consumer `break`s → `iterator.return()`.
- Consumer `throw`s → also `iterator.return()`.
- `feed.close()` → terminates all subscribers, resolves waiters, then cleanup.
- Process tear-down → consumer's responsibility to call `feed.close()`; otherwise socket lingers until GC.

**Race conditions:**
- Tick arrives between `next()` returning and the next `next()` call → goes onto queue; drained on next call.
- `iterator.return()` while a waiter is pending → resolve waiter with `{done:true}` *before* refcount cleanup.
- `subscribe()` after `close()` → immediately-done iterator (no socket reopen). Symmetric with v0.3 "close() is terminal".
- Reconnect succeeds while a new `subscribe()` is dirty-marking → resubscribe-on-open always sends the full active symbol set; ordering doesn't matter.

**Decode errors** never poison the queue: `try { decodeTicker(bytes) } catch (e) { onError?.(e); return }` inside `onmessage`. The next message is independent.

**Callback discipline:**
- `onStatus` / `onError` wrapped in `try/catch` so a throwing callback doesn't crash the feed (matches v0.3 listener-isolation).
- Fired synchronously inside the WS event handler — keep them cheap, no `await`.
- `onStatus` is best-effort, not a state machine. No dedup; rapid bounces emit rapid status sequences. Caller debounces if they care.

**Backpressure:** Queue is unbounded. Yahoo aggregate tick rate is order ~10/s during US market hours; even hours of slow consumption stays well within memory. Bounded buffering with drop-oldest is additive (`maxQueueSize?: number`) if a use case appears.

## Browser-safety constraints

- Uses `WebSocket`, `atob`, `TextDecoder`, `DataView`, `setTimeout`, `Date` — standard in browsers and Node 22+.
- `tsconfig.json` lib: `["ES2022", "DOM"]` so `WebSocket` types resolve without `@types/node`.
- No `node:*` imports anywhere.
- tsup config: `@livefolio/sdk` external; no other externals; `format: ['esm']`; `target: 'es2022'`.
- The package name signals browser-first; Node 22+ runs it as a freebie because globals overlap.

## Testing strategy

Mirror the existing v0.3 test patterns from `market/src/stream/yahoo-stream.test.ts`. Co-located `*.test.ts` files, Vitest, no network.

**`decode-ticker.test.ts`** — pure unit tests:
- Round-trip: encoder helpers → bytes → `decodeTicker` → assert `{ id, price, time, lastSize? }`
- Field skipping: unrelated fields decode without error and are ignored
- `lastSize` present → returned; absent → `undefined`
- Edge cases: empty `id`, zero price, negative `time` (zigzag boundary), large varint `lastSize`

**`yfinance-streaming-data-feed.test.ts`** — `MockWebSocket` injected via `webSocketFactory` + `vi.useFakeTimers()`:

| Behavior | Verifies |
|---|---|
| Lazy connect | No socket until first `subscribe()` |
| Subscribe message | `{subscribe: [<yahoo symbols>]}` on `onopen` |
| Asset → symbol | `Asset { kind: 'equity', symbol: 'BRK.B' }` → subscribes as `'BRK-B'` |
| Tick → StreamingBar | Mock ticker → `{ asset, bar: { t, open=high=low=close=price, volume: lastSize ?? 0 } }` |
| Multi-asset fan-in | `['SPY','QQQ']` → interleaved ticks both reach iterator |
| Drops unsubscribed | `'AAPL'` ticker while only `'SPY'` subscribed → no yield |
| Multi-subscriber refcount | Two overlapping subscribes on `'SPY'`; one breaks → other still receives |
| Refcount → socket close | Last subscriber breaks → socket closed |
| Ascending order | `bar.t` strictly ascending per asset across many ticks |
| Iterator cancel via `break` | `return()` called, refcounts decrement, no leak |
| Reconnect backoff | 500/1000/2000/4000/8000 ms cap, reset to 500 on successful open |
| Re-subscribe on reconnect | Fresh `{subscribe: [...active]}` after reconnect |
| `onStatus` lifecycle | `'reconnecting'` → `'connected'` → `'disconnected'` |
| `onError` on decode failure | Bad base64 → callback fires; iterator keeps running |
| `onError` on socket error | `onerror` event → callback fires; iterator keeps running |
| Listener isolation | `onError` itself throwing doesn't break tick delivery |
| `close()` terminates iterators | All `for await` loops complete cleanly (`{done:true}`), no throw |
| `close()` prevents reconnect | Advancing fake timers post-`close()` creates no new sockets |
| Idle waiter resolution | Iterator awaiting `next()` resolves on first matching tick |
| Buffered tick delivery | Ticks queued during slow consumption drained in order |

No coverage threshold gate. No live-Yahoo integration test (matches `@livefolio/yfinance`'s approach — manual fixture recording only, if needed).

## Out-of-scope / explicitly NOT done

- Retry on Yahoo subscription errors (Yahoo silently ignores unknown symbols — we trust the stream).
- Tick deduplication across reconnects (vendor responsibility).
- Symbol normalization beyond `.` → `-` for class shares.
- Non-equity assets (`assetToYahooSymbol` throws, same as Node sibling).
- Persistent reconnect-state across page reloads.
- Multiple simultaneous Yahoo connections per feed instance.

## Open questions

None outstanding. All design points resolved during brainstorming (D1–D4).
