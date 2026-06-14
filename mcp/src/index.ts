import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';

// stdout is the JSON-RPC channel for the stdio transport — log only to stderr.
const logErr = (msg: string): void => {
  process.stderr.write(`yfinance-mcp: ${msg}\n`);
};

process.on('unhandledRejection', (reason) => {
  logErr(`unhandledRejection: ${String(reason)}`);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logErr(`uncaughtException: ${(err as Error).message}`);
  process.exit(1);
});

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logErr('server connected over stdio');
}

main().catch((err) => {
  logErr(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
