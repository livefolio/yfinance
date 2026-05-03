# `@livefolio/yfinance-browser` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@livefolio/yfinance-browser` — a browser-safe `StreamingDataFeed` that streams live ticks from Yahoo's WebSocket and slots into `runLive`.

**Architecture:** New workspace package nested under `browser/` in the existing `yfinance/` repo. One class `YfinanceStreamingDataFeed` manages a single shared WebSocket with refcounted multi-subscriber fan-out. Hand-rolled protobuf decoder reads `id`/`price`/`time`/`lastSize`. Silent reconnect with opt-in `onStatus`/`onError` callbacks. Iterator-based async-iterable surface — never throws.

**Tech Stack:** TypeScript ESM, tsup bundler, Vitest, browser globals (`WebSocket`, `atob`, `TextDecoder`, `DataView`). Peer-deps `@livefolio/sdk@^0.4`. Zero runtime deps.

**Spec:** `docs/specs/2026-05-03-yfinance-browser-design.md`

---

## File Structure

```
yfinance/                                    # repo root
├── package.json                              # MODIFY: add "workspaces": ["browser"]
├── browser/                                  # CREATE: workspace child
│   ├── package.json                          # CREATE: @livefolio/yfinance-browser
│   ├── tsconfig.json                         # CREATE: extends ../tsconfig.json
│   ├── tsup.config.ts                        # CREATE
│   ├── vitest.config.ts                      # CREATE
│   ├── README.md                             # CREATE
│   └── src/
│       ├── index.ts                          # CREATE: public exports
│       ├── asset.ts                          # CREATE: assetToYahooSymbol
│       ├── asset.test.ts                     # CREATE
│       ├── decode-ticker.ts                  # CREATE: protobuf decoder
│       ├── decode-ticker.test.ts             # CREATE
│       ├── yfinance-streaming-data-feed.ts   # CREATE: the class
│       └── yfinance-streaming-data-feed.test.ts  # CREATE
└── docs/
    ├── specs/2026-05-03-yfinance-browser-design.md  # exists
    └── plans/2026-05-03-yfinance-browser.md          # this file
```

Each file has one responsibility:
- `asset.ts` — `Asset` → Yahoo symbol string (pure, no I/O)
- `decode-ticker.ts` — Yahoo protobuf → `Ticker` object (pure, no I/O)
- `yfinance-streaming-data-feed.ts` — class implementing `StreamingDataFeed`, owns the WebSocket + subscriber registry
- `index.ts` — re-exports the public surface

---

## Task 0: Workspace shell

**Goal:** Make `browser/` a published-but-empty workspace package whose toolchain (TS, tsup, vitest, ESLint) is wired to the repo root.

