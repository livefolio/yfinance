import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defaultDeps, type ServerDeps } from './deps';
import { registerQuoteTools } from './tools/quote';

export type { ServerDeps } from './deps';

export const SERVER_NAME = 'yfinance';
export const SERVER_VERSION = '0.1.0';

/** Build the MCP server with all tools registered. `deps` defaults to the real
 *  adapter exports; tests inject stubs for offline runs. Does not connect a
 *  transport — the caller does that. */
export function createServer(deps: ServerDeps = defaultDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerQuoteTools(server, deps);
  return server;
}
