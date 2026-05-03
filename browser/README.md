# @livefolio/yfinance-browser

Browser-safe Yahoo Finance `StreamingDataFeed` for [`@livefolio/sdk`](https://github.com/livefolio/sdk) v0.4.

```ts
import { YfinanceStreamingDataFeed } from '@livefolio/yfinance-browser';
import { runLive } from '@livefolio/sdk';

const feed = new YfinanceStreamingDataFeed({
  onStatus: (s) => console.log('yahoo ws:', s),
  onError: (e) => console.warn('yahoo ws error:', e),
});

for await (const ev of runLive({ strategy, history, dataFeed: feed, executor, calendar })) {
  // ...
}
```

Implements `StreamingDataFeed` from `@livefolio/sdk`. Zero Node builtins — runs in any modern browser. See [the design doc](../docs/specs/2026-05-03-yfinance-browser-design.md) for behavior details.
