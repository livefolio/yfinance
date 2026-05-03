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
