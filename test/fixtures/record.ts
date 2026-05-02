#!/usr/bin/env node
/**
 * Fixture recorder. Hits the live Yahoo Finance API and writes JSON snapshots
 * to `test/fixtures/<symbol>-<from-year>-<to-year>.json`. Run by hand:
 *
 *     npx tsx test/fixtures/record.ts
 *
 * CI never executes this file. Re-run only when a new test needs new fixtures.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchYahooBars } from '../../src/yahoo-client';

type FixtureRequest = { symbol: string; from: string; to: string };

const FIXTURES: FixtureRequest[] = [
  { symbol: 'SPY', from: '2020-01-01', to: '2026-05-02' },
  { symbol: 'QQQ', from: '2020-01-01', to: '2026-05-02' },
  { symbol: 'IEF', from: '2020-01-01', to: '2026-05-02' },
];

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  await mkdir(here, { recursive: true });

  for (const { symbol, from, to } of FIXTURES) {
    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T00:00:00Z`);
    process.stdout.write(`Fetching ${symbol} ${from}..${to}...`);
    const bars = await fetchYahooBars(symbol, { from: fromDate, to: toDate }, '1d');
    const fromYear = fromDate.getUTCFullYear();
    const toYear = toDate.getUTCFullYear();
    const out = resolve(here, `${symbol}-${fromYear}-${toYear}.json`);
    const payload = {
      symbol,
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      bars: bars.map((b) => ({ ...b, t: b.t.toISOString() })),
    };
    await writeFile(out, JSON.stringify(payload, null, 2));
    process.stdout.write(` ${bars.length} bars → ${out}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
