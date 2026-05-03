import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Asset, StreamingBar } from '@livefolio/sdk';
import { YfinanceStreamingDataFeed } from './yfinance-streaming-data-feed';

// --- Encoder helpers (same shape as decode-ticker.test.ts) ---

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
