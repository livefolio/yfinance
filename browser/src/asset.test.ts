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
