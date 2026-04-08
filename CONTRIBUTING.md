# Contributing

Thanks for your interest in contributing to tradingview-mcp.

## Scope

This tool is a local bridge between Codex and the TradingView Desktop app
running on your machine. Contributions should stay within that boundary.

### What is in scope

- Improving reliability of existing tools
- Better selectors, error handling, and timeouts
- Adding CLI commands that mirror existing MCP tool capabilities
- Bug fixes and test coverage
- Documentation improvements
- Pine Script workflow enhancements
- UI automation for the locally running TradingView Desktop app

### What is out of scope

Contributions must not add features that:

- Connect directly to TradingView servers
- Bypass authentication or subscription restrictions
- Scrape, cache, or redistribute market data
- Enable automated trading or order execution
- Reverse-engineer or redistribute TradingView's proprietary code
- Access other users' private data

If you are unsure whether a feature fits, open an issue before submitting a PR.

## Development

```bash
npm install
npm test:unit
tv status
```

`tv status` requires TradingView Desktop to be running with CDP enabled.

## Pull Requests

- Keep changes focused
- Add tests for new functionality when possible
- Make sure the relevant test command passes
- Test against a live TradingView Desktop instance before submitting

