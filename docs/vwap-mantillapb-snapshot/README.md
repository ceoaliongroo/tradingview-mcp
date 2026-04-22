# Vwap MantillaPB Snapshot Documentation

This folder documents the current version of the `Vwap MantillaPB` DVA snapshot exposed by the MCP server.

## Current version

- `schema_version`: `v11`
- `source`: `vwap_dva_snapshot_v11`
- Primary MCP tool: `data_get_dva_snapshot`
- Source of truth: the active TradingView Desktop chart

## Terminology

- `anchor` is the term we use for the snapshot period identifier.
- When you mention a timeframe for `Vwap MantillaPB`, interpret it in terms of the anchor unless the context explicitly says otherwise.

## Scope

This snapshot is meant to return the current and previous Development Value Area values for the active chart timeframe, plus the dominant-area narrative state derived from price acceptance and pullback rules.

It is versioned so we can keep a stable baseline while continuing to refine the logic.

Narrative rules live in [narrative-rules.md](C:/Users/manti/Documents/apps/tradingview-mcp/docs/vwap-mantillapb-snapshot/narrative-rules.md).

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
  "source": "vwap_dva_snapshot_v11",
  "schema_version": "v11",
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
    "dominant_area": {
      "anchor": "Year | Quarter | Month | Decade | Week | HalfDecade",
      "active_side": "previous | current",
      "active_label": "PVA | DVA",
      "rule": "STRING",
      "switch_at": {
        "raw": 0,
        "utc": "ISO-8601",
        "israel": "YYYY-MM-DD HH:mm"
      },
      "previous_window": {
        "start": {
          "raw": 0,
          "utc": "ISO-8601",
          "israel": "YYYY-MM-DD HH:mm"
        },
        "end": {
          "raw": 0,
          "utc": "ISO-8601",
          "israel": "YYYY-MM-DD HH:mm"
        }
      },
      "current_window": {
        "start": {
          "raw": 0,
          "utc": "ISO-8601",
          "israel": "YYYY-MM-DD HH:mm"
        },
        "end": {
          "raw": 0,
          "utc": "ISO-8601",
          "israel": "YYYY-MM-DD HH:mm"
        }
      }
    },
    "price_close": 0,
    "price_position_dominant_area": "Above | Inside | Below",
    "narrative": {
      "dominant_area_label": "PVA | DVA",
      "direction": "bullish | bearish",
      "type": "imbalance_up | imbalance_down | rotational_up | rotational_down",
      "fcs_active": true,
      "pullback_type": "BPB | RPB | IPB | EF",
      "pullback_state": "pending | confirmed",
      "config": {
        "acceptance_bars": 4,
        "slope_lookback_bars": 4,
        "slope_threshold": 0.25
      },
      "acceptance": {
        "mode": "inside | outside",
        "direction": "up | down",
        "bar_index": 0,
        "time": {
          "raw": 0,
          "utc": "ISO-8601",
          "israel": "YYYY-MM-DD HH:mm"
        },
        "wave_ratio": 0,
        "normalized_vwap_slope": 0
      }
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
- `dominant_area` tells you which area is currently in control for the active anchor window and where the switch happens.
- `price_close` is the current close used to evaluate the price against the dominant area's bounds.
- `price_position_dominant_area` tells you where the current close sits relative to the dominant area's extremes. `Above`, `Inside`, and `Below` are inclusive of exact touches as `Inside`.
- `narrative` resolves the current directional story against the dominant area. It always returns a bullish or bearish state, a pullback type, and whether the first pullback is still pending.

## Version notes

### `v11`

Current baseline.

Changes included in this version:

- `narrative` was added to the snapshot.
- The narrative block reports `direction`, `type`, `fcs_active`, `pullback_type`, and `pullback_state`.
- Acceptance timing is configurable and currently defaults to `4` bars.
- DVA outside acceptance uses normalized VWAP slope with defaults stored in the snapshot config.

### `v10`

Previous baseline.

Changes included in this version:

- `dominant_area` was added to the snapshot.
- `price_close` and `price_position_dominant_area` were added. `price_position_dominant_area` is computed from the current close against the dominant area's bounds.
- `1D`, `8h`, `2h`, `30m`, `1M`, and `1W` keep their existing type mappings.
- The snapshot now exposes the active dominant side plus the switch window for the current anchor.

### `v8`

Previous baseline.

Changes included in this version:

- `2h` resolves to `monthly` with `Month` anchor.
- `30m` resolves to `weekly` with `Week` anchor.
- `1M` / `M` resolve to `monthly` with `Decade` anchor.
- `1W` / `W` resolve to `weekly` with `HalfDecade` anchor.
- The snapshot keeps both calendar dates and Israel time for each period boundary.
- `current_period` was removed in favor of the explicit `current` and `previous` blocks.
- `current_value_row` and `previous_value_row` remain available for manual chart verification.

### Earlier baselines

- `v7`: same structure as the current snapshot before the `dominant_area` and `price_position` additions.
- `v6`: same structure as the current snapshot before the anchor renaming for `1M` and `1W`.
- `v5`: same general structure as the current snapshot, before the `30m -> weekly` mapping was added.
- `v3`: earlier annual DVA baseline used while stabilizing the date and range semantics.

## Maintenance rule

When the snapshot logic changes again:

1. Bump the schema/version name.
2. Update the mappings table above.
3. Update the schema example if any fields change.
4. Add or adjust a regression test in `tests/data_snapshot.test.js`.
