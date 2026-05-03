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
