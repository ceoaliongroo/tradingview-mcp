# TradingView MCP - Codex Instructions

This repository exposes a local MCP bridge between Codex and TradingView Desktop.
The server communicates over stdio with Codex and uses Chrome DevTools Protocol
(CDP) on `localhost:9222` to read and control the local TradingView app.

## Core rule

Treat the locally running TradingView Desktop application as the source of truth.
Do not assume any direct TradingView server integration is required when a local
CDP or UI-based path already exists.

## Tool selection

- "What is on my chart right now?" -> `chart_get_state`, `data_get_study_values`, `quote_get`
- "What levels, labels, tables, or zones are visible?" -> `data_get_pine_lines`, `data_get_pine_labels`, `data_get_pine_tables`, `data_get_pine_boxes` with `study_filter`
- "Read price history" -> `data_get_ohlcv` with `summary=true` unless individual bars are required
- "Change the chart" -> `chart_set_symbol`, `chart_set_timeframe`, `chart_set_type`, `chart_manage_indicator`, `chart_scroll_to_date`, `chart_set_visible_range`
- "Work on Pine Script" -> `pine_set_source`, `pine_smart_compile`, `pine_get_errors`, `pine_get_console`, `pine_check`
- "Use replay mode" -> `replay_start`, `replay_step`, `replay_autoplay`, `replay_trade`, `replay_status`, `replay_stop`
- "Draw, alert, or inspect the UI" -> `draw_shape`, `draw_list`, `capture_screenshot`, `ui_*`, `watchlist_*`, `pane_*`, `tab_*`
- "Launch or verify TradingView" -> `tv_launch`, `tv_health_check`, `tv_discover`

## Context management

- Prefer compact outputs by default.
- Always use `summary=true` on `data_get_ohlcv` unless detailed bars are needed.
- Always use `study_filter` on Pine graphics tools when the target study is known.
- Avoid `pine_get_source` for large scripts unless you are actively editing them.
- Call `chart_get_state` once at the beginning of a chart-analysis workflow.
- Prefer screenshots over large data dumps when visual confirmation is enough.

## Project layout

- `src/server.js` wires the MCP server and registers the tool groups.
- `src/core/` contains the shared TradingView and CDP logic.
- `src/tools/` exposes the MCP tool wrappers.
- `src/cli/` mirrors the same capabilities as the `tv` command.
- `docs/` contains the migration plan and architecture notes.

## Legacy note

`CLAUDE.md` is kept for backward compatibility only. Codex should use this file.

