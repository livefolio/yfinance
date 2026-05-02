import { describe, it, expect } from 'vitest';
import type { Asset } from '@livefolio/sdk';
import { assetToYahooSymbol } from './asset';

describe('assetToYahooSymbol', () => {
  it('passes through a plain equity symbol', () => {
    const asset: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };
    expect(assetToYahooSymbol(asset)).toBe('SPY');
  });

  it('converts dot to hyphen for class shares (BRK.B → BRK-B)', () => {
    const asset: Asset = { kind: 'equity', id: 'us:BRK.B', symbol: 'BRK.B' };
    expect(assetToYahooSymbol(asset)).toBe('BRK-B');
  });

  it('handles multi-dot symbols by replacing all dots with hyphens', () => {
    const asset: Asset = { kind: 'equity', id: 'us:RDS.A', symbol: 'RDS.A' };
    expect(assetToYahooSymbol(asset)).toBe('RDS-A');
  });

  it('throws for non-equity kinds', () => {
    const asset = { kind: 'crypto', id: 'btc', symbol: 'BTC-USD' } as unknown as Asset;
    expect(() => assetToYahooSymbol(asset)).toThrow(/unsupported asset kind/i);
  });
});
