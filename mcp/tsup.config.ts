import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  external: ['@livefolio/sdk', '@livefolio/yfinance', '@modelcontextprotocol/sdk', 'zod', 'yahoo-finance2'],
});
