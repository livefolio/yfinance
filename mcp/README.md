# @livefolio/yfinance-mcp

Local stdio [Model Context Protocol](https://modelcontextprotocol.io) server exposing
[`@livefolio/yfinance`](https://github.com/livefolio/yfinance) read-only Yahoo Finance
data — latest quotes and historical daily bars — as agent-callable tools.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `get_quote` | `symbol` | Latest quote (freshest of pre/regular/post-market): `price`, `time`, optional `currency`/`bid`/`ask`. |
| `get_quotes` | `symbols[]` (1–50) | One quote per symbol, in input order, in a single round-trip. Fails if any symbol is unknown. |
| `get_daily_bars` | `symbol`, `from`, `to` (`YYYY-MM-DD`), optional `includeIncompleteToday` | Total-return-adjusted daily OHLCV bars (UTC-midnight days). `1d` only. |

All three are **read-only** (`readOnlyHint: true`) and reach an external service (`openWorldHint: true`).
Equities only. Bars are total-return-adjusted (splits/dividends baked into OHLC; volume raw),
which is correct for analysis/backtests — not for live order placement.

## Install / run

```sh
npx @livefolio/yfinance-mcp
```

The process speaks MCP over stdio; spawn it from an MCP client.

### Claude Code

```sh
claude mcp add yfinance -- npx -y @livefolio/yfinance-mcp
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "yfinance": {
      "command": "npx",
      "args": ["-y", "@livefolio/yfinance-mcp"]
    }
  }
}
```

## License

MIT
