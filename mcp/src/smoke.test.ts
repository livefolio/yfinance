import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../dist/index.js', import.meta.url));

type Rpc = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: unknown };

/** Drive the bin over stdio: send the requests, resolve when a response with
 *  `id === stopAtId` arrives. Parses newline-delimited JSON from stdout. */
async function driveBin(requests: Rpc[], stopAtId: number): Promise<Rpc[]> {
  const child = spawn('node', [BIN], { stdio: ['pipe', 'pipe', 'pipe'] });
  const responses: Rpc[] = [];
  let buf = '';
  const done = new Promise<void>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === '') continue;
        const msg = JSON.parse(line) as Rpc;
        responses.push(msg);
        if (msg.id === stopAtId) resolve();
      }
    });
  });
  for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
  await Promise.race([done, once(child, 'exit').then(() => undefined)]);
  child.kill();
  return responses;
}

describe('bin smoke test', () => {
  it('responds to initialize and lists the three tools over stdio', async () => {
    const responses = await driveBin(
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'smoke', version: '0.0.0' },
          },
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ],
      2,
    );
    const list = responses.find((r) => r.id === 2);
    expect(list).toBeDefined();
    const names = (list!.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_daily_bars', 'get_quote', 'get_quotes']);
  }, 20000);
});
