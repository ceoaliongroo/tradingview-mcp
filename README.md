# TradingView MCP Bridge for Codex

TradingView MCP is a local bridge between Codex and TradingView Desktop. It
uses the Model Context Protocol (MCP) over `stdio` and Chrome DevTools Protocol
(CDP) on `localhost:9222` to read and control the TradingView app running on
your machine.

Spanish version: [README.es.md](README.es.md)

> [!WARNING]
> This tool is not affiliated with, endorsed by, or associated with TradingView
> Inc. It interacts only with your locally running TradingView Desktop
> application via CDP.

> [!IMPORTANT]
> You need a valid TradingView subscription. This tool does not bypass paywalls
> or access controls, and it only works when the desktop app is installed and
> running with remote debugging enabled.

> [!NOTE]
> All processing happens locally on your machine. This project does not send
> your TradingView data to its own backend.

> [!CAUTION]
> This tool uses undocumented TradingView internals exposed through the Electron
> debug interface. Those internals can change without notice in any TradingView
> update.

## How It Works

The server talks to Codex over MCP, then uses CDP to interact with the local
TradingView Desktop instance. It reads chart state, controls UI elements, and
can also use some TradingView public endpoints when a tool needs them.

The important boundary is simple:

- no direct connection to TradingView servers for chart control
- no local market-data storage
- no automated trading
- no dependency on a separate cloud service to run the MCP bridge itself

## What It Can Do

This server exposes 78 MCP tools and a matching `tv` CLI with 28 commands.

- Chart reading and control: symbol, timeframe, chart type, visible range
- Market data: quote, OHLCV, indicator values, DOM/depth
- Pine Script: edit, compile, analyze, inspect errors, read logs, save, open
- Chart annotations: drawings, alerts, watchlists, panes, tabs
- Replay and streaming: replay mode, trade simulation, JSONL streams
- Screenshots and UI automation
- Batch workflows across symbols and timeframes

## Requirements

- TradingView Desktop
- Node.js 18 or newer
- Codex with MCP support
- Windows, macOS, or Linux

## Install with Codex

### 1. Clone and install

```bash
git clone https://github.com/ceoaliongroo/tradingview-mcp.git
cd tradingview-mcp
npm install
```

### 2. Launch TradingView with CDP

TradingView Desktop must be running with Chrome DevTools Protocol enabled on
port `9222`.

**macOS**

```bash
./scripts/launch_tv_debug_mac.sh
```

**Windows**

```bash
scripts\launch_tv_debug.bat
```

**Linux**

```bash
./scripts/launch_tv_debug_linux.sh
```

**Manual launch**

```bash
/path/to/TradingView --remote-debugging-port=9222
```

You can also ask Codex to launch it via the MCP tool:

> "Use `tv_launch` to start TradingView in debug mode."

### 3. Register the MCP server in Codex

Add this entry to `~/.codex/config.toml`:

```toml
[mcp_servers.tradingview]
command = "node"
args = ["/absolute/path/to/tradingview-mcp/src/server.js"]
```

If you already have other MCP servers configured, merge this entry into the
existing `mcp_servers` section.

### 4. Restart Codex

Codex loads the config on startup. Restart the app or the current session after
editing `config.toml`.

### 5. Verify the connection

Ask Codex to run `tv_health_check`.

You should see a JSON response with `cdp_connected: true`, the current chart
symbol, and the active resolution.

## CLI

Every MCP tool is also available through the `tv` CLI.

```bash
npm link
node src/cli/index.js --help
```

Examples:

```bash
tv status
tv launch
tv state
tv symbol AAPL
tv quote
tv ohlcv --summary
tv pine analyze --file script.pine
tv replay start --date 2025-03-01
```

## Tool Families

The MCP surface is grouped into the following families:

- `health` - connection, discovery, launch, UI state
- `chart` - state, symbol, timeframe, visible range, symbol search
- `data` - quote, OHLCV, indicator values, Pine graphics, strategy data
- `pine` - source, compile, analyze, errors, console, list/open/save
- `drawing` - create, list, inspect, remove, clear drawings
- `alerts` - create, list, delete alerts
- `watchlist` - get and add symbols
- `pane` - list, layout, focus, set symbol
- `tab` - list, create, close, switch
- `replay` - start, step, autoplay, trade, status, stop
- `ui` - click, open panel, fullscreen, keyboard, mouse, hover, scroll
- `capture` - screenshots
- `batch` - repeat actions across symbols and timeframes
- `stream` - JSONL streaming for quotes, bars, values, lines, labels, tables, and all panes

## Architecture

```text
Codex <-> MCP server (stdio) <-> CDP (localhost:9222) <-> TradingView Desktop
```

For the detailed Spanish architecture notes, see:

- [docs/arquitectura-codex.md](docs/arquitectura-codex.md)
- [docs/plan-migracion-codex.md](docs/plan-migracion-codex.md)
- [README.es.md](README.es.md)
- [AGENTS.md](AGENTS.md)

## Development

```bash
npm test:unit
```

The end-to-end tests require TradingView Desktop to be running with CDP
enabled.

## Disclaimer

This project is provided for personal, educational, and research purposes
only.

You are responsible for ensuring your use complies with TradingView's Terms of
Use and all applicable laws. The authors are not responsible for account bans,
suspensions, or other consequences resulting from use of this software.

## License

MIT - see [LICENSE](LICENSE) for details.
