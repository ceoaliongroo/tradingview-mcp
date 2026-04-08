# Setup Guide for Codex

This guide explains how to install and configure TradingView MCP for Codex.
The server is the same MCP bridge used by the CLI; the only thing that changes
for Codex is the MCP client configuration file.

## Step 1: Clone and install

```bash
git clone https://github.com/ceoaliongroo/tradingview-mcp.git ~/tradingview-mcp
cd ~/tradingview-mcp
npm install
```

If the user wants a different install path, use that path instead of
`~/tradingview-mcp`.

## Step 2: Add the server to Codex

Edit `~/.codex/config.toml` and add:

```toml
[mcp_servers.tradingview]
command = "node"
args = ["<INSTALL_PATH>/src/server.js"]
```

Replace `<INSTALL_PATH>` with the absolute path where the repository was
cloned.

If `config.toml` already has other MCP servers, merge the `tradingview` entry
into the existing `mcp_servers` table.

## Step 3: Launch TradingView Desktop

TradingView Desktop must run with Chrome DevTools Protocol enabled.

**Auto-detect and launch**

The MCP server exposes `tv_launch`, which can auto-detect TradingView on macOS,
Windows, and Linux.

**Manual launch by platform**

macOS:

```bash
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222
```

Windows:

```bash
%LOCALAPPDATA%\TradingView\TradingView.exe --remote-debugging-port=9222
```

Linux:

```bash
/opt/TradingView/tradingview --remote-debugging-port=9222
# or: tradingview --remote-debugging-port=9222
```

## Step 4: Restart Codex

Codex loads MCP servers on startup. After editing `config.toml`:

1. Exit Codex
2. Start Codex again
3. Wait for the tradingview MCP server to appear

## Step 5: Verify the connection

Run `tv_health_check` from Codex.

Expected output:

```json
{
  "success": true,
  "cdp_connected": true,
  "chart_symbol": "...",
  "api_available": true
}
```

If `cdp_connected` is `false`, TradingView is not running with the remote
debugging port enabled.

## Step 6: Install the CLI (optional)

```bash
cd ~/tradingview-mcp
npm link
```

Then `tv status`, `tv quote`, `tv pine compile`, and the rest of the CLI
commands work from anywhere.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `cdp_connected: false` | Launch TradingView with `--remote-debugging-port=9222` |
| `ECONNREFUSED` | TradingView is not running or port 9222 is blocked |
| MCP server not showing in Codex | Check `~/.codex/config.toml`, then restart Codex |
| `tv` command not found | Run `npm link` from the project directory |
| Tools return stale data | TradingView may still be loading - wait a few seconds |
| Pine editor tools fail | Open the Pine Editor panel first (`ui_open_panel pine-editor open`) |

## What to read next

- `AGENTS.md` - Codex instructions for working in this repository
- `docs/arquitectura-codex.md` - Spanish architecture overview and diagram
- `README.md` - Full English overview and installation steps
- `README.es.md` - Spanish companion README

