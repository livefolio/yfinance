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
    const bytes = build([encodeString(1, 'SPY'), encodeFloat(2, 450.25), encodeSint64Field(3, 1700000000000)]);
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
    const bytes = build([encodeString(1, ''), encodeFloat(2, 0), encodeSint64Field(3, 0)]);
    const ticker = decodeTicker(bytes);
    expect(ticker.id).toBe('');
    expect(ticker.price).toBe(0);
    expect(ticker.time).toBe(0);
  });

  it('round-trips negative time (zigzag)', () => {
    const bytes = build([encodeString(1, 'SPY'), encodeFloat(2, 1), encodeSint64Field(3, -1)]);
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
    const bytes = new Uint8Array([...encodeString(1, 'SPY'), ...encodeTag(99, 3)]);
    const ticker = decodeTicker(bytes);
    expect(ticker.id).toBe('SPY');
  });
});