**Files:**
- Modify: `package.json` (root)
- Create: `browser/package.json`
- Create: `browser/tsconfig.json`
- Create: `browser/tsup.config.ts`
- Create: `browser/vitest.config.ts`
- Create: `browser/README.md`
- Create: `browser/src/index.ts` (placeholder export so build/test don't fail)

**Acceptance Criteria:**
- [ ] `npm install` from repo root succeeds and creates `node_modules/@livefolio/yfinance-browser` symlink
- [ ] `npm run build --workspace @livefolio/yfinance-browser` produces `browser/dist/index.js` and `browser/dist/index.d.ts`
- [ ] `npm test --workspace @livefolio/yfinance-browser` passes (no tests yet, exits 0 via `passWithNoTests`)
- [ ] Existing `npm test` at root still passes (no regression on `@livefolio/yfinance`)

**Verify:**
```bash
npm install && \
npm run build --workspace @livefolio/yfinance-browser && \
npm test --workspace @livefolio/yfinance-browser && \
npm test
```
Expected: all four commands exit 0; `browser/dist/index.{js,d.ts}` exist.

**Steps:**

- [ ] **Step 1: Add workspaces field to root package.json**

Edit `package.json` at the repo root — add a top-level `"workspaces"` array. Insert it between `"engines"` and `"exports"` (or anywhere before `"scripts"`):

```json
"workspaces": ["browser"],
```

So the file becomes:

```json
{
  "name": "@livefolio/yfinance",
  "version": "0.1.0",
  "description": "Yahoo Finance adapters for @livefolio/sdk v0.4. Node-only DataFeed (yahoo-finance2 historical bars). For browser-safe streaming, see @livefolio/yfinance-browser.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "workspaces": ["browser"],
  "keywords": [...],
  "license": "MIT",
  ...
}
```

- [ ] **Step 2: Create `browser/package.json`**

```json
{
  "name": "@livefolio/yfinance-browser",
  "version": "0.1.0",
  "description": "Browser-safe Yahoo Finance StreamingDataFeed for @livefolio/sdk v0.4. Pure ESM, zero Node builtins.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md"],
  "keywords": [
    "yahoo-finance",
    "streaming-data-feed",
    "websocket",
    "livefolio",
    "browser"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/livefolio/yfinance.git",
    "directory": "browser"
  },
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=20"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write 'src/**/*.ts'",
    "format:check": "prettier --check 'src/**/*.ts'",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "peerDependencies": {
    "@livefolio/sdk": "^0.4.0"
  },
  "devDependencies": {
    "@livefolio/sdk": "file:../../sdk"
  }
}
```

Notes for the implementer:
- Tooling devDeps (`vitest`, `tsup`, `typescript`, `eslint`, `prettier`, etc.) are inherited via npm workspace hoisting from the root `package.json` — no need to redeclare.
- `@livefolio/sdk` IS redeclared as a workspace-local devDep so npm correctly resolves the link from `browser/` (the path is `../../sdk`, two levels up).
- `peerDependencies` matches the root yfinance package.

- [ ] **Step 3: Create `browser/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "outDir": "./dist",
    "baseUrl": ".",
    "paths": {
      "@livefolio/sdk": ["../node_modules/@livefolio/sdk/src/index.ts"],
      "@livefolio/sdk/interfaces": ["../node_modules/@livefolio/sdk/src/interfaces/index.ts"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

Notes:
- `lib: ["ES2022", "DOM"]` makes `WebSocket`, `MessageEvent`, `Event`, `atob`, `TextDecoder`, `DataView` resolve as ambient browser globals — no `@types/node` needed for the source.
- `paths` overrides the parent's so `@livefolio/sdk` resolves to the linked SDK source. Note the relative path is `../node_modules/...` (one level up from `browser/`, since npm workspaces hoist to the repo root).

- [ ] **Step 4: Create `browser/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['@livefolio/sdk'],
});
```

- [ ] **Step 5: Create `browser/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const sdkSrc = fileURLToPath(new URL('../node_modules/@livefolio/sdk/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@livefolio\/sdk$/, replacement: `${sdkSrc}/index.ts` },
      { find: /^@livefolio\/sdk\/(.*)$/, replacement: `${sdkSrc}/$1/index.ts` },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
```

Note: `environment: 'node'` is fine — we stub `WebSocket` in tests via `vi.stubGlobal`, exactly like the v0.3 `yahoo-stream.test.ts`.

- [ ] **Step 6: Create `browser/src/index.ts`** (placeholder so the build doesn't fail)

```ts
export {};
```

- [ ] **Step 7: Create `browser/README.md`**

```markdown
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
```

- [ ] **Step 8: Run install + verify build + test**

```bash
npm install
npm run build --workspace @livefolio/yfinance-browser
npm test --workspace @livefolio/yfinance-browser
npm test
```

Expected:
- `npm install` resolves `@livefolio/yfinance-browser` as a workspace; no errors.
- Build creates `browser/dist/index.js` (essentially `export {};`) and `browser/dist/index.d.ts`.
- `npm test --workspace @livefolio/yfinance-browser` exits 0 ("No test files found, exiting with code 0").
- Root `npm test` still passes for the existing `@livefolio/yfinance` package.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json browser/
git commit -m "chore: scaffold @livefolio/yfinance-browser workspace package"
```

---

## Task 1: `assetToYahooSymbol` helper

**Goal:** Pure function that maps a v0.4 `Asset` to the symbol string Yahoo's WebSocket expects, with TDD.

**Files:**
- Create: `browser/src/asset.ts`
- Create: `browser/src/asset.test.ts`

**Acceptance Criteria:**
- [ ] Equity assets pass through, with `.` → `-` for class shares (e.g. `BRK.B` → `BRK-B`)
- [ ] Non-equity assets throw `Error` with the unsupported `kind` in the message

**Verify:** `npm test --workspace @livefolio/yfinance-browser -- asset.test` → all assertions pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `browser/src/asset.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Asset } from '@livefolio/sdk';
import { assetToYahooSymbol } from './asset';

describe('assetToYahooSymbol', () => {
  it('passes through a plain equity symbol', () => {
    const asset: Asset = { kind: 'equity', symbol: 'SPY' };
    expect(assetToYahooSymbol(asset)).toBe('SPY');
  });

  it('replaces "." with "-" for class shares', () => {
    const asset: Asset = { kind: 'equity', symbol: 'BRK.B' };
    expect(assetToYahooSymbol(asset)).toBe('BRK-B');
  });

  it('throws for unsupported asset kinds', () => {
    const asset = { kind: 'crypto', symbol: 'BTC-USD' } as unknown as Asset;
    expect(() => assetToYahooSymbol(asset)).toThrow(/crypto/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test --workspace @livefolio/yfinance-browser -- asset.test
```

Expected: FAIL — `Cannot find module './asset'` or similar.

- [ ] **Step 3: Implement `assetToYahooSymbol`**

Create `browser/src/asset.ts` (duplicated verbatim from the root package's `src/asset.ts`):

```ts
import type { Asset } from '@livefolio/sdk';

/**
 * Resolves a v0.4 `Asset` to the symbol string Yahoo's WebSocket expects.
 *
 * Default behaviour trusts `asset.symbol` verbatim. The one consistent
 * adjustment is class-share notation: Yahoo writes `BRK-B`, not `BRK.B`,
 * so any `.` in the symbol becomes `-`.
 *
 * Pure. No I/O. Duplicated from `@livefolio/yfinance` rather than imported
 * because that package is Node-only.
 */
export function assetToYahooSymbol(asset: Asset): string {
  switch (asset.kind) {
    case 'equity':
      return asset.symbol.replaceAll('.', '-');
    default: {
      const kind = (asset as { kind: string }).kind;
      throw new Error(`assetToYahooSymbol: unsupported asset kind "${kind}"`);
    }
  }
}
```

- [ ] **Step 4: Re-run tests to verify they pass**

```bash
npm test --workspace @livefolio/yfinance-browser -- asset.test
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add browser/src/asset.ts browser/src/asset.test.ts
git commit -m "feat(browser): add assetToYahooSymbol helper"
```

---

## Task 2: `decodeTicker` protobuf decoder

**Goal:** Hand-rolled protobuf decoder for Yahoo's `PricingData` message, reading `id` (field 1), `price` (field 2), `time` (field 3, sint64), and `lastSize` (field 22, sint64). All other fields advanced past with wire-type-aware skipping.

**Files:**
- Create: `browser/src/decode-ticker.ts`
- Create: `browser/src/decode-ticker.test.ts`

**Acceptance Criteria:**
- [ ] Round-trip: encode `{id, price, time, lastSize?}` → bytes → decode produces equivalent object
- [ ] Reads only fields 1/2/3/22 — other fields are skipped silently regardless of wire type
- [ ] `lastSize` is `undefined` when the field is absent
- [ ] Negative `time` values (zigzag boundary) round-trip correctly
- [ ] Empty `id`, zero `price` produce `id: ''`, `price: 0`
- [ ] Unknown wire type (3, 4, 6, 7) terminates decoding gracefully

**Verify:** `npm test --workspace @livefolio/yfinance-browser -- decode-ticker.test` → all assertions pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `browser/src/decode-ticker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decodeTicker } from './decode-ticker';

// Encoder helpers (mirror the v0.3 test in market/src/stream/yahoo-stream.test.ts)

function encodeVarint(n: number): number[] {
  const bytes: number[] = [];
  let value = n;
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  bytes.push(value & 0x7f);
  return bytes;
}

function encodeSint64(n: number): number[] {
  const zigzag = n >= 0 ? n * 2 : n * -2 - 1;
  return encodeVarint(zigzag);
}

function encodeTag(fieldNumber: number, wireType: number): number[] {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeString(fieldNumber: number, value: string): number[] {
  const encoded = new TextEncoder().encode(value);
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(encoded.length), ...encoded];
}

function encodeFloat(fieldNumber: number, value: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  return [...encodeTag(fieldNumber, 5), ...new Uint8Array(buf)];
}

function encodeSint64Field(fieldNumber: number, value: number): number[] {
  return [...encodeTag(fieldNumber, 0), ...encodeSint64(value)];
}

function encodeFixed64(fieldNumber: number, lo: number, hi: number): number[] {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, lo, true);
  view.setUint32(4, hi, true);
  return [...encodeTag(fieldNumber, 1), ...new Uint8Array(buf)];
}

function build(fields: number[][]): Uint8Array {
  return new Uint8Array(fields.flat());
}

describe('decodeTicker', () => {
  it('decodes id, price, and time from a minimal Ticker', () => {
    const bytes = build([
      encodeString(1, 'SPY'),
      encodeFloat(2, 450.25),
      encodeSint64Field(3, 1700000000000),
    ]);
    const ticker = decodeTicker(bytes);
    expect(ticker.id).toBe('SPY');
    expect(ticker.price).toBeCloseTo(450.25, 1);
    expect(ticker.time).toBe(1700000000000);
    expect(ticker.lastSize).toBeUndefined();
  });

  it('decodes lastSize when field 22 is present', () => {
    const bytes = build([
      encodeString(1, 'SPY'),
      encodeFloat(2, 450.25),
      encodeSint64Field(3, 1700000000000),
      encodeSint64Field(22, 100),
    ]);
    const ticker = decodeTicker(bytes);
    expect(ticker.lastSize).toBe(100);
  });

  it('skips unknown fields without affecting decoded values', () => {
    const bytes = build([
      encodeString(1, 'SPY'),
      encodeString(4, 'USD'), // field 4: currency, length-delimited
      encodeFloat(2, 100),
      encodeFloat(11, 99.5), // field 11: dayLow, fixed32 — must be skipped
      encodeSint64Field(3, 1700000000000),
      encodeFixed64(28, 0, 0), // field 28: vol_24hr, fixed64 — must be skipped
      encodeSint64Field(22, 50),
    ]);
    const ticker = decodeTicker(bytes);
    expect(ticker.id).toBe('SPY');
    expect(ticker.price).toBeCloseTo(100, 1);
    expect(ticker.time).toBe(1700000000000);
    expect(ticker.lastSize).toBe(50);
  });

  it('handles empty id, zero price, zero time', () => {
    const bytes = build([
      encodeString(1, ''),
      encodeFloat(2, 0),
      encodeSint64Field(3, 0),
    ]);
    const ticker = decodeTicker(bytes);
    expect(ticker.id).toBe('');
    expect(ticker.price).toBe(0);
    expect(ticker.time).toBe(0);
  });

  it('round-trips negative time (zigzag)', () => {
    const bytes = build([
      encodeString(1, 'SPY'),
      encodeFloat(2, 1),
      encodeSint64Field(3, -1),
    ]);
    expect(decodeTicker(bytes).time).toBe(-1);
  });

  it('handles a large lastSize', () => {
    const bytes = build([
      encodeString(1, 'SPY'),
      encodeFloat(2, 1),
      encodeSint64Field(3, 0),
      encodeSint64Field(22, 1_000_000),
    ]);
    expect(decodeTicker(bytes).lastSize).toBe(1_000_000);
  });

  it('terminates on unknown wire type without throwing', () => {
    // Tag with wire type 3 (group start, deprecated) — decoder bails gracefully.
    const bytes = new Uint8Array([
      ...encodeString(1, 'SPY'),
      ...encodeTag(99, 3),
    ]);
    const ticker = decodeTicker(bytes);
    expect(ticker.id).toBe('SPY');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test --workspace @livefolio/yfinance-browser -- decode-ticker.test
```

Expected: FAIL — `Cannot find module './decode-ticker'`.

- [ ] **Step 3: Implement the decoder**

Create `browser/src/decode-ticker.ts`:

```ts
/**
 * Decoded subset of Yahoo's `PricingData` protobuf message — the fields the
 * v0.4 `StreamingBar` actually consumes.
 *
 * Field map (Yahoo's PricingData):
 * - 1  id        string  → ticker symbol
 * - 2  price     float   → last trade price
 * - 3  time      sint64  → trade timestamp, ms since epoch
 * - 22 lastSize  sint64  → last trade size; absent when Yahoo doesn't report it
 *
 * All other fields (currency, exchange, dayHigh/dayLow, bid/ask, etc.) are
 * skipped during decoding via wire-type-aware advancement.
 */
export interface Ticker {
  id: string;
  price: number;
  time: number;
  lastSize: number | undefined;
}

function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;

  while (pos < bytes.length) {
    const byte = bytes[pos]!;
    result |= (byte & 0x7f) * Math.pow(2, shift);
    pos++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return [result, pos - offset];
}

function readVarint64(bytes: Uint8Array, offset: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let pos = offset;

  while (pos < bytes.length) {
    const byte = BigInt(bytes[pos]!);
    result |= (byte & 0x7fn) << shift;
    pos++;
    if ((byte & 0x80n) === 0n) break;
    shift += 7n;
  }

  return [result, pos - offset];
}

function decodeZigzag64(n: bigint): number {
  return Number((n >> 1n) ^ -(n & 1n));
}

export function decodeTicker(bytes: Uint8Array): Ticker {
  let id = '';
  let price = 0;
  let time = 0;
  let lastSize: number | undefined = undefined;
  let offset = 0;

  while (offset < bytes.length) {
    const [tag, tagLen] = readVarint(bytes, offset);
    offset += tagLen;

    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    switch (wireType) {
      case 0: {
        // varint (incl. sint64 — zigzag-decoded)
        const [value, len] = readVarint64(bytes, offset);
        offset += len;
        if (fieldNumber === 3) {
          time = decodeZigzag64(value);
        } else if (fieldNumber === 22) {
          lastSize = decodeZigzag64(value);
        }
        break;
      }
      case 1: {
        // fixed64 — skip 8 bytes
        offset += 8;
        break;
      }
      case 2: {
        // length-delimited
        const [length, lenBytes] = readVarint(bytes, offset);
        offset += lenBytes;
        if (fieldNumber === 1) {
          id = new TextDecoder().decode(bytes.subarray(offset, offset + length));
        }
        offset += length;
        break;
      }
      case 5: {
        // fixed32 (incl. float)
        if (fieldNumber === 2) {
          const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
          price = view.getFloat32(0, true);
        }
        offset += 4;
        break;
      }
      default:
        // Unknown / deprecated wire type — bail gracefully
        return { id, price, time, lastSize };
    }
  }

  return { id, price, time, lastSize };
}
```

- [ ] **Step 4: Re-run tests to verify they pass**

```bash
npm test --workspace @livefolio/yfinance-browser -- decode-ticker.test
```

Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add browser/src/decode-ticker.ts browser/src/decode-ticker.test.ts
git commit -m "feat(browser): add Yahoo PricingData protobuf decoder"
```

---

## Task 3: `YfinanceStreamingDataFeed` — single-subscriber happy path

**Goal:** First working version of the class — lazy connect, one `subscribe()` call, ticks get yielded as `StreamingBar`, breaking the loop tears the socket down.

**Files:**
- Create: `browser/src/yfinance-streaming-data-feed.ts`
- Create: `browser/src/yfinance-streaming-data-feed.test.ts`

**Acceptance Criteria:**
- [ ] Class implements `StreamingDataFeed` from `@livefolio/sdk`
- [ ] No WebSocket created until first `subscribe()` call
- [ ] On socket open, sends `{subscribe: [<symbols>]}` JSON
- [ ] Tick for a subscribed symbol → iterator yields `{ asset, bar: { t, open=high=low=close=price, volume: lastSize ?? 0 } }`
- [ ] Tick for an unsubscribed symbol → no yield
- [ ] Asset `{kind:'equity', symbol:'BRK.B'}` is subscribed as `BRK-B` and matched against `BRK-B` ticker IDs
- [ ] `bar.t` uses Yahoo's tick `time`, not local `Date.now()`
- [ ] Iterator yielded value `asset` is the exact `Asset` object passed to `subscribe()`
- [ ] Breaking the `for await` loop closes the WebSocket

**Verify:** `npm test --workspace @livefolio/yfinance-browser -- yfinance-streaming-data-feed.test` → all assertions pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `browser/src/yfinance-streaming-data-feed.test.ts`. This file will grow across tasks 3-7 — start with the happy-path tests:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, StreamingBar } from '@livefolio/sdk';
import { YfinanceStreamingDataFeed } from './yfinance-streaming-data-feed';

// --- Encoder helpers (re-used from decode-ticker.test) ---

function encodeVarint(n: number): number[] {
  const bytes: number[] = [];
  let value = n;
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  bytes.push(value & 0x7f);
  return bytes;
}
function encodeSint64(n: number): number[] {
  const zigzag = n >= 0 ? n * 2 : n * -2 - 1;
  return encodeVarint(zigzag);
}
function encodeTag(fieldNumber: number, wireType: number): number[] {
  return encodeVarint((fieldNumber << 3) | wireType);
}
function encodeString(fieldNumber: number, value: string): number[] {
  const encoded = new TextEncoder().encode(value);
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(encoded.length), ...encoded];
}
function encodeFloat(fieldNumber: number, value: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  return [...encodeTag(fieldNumber, 5), ...new Uint8Array(buf)];
}
function encodeSint64Field(fieldNumber: number, value: number): number[] {
  return [...encodeTag(fieldNumber, 0), ...encodeSint64(value)];
}

function buildTickerBase64(id: string, price: number, timeMs: number, lastSize?: number): string {
  const bytes = new Uint8Array([
    ...encodeString(1, id),
    ...encodeFloat(2, price),
    ...encodeSint64Field(3, timeMs),
    ...(lastSize !== undefined ? encodeSint64Field(22, lastSize) : []),
  ]);
  return btoa(String.fromCharCode(...bytes));
}

// --- MockWebSocket ---

type WSListener = (event: any) => void;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: WSListener | null = null;
  onclose: WSListener | null = null;
  onmessage: WSListener | null = null;
  onerror: WSListener | null = null;

  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }
  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }
  simulateError(error?: any): void {
    this.onerror?.(error ?? new Event('error'));
  }
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }
}

function latestWS(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
}

function makeFeed(opts: ConstructorParameters<typeof YfinanceStreamingDataFeed>[0] = {}) {
  return new YfinanceStreamingDataFeed({
    ...opts,
    webSocketFactory: (url: string) => new MockWebSocket(url) as unknown as WebSocket,
  });
}

const SPY: Asset = { kind: 'equity', symbol: 'SPY' };
const QQQ: Asset = { kind: 'equity', symbol: 'QQQ' };
const BRK_B: Asset = { kind: 'equity', symbol: 'BRK.B' };

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('YfinanceStreamingDataFeed — happy path', () => {
  it('does not connect until subscribe() is called', () => {
    makeFeed();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('connects on first subscribe', () => {
    const feed = makeFeed();
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next(); // start iterating
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(latestWS().url).toBe('wss://streamer.finance.yahoo.com/');
  });

  it('sends subscribe message on socket open', () => {
    const feed = makeFeed();
    void feed.subscribe([SPY, QQQ])[Symbol.asyncIterator]().next();
    latestWS().simulateOpen();
    expect(latestWS().sent).toEqual([JSON.stringify({ subscribe: ['SPY', 'QQQ'] })]);
  });

  it('translates Asset BRK.B to Yahoo symbol BRK-B', () => {
    const feed = makeFeed();
    void feed.subscribe([BRK_B])[Symbol.asyncIterator]().next();
    latestWS().simulateOpen();
    expect(latestWS().sent).toEqual([JSON.stringify({ subscribe: ['BRK-B'] })]);
  });

  it('yields a StreamingBar for a subscribed symbol', async () => {
    const feed = makeFeed();
    const iter = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const next = iter.next();
    latestWS().simulateOpen();
    latestWS().simulateMessage(buildTickerBase64('SPY', 450.25, 1700000000000, 75));
    const result = await next;
    expect(result.done).toBe(false);
    const bar = result.value as StreamingBar;
    expect(bar.asset).toBe(SPY); // identity, not just shape
    expect(bar.bar.t.getTime()).toBe(1700000000000);
    expect(bar.bar.open).toBeCloseTo(450.25, 1);
    expect(bar.bar.high).toBeCloseTo(450.25, 1);
    expect(bar.bar.low).toBeCloseTo(450.25, 1);
    expect(bar.bar.close).toBeCloseTo(450.25, 1);
    expect(bar.bar.volume).toBe(75);
    await iter.return?.();
  });

  it('defaults volume to 0 when lastSize is absent', async () => {
    const feed = makeFeed();
    const iter = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const next = iter.next();
    latestWS().simulateOpen();
    latestWS().simulateMessage(buildTickerBase64('SPY', 100, 1700000000000));
    const result = await next;
    expect((result.value as StreamingBar).bar.volume).toBe(0);
    await iter.return?.();
  });

  it('drops ticks for symbols not in this subscription', async () => {
    const feed = makeFeed();
    const iter = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const next = iter.next();
    latestWS().simulateOpen();
    latestWS().simulateMessage(buildTickerBase64('AAPL', 180, 1700000000000));
    latestWS().simulateMessage(buildTickerBase64('SPY', 450, 1700000000001));
    const result = await next;
    expect((result.value as StreamingBar).asset).toBe(SPY);
    await iter.return?.();
  });

  it('drops ticks with empty id', async () => {
    const feed = makeFeed();
    const iter = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const next = iter.next();
    latestWS().simulateOpen();
    latestWS().simulateMessage(buildTickerBase64('', 0, 0));
    latestWS().simulateMessage(buildTickerBase64('SPY', 1, 1700000000000));
    const result = await next;
    expect((result.value as StreamingBar).asset).toBe(SPY);
    await iter.return?.();
  });

  it('breaking the loop closes the socket (single subscriber)', async () => {
    const feed = makeFeed();
    const iter = feed.subscribe([SPY])[Symbol.asyncIterator]();
    void iter.next();
    latestWS().simulateOpen();
    expect(latestWS().readyState).toBe(MockWebSocket.OPEN);

    await iter.return?.();
    expect(latestWS().readyState).toBe(MockWebSocket.CLOSED);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test --workspace @livefolio/yfinance-browser -- yfinance-streaming-data-feed.test
```

Expected: FAIL — `Cannot find module './yfinance-streaming-data-feed'`.

- [ ] **Step 3: Implement the class — single-subscriber path**

Create `browser/src/yfinance-streaming-data-feed.ts`. This is the first slice; later tasks add multi-subscriber refcounting, reconnect, error/status callbacks, and `close()`. Even so, the data structures are designed for the full design from the start so later tasks add behavior, not refactor:

```ts
import type { Asset, StreamingBar, StreamingDataFeed } from '@livefolio/sdk';
import { assetToYahooSymbol } from './asset';
import { decodeTicker } from './decode-ticker';

const DEFAULT_URL = 'wss://streamer.finance.yahoo.com/';

type Waiter = {
  resolve: (result: IteratorResult<StreamingBar>) => void;
};

type Subscriber = {
  symbolToAsset: Map<string, Asset>;
  queue: StreamingBar[];
  waiter: Waiter | null;
  done: boolean;
};

export type YfinanceStreamingDataFeedOptions = {
  webSocketFactory?: (url: string) => WebSocket;
  url?: string;
};

export class YfinanceStreamingDataFeed implements StreamingDataFeed {
  private readonly url: string;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly subscribers = new Set<Subscriber>();
  private readonly refCounts = new Map<string, number>();
  private socket: WebSocket | null = null;

  constructor(opts: YfinanceStreamingDataFeedOptions = {}) {
    this.url = opts.url ?? DEFAULT_URL;
    this.webSocketFactory = opts.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar> {
    const symbolToAsset = new Map<string, Asset>();
    for (const asset of assets) {
      symbolToAsset.set(assetToYahooSymbol(asset), asset);
    }
    const subscriber: Subscriber = { symbolToAsset, queue: [], waiter: null, done: false };
    this.subscribers.add(subscriber);

    let dirty = false;
    for (const symbol of symbolToAsset.keys()) {
      const prior = this.refCounts.get(symbol) ?? 0;
      this.refCounts.set(symbol, prior + 1);
      if (prior === 0) dirty = true;
    }

    if (dirty) {
      this.openSocketIfNeeded();
      this.sendSubscribe();
    }

    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<StreamingBar> {
        return {
          next(): Promise<IteratorResult<StreamingBar>> {
            if (subscriber.queue.length > 0) {
              return Promise.resolve({ value: subscriber.queue.shift()!, done: false });
            }
            if (subscriber.done) {
              return Promise.resolve({ value: undefined as never, done: true });
            }
            return new Promise<IteratorResult<StreamingBar>>((resolve) => {
              subscriber.waiter = { resolve };
            });
          },
          return(): Promise<IteratorResult<StreamingBar>> {
            self.removeSubscriber(subscriber);
            return Promise.resolve({ value: undefined as never, done: true });
          },
        };
      },
    };
  }

  private openSocketIfNeeded(): void {
    if (this.socket) return;
    const socket = this.webSocketFactory(this.url);
    this.socket = socket;

    socket.onopen = (): void => {
      this.sendSubscribe();
    };
    socket.onmessage = (event: MessageEvent): void => {
      if (typeof event.data !== 'string') return;
      const bytes = base64ToBytes(event.data);
      const ticker = decodeTicker(bytes);
      if (ticker.id === '') return;
      this.dispatchTick(ticker);
    };
    socket.onerror = (): void => {};
    socket.onclose = (): void => {
      this.socket = null;
    };
  }

  private sendSubscribe(): void {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) return;
    const symbols = Array.from(this.refCounts.keys()).filter((s) => (this.refCounts.get(s) ?? 0) > 0);
    if (symbols.length === 0) return;
    this.socket.send(JSON.stringify({ subscribe: symbols }));
  }

  private dispatchTick(ticker: { id: string; price: number; time: number; lastSize: number | undefined }): void {
    for (const subscriber of this.subscribers) {
      const asset = subscriber.symbolToAsset.get(ticker.id);
      if (!asset) continue;
      const bar: StreamingBar = {
        asset,
        bar: {
          t: new Date(ticker.time),
          open: ticker.price,
          high: ticker.price,
          low: ticker.price,
          close: ticker.price,
          volume: ticker.lastSize ?? 0,
        },
      };
      if (subscriber.waiter) {
        const waiter = subscriber.waiter;
        subscriber.waiter = null;
        waiter.resolve({ value: bar, done: false });
      } else {
        subscriber.queue.push(bar);
      }
    }
  }

  private removeSubscriber(subscriber: Subscriber): void {
    if (subscriber.done) return;
    subscriber.done = true;
    if (subscriber.waiter) {
      const waiter = subscriber.waiter;
      subscriber.waiter = null;
      waiter.resolve({ value: undefined as never, done: true });
    }
    this.subscribers.delete(subscriber);

    let anyHitZero = false;
    for (const symbol of subscriber.symbolToAsset.keys()) {
      const prior = this.refCounts.get(symbol) ?? 0;
      const next = prior - 1;
      if (next <= 0) {
        this.refCounts.delete(symbol);
        anyHitZero = true;
      } else {
        this.refCounts.set(symbol, next);
      }
    }

    if (this.subscribers.size === 0) {
      this.closeSocket();
    } else if (anyHitZero) {
      this.sendSubscribe();
    }
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}
```

- [ ] **Step 4: Re-run tests to verify they pass**

```bash
npm test --workspace @livefolio/yfinance-browser -- yfinance-streaming-data-feed.test
```

Expected: PASS — all happy-path tests pass.

- [ ] **Step 5: Commit**

```bash
git add browser/src/yfinance-streaming-data-feed.ts browser/src/yfinance-streaming-data-feed.test.ts
git commit -m "feat(browser): add YfinanceStreamingDataFeed with single-subscriber path"
```

---

## Task 4: Multi-subscriber refcounting

**Goal:** Two `subscribe()` calls on the same feed share one WebSocket. Symbols subscribed by multiple consumers don't get unsubscribed until the last consumer detaches.

**Files:**
- Modify: `browser/src/yfinance-streaming-data-feed.test.ts` (append tests)
- Modify: `browser/src/yfinance-streaming-data-feed.ts` (already has the data structures from Task 3 — should pass with no code change, this task is mostly verification; if any test fails, fix the implementation)

**Acceptance Criteria:**
- [ ] Two overlapping subscribers each receive ticks for shared symbols
- [ ] One subscriber breaks → the other still receives ticks; socket stays open
- [ ] Last subscriber breaks → socket closes
- [ ] When a new subscribe-call adds a NEW symbol, the socket re-sends the full updated `{subscribe: [...]}`
- [ ] When a subscribe-call's symbols are all already-subscribed by others, no extra message is sent

**Verify:** `npm test --workspace @livefolio/yfinance-browser` → all tests pass.

**Steps:**

- [ ] **Step 1: Append failing tests**

Append to `browser/src/yfinance-streaming-data-feed.test.ts`:

```ts
describe('YfinanceStreamingDataFeed — multi-subscriber refcount', () => {
  it('shares one socket across two subscribe() calls', () => {
    const feed = makeFeed();
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    void feed.subscribe([QQQ])[Symbol.asyncIterator]().next();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('delivers ticks for shared symbols to both subscribers', async () => {
    const feed = makeFeed();
    const iterA = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const iterB = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const nextA = iterA.next();
    const nextB = iterB.next();
    latestWS().simulateOpen();
    latestWS().simulateMessage(buildTickerBase64('SPY', 100, 1700000000000));
    const [a, b] = await Promise.all([nextA, nextB]);
    expect((a.value as StreamingBar).bar.close).toBe(100);
    expect((b.value as StreamingBar).bar.close).toBe(100);
    await iterA.return?.();
    await iterB.return?.();
  });

  it('keeps socket open while at least one subscriber remains', async () => {
    const feed = makeFeed();
    const iterA = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const iterB = feed.subscribe([SPY])[Symbol.asyncIterator]();
    void iterA.next();
    void iterB.next();
    latestWS().simulateOpen();

    await iterA.return?.();
    expect(latestWS().readyState).toBe(MockWebSocket.OPEN);

    await iterB.return?.();
    expect(latestWS().readyState).toBe(MockWebSocket.CLOSED);
  });

  it('updates subscription when a subscribe() adds a new symbol', () => {
    const feed = makeFeed();
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    latestWS().simulateOpen();
    expect(latestWS().sent).toEqual([JSON.stringify({ subscribe: ['SPY'] })]);

    void feed.subscribe([QQQ])[Symbol.asyncIterator]().next();
    expect(latestWS().sent).toEqual([
      JSON.stringify({ subscribe: ['SPY'] }),
      JSON.stringify({ subscribe: ['SPY', 'QQQ'] }),
    ]);
  });

  it('does not re-send when a subscribe() adds only already-tracked symbols', () => {
    const feed = makeFeed();
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    latestWS().simulateOpen();
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    expect(latestWS().sent).toEqual([JSON.stringify({ subscribe: ['SPY'] })]);
  });

  it('updates subscription when a refcount drops to zero', async () => {
    const feed = makeFeed();
    const iterA = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const iterB = feed.subscribe([QQQ])[Symbol.asyncIterator]();
    void iterA.next();
    void iterB.next();
    latestWS().simulateOpen();

    await iterA.return?.();
    expect(latestWS().sent).toEqual([
      JSON.stringify({ subscribe: ['SPY', 'QQQ'] }),
      JSON.stringify({ subscribe: ['QQQ'] }),
    ]);
    await iterB.return?.();
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
npm test --workspace @livefolio/yfinance-browser
```

Expected: All tests pass. (The Task-3 implementation already supports refcounting; if a test fails, fix the implementation in `yfinance-streaming-data-feed.ts`.)

- [ ] **Step 3: Commit**

```bash
git add browser/src/yfinance-streaming-data-feed.test.ts browser/src/yfinance-streaming-data-feed.ts
git commit -m "test(browser): verify multi-subscriber refcount semantics"
```

---

## Task 5: Reconnection with backoff + `onStatus` callback

**Goal:** On socket close (not user-initiated), reconnect with exponential backoff (500 → 1000 → ... → 8000 ms cap), reset on successful open, re-send the full active subscription. Emit lifecycle status via the optional `onStatus` callback.

**Files:**
- Modify: `browser/src/yfinance-streaming-data-feed.ts`
- Modify: `browser/src/yfinance-streaming-data-feed.test.ts` (append tests)

**Acceptance Criteria:**
- [ ] After socket close (not user-initiated), reconnect timer fires at base * 2^attempt, capped at maxDelay
- [ ] Successful reconnect resets the attempt counter
- [ ] On reconnect, the new socket receives the full `{subscribe: [...active symbols]}` after `onopen`
- [ ] `onStatus('reconnecting')` fires when a new socket is being constructed (initial connect AND reconnect)
- [ ] `onStatus('connected')` fires on `onopen`
- [ ] `onStatus('disconnected')` fires on `onclose`
- [ ] `onStatus` callback throwing does not break the feed
- [ ] Constructor accepts `reconnectBaseDelayMs` (default 500) and `maxReconnectDelayMs` (default 8000)
- [ ] Iterator stays alive across the reconnect gap (no `done:true` emitted, waiters remain pending)

**Verify:** `npm test --workspace @livefolio/yfinance-browser` → all tests pass.

**Steps:**

- [ ] **Step 1: Append failing tests**

Append to `browser/src/yfinance-streaming-data-feed.test.ts`:

```ts
describe('YfinanceStreamingDataFeed — reconnect + onStatus', () => {
  it('emits status lifecycle on initial connect', () => {
    const statuses: string[] = [];
    const feed = makeFeed({ onStatus: (s) => statuses.push(s) });
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    expect(statuses).toEqual(['reconnecting']);
    latestWS().simulateOpen();
    expect(statuses).toEqual(['reconnecting', 'connected']);
    latestWS().simulateClose();
    expect(statuses).toEqual(['reconnecting', 'connected', 'disconnected']);
  });

  it('reconnects with exponential backoff', () => {
    const feed = makeFeed();
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    latestWS().simulateOpen();
    latestWS().simulateClose();

    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Second failure → backs off to 1000 ms
    latestWS().simulateClose();
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);

    // Third failure → 2000 ms
    latestWS().simulateClose();
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  it('caps reconnect delay at maxReconnectDelayMs', () => {
    const feed = makeFeed({ reconnectBaseDelayMs: 1000, maxReconnectDelayMs: 4000 });
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    latestWS().simulateOpen();

    // Drive several failed reconnects
    for (let i = 0; i < 6; i++) {
      latestWS().simulateClose();
      vi.advanceTimersByTime(4000);
    }
    // Next attempt should still fire within 4000 ms (capped)
    const before = MockWebSocket.instances.length;
    latestWS().simulateClose();
    vi.advanceTimersByTime(4000);
    expect(MockWebSocket.instances.length).toBe(before + 1);
  });

  it('resets backoff on successful connect', () => {
    const feed = makeFeed();
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    latestWS().simulateOpen();
    latestWS().simulateClose();

    vi.advanceTimersByTime(500);
    expect(MockWebSocket.instances).toHaveLength(2);
    latestWS().simulateOpen();
    latestWS().simulateClose();

    // After successful connect+close, next attempt should be 500 ms again
    vi.advanceTimersByTime(500);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('re-sends full subscription after reconnect', () => {
    const feed = makeFeed();
    void feed.subscribe([SPY, QQQ])[Symbol.asyncIterator]().next();
    latestWS().simulateOpen();
    latestWS().simulateClose();

    vi.advanceTimersByTime(500);
    latestWS().simulateOpen();

    expect(latestWS().sent).toEqual([JSON.stringify({ subscribe: ['SPY', 'QQQ'] })]);
  });

  it('keeps iterator alive across reconnect gap', async () => {
    const feed = makeFeed();
    const iter = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const next = iter.next();
    latestWS().simulateOpen();
    latestWS().simulateClose();

    vi.advanceTimersByTime(500);
    latestWS().simulateOpen();
    latestWS().simulateMessage(buildTickerBase64('SPY', 1, 1700000000000));

    const result = await next;
    expect(result.done).toBe(false);
    await iter.return?.();
  });

  it('isolates throwing onStatus callback', () => {
    const feed = makeFeed({
      onStatus: () => {
        throw new Error('bad');
      },
    });
    expect(() => {
      void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
      latestWS().simulateOpen();
      latestWS().simulateClose();
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to see what fails**

```bash
npm test --workspace @livefolio/yfinance-browser
```

Expected: New reconnect tests fail — backoff timer not implemented, `onStatus` not wired.

- [ ] **Step 3: Implement reconnect + onStatus**

Modify `browser/src/yfinance-streaming-data-feed.ts`:

a) Extend the options type:

```ts
export type YfinanceStreamingDataFeedOptions = {
  webSocketFactory?: (url: string) => WebSocket;
  url?: string;
  reconnectBaseDelayMs?: number;
  maxReconnectDelayMs?: number;
  onStatus?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
};
```

b) Add fields to the class:

```ts
  private readonly reconnectBaseDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly onStatus: ((s: 'connected' | 'reconnecting' | 'disconnected') => void) | undefined;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
```

c) Initialise them in the constructor:

```ts
  constructor(opts: YfinanceStreamingDataFeedOptions = {}) {
    this.url = opts.url ?? DEFAULT_URL;
    this.webSocketFactory = opts.webSocketFactory ?? ((url) => new WebSocket(url));
    this.reconnectBaseDelayMs = opts.reconnectBaseDelayMs ?? 500;
    this.maxReconnectDelayMs = opts.maxReconnectDelayMs ?? 8000;
    this.onStatus = opts.onStatus;
  }
```

d) Add an `emitStatus` helper:

```ts
  private emitStatus(s: 'connected' | 'reconnecting' | 'disconnected'): void {
    if (!this.onStatus) return;
    try {
      this.onStatus(s);
    } catch {
      // Listener errors are swallowed to keep the feed alive.
    }
  }
```

e) Update `openSocketIfNeeded` to emit `'reconnecting'` and reset the attempt counter on `onopen`, and to schedule a reconnect on `onclose` (when subscribers remain):

```ts
  private openSocketIfNeeded(): void {
    if (this.socket) return;
    this.clearReconnect();
    this.emitStatus('reconnecting');

    const socket = this.webSocketFactory(this.url);
    this.socket = socket;

    socket.onopen = (): void => {
      this.reconnectAttempt = 0;
      this.emitStatus('connected');
      this.sendSubscribe();
    };
    socket.onmessage = (event: MessageEvent): void => {
      if (typeof event.data !== 'string') return;
      const bytes = base64ToBytes(event.data);
      const ticker = decodeTicker(bytes);
      if (ticker.id === '') return;
      this.dispatchTick(ticker);
    };
    socket.onerror = (): void => {};
    socket.onclose = (): void => {
      this.socket = null;
      this.emitStatus('disconnected');
      if (this.subscribers.size > 0) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delayMs = Math.min(
      this.maxReconnectDelayMs,
      this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempt++),
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocketIfNeeded();
    }, delayMs);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
```

f) Update `closeSocket` to also clear the reconnect timer:

```ts
  private closeSocket(): void {
    this.clearReconnect();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }
```

- [ ] **Step 4: Re-run tests to verify they pass**

```bash
npm test --workspace @livefolio/yfinance-browser
```

Expected: All tests pass — happy-path, refcount, and reconnect.

- [ ] **Step 5: Commit**

```bash
git add browser/src/yfinance-streaming-data-feed.ts browser/src/yfinance-streaming-data-feed.test.ts
git commit -m "feat(browser): reconnect with backoff and onStatus callback"
```

---

## Task 6: `onError` + `close()`

**Goal:** Surface decode failures and socket errors via the optional `onError` callback (iterator never throws). Add a public `close()` method that terminates all iterators cleanly and prevents further reconnects.

**Files:**
- Modify: `browser/src/yfinance-streaming-data-feed.ts`
- Modify: `browser/src/yfinance-streaming-data-feed.test.ts` (append tests)

**Acceptance Criteria:**
- [ ] `onError(Error)` fires on decode failure (e.g. invalid base64); next message processed normally
- [ ] `onError(Error)` fires on WebSocket `onerror` event
- [ ] Throwing `onError` does not break the feed
- [ ] `close()` resolves all pending waiters with `{done:true}`
- [ ] After `close()`, advancing fake timers creates no new sockets (reconnect cancelled)
- [ ] After `close()`, calling `subscribe()` returns an immediately-done iterator
- [ ] `close()` is idempotent

**Verify:** `npm test --workspace @livefolio/yfinance-browser` → all tests pass.

**Steps:**

- [ ] **Step 1: Append failing tests**

Append to `browser/src/yfinance-streaming-data-feed.test.ts`:

```ts
describe('YfinanceStreamingDataFeed — onError + close()', () => {
  it('emits error on decode failure and continues', async () => {
    const errors: Error[] = [];
    const feed = makeFeed({ onError: (e) => errors.push(e) });
    const iter = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const next = iter.next();
    latestWS().simulateOpen();
    latestWS().simulateMessage('not-valid-base64!!!');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);

    latestWS().simulateMessage(buildTickerBase64('SPY', 1, 1700000000000));
    const result = await next;
    expect(result.done).toBe(false);
    await iter.return?.();
  });

  it('emits error on WebSocket error event', () => {
    const errors: Error[] = [];
    const feed = makeFeed({ onError: (e) => errors.push(e) });
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    latestWS().simulateError(new Error('connection refused'));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/connection refused|WebSocket error/);
  });

  it('isolates throwing onError callback', () => {
    const feed = makeFeed({
      onError: () => {
        throw new Error('bad listener');
      },
    });
    expect(() => {
      void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
      latestWS().simulateOpen();
      latestWS().simulateMessage('not-valid-base64!!!');
    }).not.toThrow();
  });

  it('close() terminates pending iterators with done:true', async () => {
    const feed = makeFeed();
    const iter = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const next = iter.next();
    latestWS().simulateOpen();

    feed.close();
    const result = await next;
    expect(result.done).toBe(true);
  });

  it('close() prevents reconnect', () => {
    const feed = makeFeed();
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    latestWS().simulateOpen();
    feed.close();

    vi.advanceTimersByTime(10000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('subscribe() after close() returns an immediately-done iterator', async () => {
    const feed = makeFeed();
    feed.close();
    const iter = feed.subscribe([SPY])[Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result.done).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('close() is idempotent', () => {
    const feed = makeFeed();
    void feed.subscribe([SPY])[Symbol.asyncIterator]().next();
    latestWS().simulateOpen();
    expect(() => {
      feed.close();
      feed.close();
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to see what fails**

```bash
npm test --workspace @livefolio/yfinance-browser
```

Expected: New tests fail — `onError` not wired, `close()` not implemented.

- [ ] **Step 3: Implement `onError` and `close()`**

Modify `browser/src/yfinance-streaming-data-feed.ts`:

a) Extend the options type:

```ts
export type YfinanceStreamingDataFeedOptions = {
  webSocketFactory?: (url: string) => WebSocket;
  url?: string;
  reconnectBaseDelayMs?: number;
  maxReconnectDelayMs?: number;
  onStatus?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
  onError?: (error: Error) => void;
};
```

b) Add fields:

```ts
  private readonly onError: ((e: Error) => void) | undefined;
  private closed = false;
```

c) Initialise in constructor:

```ts
    this.onError = opts.onError;
```

d) Add the `emitError` helper:

```ts
  private emitError(error: unknown): void {
    if (!this.onError) return;
    const err = error instanceof Error ? error : new Error(String(error));
    try {
      this.onError(err);
    } catch {
      // Listener errors are swallowed.
    }
  }
```

e) Wrap decode in try/catch inside `onmessage`:

```ts
    socket.onmessage = (event: MessageEvent): void => {
      if (typeof event.data !== 'string') return;
      try {
        const bytes = base64ToBytes(event.data);
        const ticker = decodeTicker(bytes);
        if (ticker.id === '') return;
        this.dispatchTick(ticker);
      } catch (err) {
        this.emitError(err);
      }
    };
```

f) Wire `onerror`:

```ts
    socket.onerror = (event: Event): void => {
      this.emitError(event instanceof Error ? event : new Error('WebSocket error'));
    };
```

g) Make `subscribe()` short-circuit when `closed`:

At the very top of `subscribe()`, before doing any work:

```ts
    if (this.closed) {
      return {
        [Symbol.asyncIterator](): AsyncIterator<StreamingBar> {
          return {
            next: () => Promise.resolve({ value: undefined as never, done: true }),
            return: () => Promise.resolve({ value: undefined as never, done: true }),
          };
        },
      };
    }
```

h) Add the public `close()` method:

```ts
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearReconnect();
    for (const subscriber of this.subscribers) {
      if (subscriber.done) continue;
      subscriber.done = true;
      if (subscriber.waiter) {
        const waiter = subscriber.waiter;
        subscriber.waiter = null;
        waiter.resolve({ value: undefined as never, done: true });
      }
    }
    this.subscribers.clear();
    this.refCounts.clear();
    this.closeSocket();
  }
```

i) Guard `scheduleReconnect` when closed:

In `onclose`:

```ts
    socket.onclose = (): void => {
      this.socket = null;
      this.emitStatus('disconnected');
      if (!this.closed && this.subscribers.size > 0) {
        this.scheduleReconnect();
      }
    };
```

- [ ] **Step 4: Re-run tests to verify they pass**

```bash
npm test --workspace @livefolio/yfinance-browser
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add browser/src/yfinance-streaming-data-feed.ts browser/src/yfinance-streaming-data-feed.test.ts
git commit -m "feat(browser): add onError callback and close() method"
```

---

## Task 7: Public `index.ts` and final verification

**Goal:** Publish the intended public surface, run lint/format/build/test as a final gate, and commit.

**Files:**
- Modify: `browser/src/index.ts`
- Modify: `package.json` (root) — bump description if needed (already references `-browser`, no change required)

**Acceptance Criteria:**
- [ ] `browser/src/index.ts` exports `YfinanceStreamingDataFeed`, `YfinanceStreamingDataFeedOptions`, `assetToYahooSymbol`, `decodeTicker`, `Ticker`
- [ ] `npm run build --workspace @livefolio/yfinance-browser` produces `dist/index.js` and `dist/index.d.ts` containing all five exports
- [ ] `npm run lint --workspace @livefolio/yfinance-browser` passes
- [ ] `npm run format:check --workspace @livefolio/yfinance-browser` passes
- [ ] `npm test --workspace @livefolio/yfinance-browser` passes
- [ ] `npm test` at the repo root still passes (no regression on `@livefolio/yfinance`)

**Verify:**
```bash
npm run lint --workspace @livefolio/yfinance-browser && \
npm run format:check --workspace @livefolio/yfinance-browser && \
npm test --workspace @livefolio/yfinance-browser && \
npm run build --workspace @livefolio/yfinance-browser && \
npm test
```
Expected: all five commands exit 0; `browser/dist/index.d.ts` lists the five exports.

**Steps:**

- [ ] **Step 1: Replace placeholder index**

Replace `browser/src/index.ts`:

```ts
export { YfinanceStreamingDataFeed } from './yfinance-streaming-data-feed';
export type { YfinanceStreamingDataFeedOptions } from './yfinance-streaming-data-feed';
export { assetToYahooSymbol } from './asset';
export { decodeTicker } from './decode-ticker';
export type { Ticker } from './decode-ticker';
```

- [ ] **Step 2: Run format and lint, fix any issues**

```bash
npm run format --workspace @livefolio/yfinance-browser
npm run lint --workspace @livefolio/yfinance-browser
```

Expected: format updates files in-place if needed; lint exits 0. If lint reports issues, fix them inline.

- [ ] **Step 3: Build and inspect the dist**

```bash
npm run build --workspace @livefolio/yfinance-browser
cat browser/dist/index.d.ts
```

Expected: `dist/index.d.ts` re-exports `YfinanceStreamingDataFeed`, `YfinanceStreamingDataFeedOptions`, `assetToYahooSymbol`, `decodeTicker`, `Ticker`.

- [ ] **Step 4: Run the full verify command**

```bash
npm run lint --workspace @livefolio/yfinance-browser && \
npm run format:check --workspace @livefolio/yfinance-browser && \
npm test --workspace @livefolio/yfinance-browser && \
npm run build --workspace @livefolio/yfinance-browser && \
npm test
```

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add browser/src/index.ts
git commit -m "feat(browser): publish YfinanceStreamingDataFeed public surface"
```

---

## Done — what's shipped

- `@livefolio/yfinance-browser@0.1.0` — workspace under `yfinance/browser/`, ready to publish.
- One class `YfinanceStreamingDataFeed implements StreamingDataFeed`.
- Single shared WebSocket per instance; refcounted multi-subscriber fan-out.
- Exponential-backoff reconnect with `onStatus` and `onError` callbacks.
- Iterator never throws; `close()` terminates cleanly.
- Co-located unit tests covering happy path, refcount, reconnect, error surfacing, and close.
- Public exports: `YfinanceStreamingDataFeed`, `YfinanceStreamingDataFeedOptions`, `assetToYahooSymbol`, `decodeTicker`, `Ticker`.

What this plan does NOT do (deferred per spec):
- Bounded queue / drop-oldest backpressure.
- Live integration test against `wss://streamer.finance.yahoo.com/`.
- Tick deduplication across reconnects.
- Non-equity asset support.
