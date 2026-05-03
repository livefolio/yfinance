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
  reconnectBaseDelayMs?: number;
  maxReconnectDelayMs?: number;
  onStatus?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
  onError?: (error: Error) => void;
};

export class YfinanceStreamingDataFeed implements StreamingDataFeed {
  private readonly url: string;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly reconnectBaseDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly onStatus: ((s: 'connected' | 'reconnecting' | 'disconnected') => void) | undefined;
  private readonly onError: ((e: Error) => void) | undefined;
  private readonly subscribers = new Set<Subscriber>();
  private readonly refCounts = new Map<string, number>();
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(opts: YfinanceStreamingDataFeedOptions = {}) {
    this.url = opts.url ?? DEFAULT_URL;
    this.webSocketFactory = opts.webSocketFactory ?? ((url) => new WebSocket(url));
    this.reconnectBaseDelayMs = opts.reconnectBaseDelayMs ?? 500;
    this.maxReconnectDelayMs = opts.maxReconnectDelayMs ?? 8000;
    this.onStatus = opts.onStatus;
    this.onError = opts.onError;
  }

  subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar> {
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

    const removeSubscriber = (s: Subscriber): void => this.removeSubscriber(s);
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
            removeSubscriber(subscriber);
            return Promise.resolve({ value: undefined as never, done: true });
          },
        };
      },
    };
  }

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
      try {
        const bytes = base64ToBytes(event.data);
        const ticker = decodeTicker(bytes);
        if (ticker.id === '') return;
        this.dispatchTick(ticker);
      } catch (err) {
        this.emitError(err);
      }
    };
    socket.onerror = (event: Event): void => {
      this.emitError(event instanceof Error ? event : new Error('WebSocket error'));
    };
    socket.onclose = (): void => {
      this.socket = null;
      this.emitStatus('disconnected');
      if (!this.closed && this.subscribers.size > 0) {
        this.scheduleReconnect();
      }
    };
  }

  private emitStatus(s: 'connected' | 'reconnecting' | 'disconnected'): void {
    if (!this.onStatus) return;
    try {
      this.onStatus(s);
    } catch {
      // Listener errors are swallowed to keep the feed alive.
    }
  }

  private emitError(error: unknown): void {
    if (!this.onError) return;
    const err = error instanceof Error ? error : new Error(String(error));
    try {
      this.onError(err);
    } catch {
      // Listener errors are swallowed.
    }
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
    this.clearReconnect();
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
