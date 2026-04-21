# Vwap MantillaPB Snapshot Documentation

This folder documents the current version of the `Vwap MantillaPB` DVA snapshot exposed by the MCP server.

## Current version

- `schema_version`: `v7`
- `source`: `vwap_dva_snapshot_v7`
- Primary MCP tool: `data_get_dva_snapshot`
- Source of truth: the active TradingView Desktop chart

## Terminology

- `anchor` is the term we use for the snapshot period identifier.
- When you mention a timeframe for `Vwap MantillaPB`, interpret it in terms of the anchor unless the context explicitly says otherwise.

## Scope

This snapshot is meant to return the current and previous Development Value Area values for the active chart timeframe.

It is versioned so we can keep a stable baseline while continuing to refine the logic.

## Current period mappings

The snapshot currently resolves the chart resolution into a DVA mode like this:

| TradingView resolution | DVA type | Anchor | Notes |
|---|---|---|---|
| `1D` / `D` | `annual` | `Year` | Daily chart uses yearly DVA |
| `8h` / `480` | `quarterly` | `Quarter` | Eight-hour chart uses quarterly DVA |
| `2h` / `120` | `monthly` | `Month` | Two-hour chart uses monthly DVA |
| `30m` / `30` | `weekly` | `Week` | Thirty-minute chart uses weekly DVA |
| `1M` / `M` | `monthly` | `Decade` | Monthly chart now uses decade-anchored monthly DVA |
| `1W` / `W` | `weekly` | `HalfDecade` | Weekly chart now uses half-decade-anchored weekly DVA |

## Snapshot schema

The current snapshot shape is:

```json
{
  "success": true,
  "source": "vwap_dva_snapshot_v7",
  "schema_version": "v7",
  "symbol": "STRING",
  "resolution": "STRING",
  "chart_last_index": 0,
  "study": {
    "name": "Vwap MantillaPB",
    "visible": true
  },
  "dva": {
    "type": "annual | quarterly | monthly | weekly",
    "anchor": "Year | Quarter | Month | Decade | Week | HalfDecade",
    "current": {
      "period_type": "annual | quarterly | monthly | weekly",
      "period_key": "STRING",
      "period_start": {
        "raw": 0,
        "utc": "ISO-8601",
        "israel": "YYYY-MM-DD HH:mm"
      },
      "period_end": {
        "raw": 0,
        "utc": "ISO-8601",
        "israel": "YYYY-MM-DD HH:mm"
      },
      "period_start_bar_index": 0,
      "period_end_bar_index": 0,
      "variables": {
        "VWAP": 0,
        "DVAH": 0,
        "DVAL": 0,
        "DVA+2": 0,
        "DVA-2": 0,
        "DVA+3": 0,
        "DVA-3": 0,
        "middle up 0.5": 0,
        "middle down 0.5": 0,
        "Middle up 1.5": 0,
        "Middle down 1.5": 0
      },
      "display_values": {
        "VWAP": "STRING",
        "DVAH": "STRING",
        "DVAL": "STRING",
        "DVA+2": "STRING",
        "DVA-2": "STRING",
        "DVA+3": "STRING",
        "DVA-3": "STRING",
        "middle up 0.5": "STRING",
        "middle down 0.5": "STRING",
        "Middle up 1.5": "STRING",
        "Middle down 1.5": "STRING"
      }
    },
    "previous": {
      "period_type": "annual | quarterly | monthly | weekly",
      "period_key": "STRING",
      "period_start": {
        "raw": 0,
        "utc": "ISO-8601",
        "israel": "YYYY-MM-DD HH:mm"
      },
      "period_end": {
        "raw": 0,
        "utc": "ISO-8601",
        "israel": "YYYY-MM-DD HH:mm"
      },
      "period_start_bar_index": 0,
      "period_end_bar_index": 0,
      "variables": {},
      "display_values": {}
    },
    "current_value_row": {
      "bar_index": 0,
      "time": {
        "raw": 0,
        "utc": "ISO-8601",
        "israel": "YYYY-MM-DD HH:mm"
      },
      "variables": {}
    },
    "previous_value_row": {
      "bar_index": 0,
      "time": {
        "raw": 0,
        "utc": "ISO-8601",
        "israel": "YYYY-MM-DD HH:mm"
      },
      "variables": {}
    }
  }
}
```

## Semantics

- `current` is the active period currently forming on the chart.
- `previous` is the last fully closed period before the active one.
- `current_value_row` is the last bar of the active period.
- `previous_value_row` is the last bar of the previous completed period.
- `period_start` and `period_end` are calendar boundaries for the relevant DVA period.
- `period_start_bar_index` and `period_end_bar_index` are the bar indexes used to anchor the snapshot on TradingView.

## Version notes

### `v7`

Current baseline.

Changes included in this version:

- `2h` resolves to `monthly` with `Month` anchor.
- `30m` resolves to `weekly` with `Week` anchor.
- `1M` / `M` resolve to `monthly` with `Decade` anchor.
- `1W` / `W` resolve to `weekly` with `HalfDecade` anchor.
- The snapshot keeps both calendar dates and Israel time for each period boundary.
- `current_period` was removed in favor of the explicit `current` and `previous` blocks.
- `current_value_row` and `previous_value_row` remain available for manual chart verification.

### Earlier baselines

- `v6`: same structure as the current snapshot before the anchor renaming for `1M` and `1W`.
- `v5`: same general structure as the current snapshot, before the `30m -> weekly` mapping was added.
- `v3`: earlier annual DVA baseline used while stabilizing the date and range semantics.

## Maintenance rule

When the snapshot logic changes again:

1. Bump the schema/version name.
2. Update the mappings table above.
3. Update the schema example if any fields change.
4. Add or adjust a regression test in `tests/data_snapshot.test.js`.
