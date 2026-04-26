# VWAP MantillaPB Narrative Rules

This document stores the current narrative/acceptance rules used by the `v11` DVA snapshot.

## Definitions

- `PVA`: Previous Value Area. The static rectangle extended from the prior completed value area.
- `DVA`: Developing Value Area. The current value area in development.
- `dominant_area`: The area that currently governs the interpretation window.
- `FCS`: First Condition Shift. Active from acceptance until the first qualifying pullback.

## Structural interpretation

- Inside the area: rotational context.
- Outside the area: migratory / imbalance context, but only after confirmed acceptance.
- Touching an extreme without external acceptance does not imply continuation by itself.

## Config defaults

- `acceptance_bars`: `4`
- `slope_lookback_bars`: `4`
- `slope_threshold`: `0.25`

## Acceptance timing

After the initial touch/cross is detected, time acceptance uses fully positioned bars:

- Above the area: `low > upper`
- Below the area: `high < lower`
- Inside the area: `high < upper` and `low > lower`

Current implementation uses the active `dominant_area` for the live evaluation window.

## PVA rules

Outside acceptance:

- Context: `BPB`
- Minimum extension: `+/-1.5`
- Wave rule: at least `50%` of the wave closes outside the area until `+/-1.5` is reached
- Time acceptance: `4` fully outside bars
- First valid pullback keeps the broken extreme, with allowed excess up to internal `+/-0.5`
- Narrative after acceptance:
  - above -> `imbalance_up`
  - below -> `imbalance_down`

Inside acceptance:

- Context: `RPB`
- Minimum penetration: internal `+/-0.5`
- Wave rule: at least `50%` of the wave closes inside the area until `+/-0.5` is reached
- Time acceptance: `4` fully inside bars
- Pullback can retest the penetrated extreme with allowed excess up to external `+/-1.5`
- Narrative after acceptance:
  - accepted from `PVAL` side -> `rotational_up`
  - accepted from `PVAH` side -> `rotational_down`

## DVA rules

Inside acceptance:

- Context: `EF`
- Minimum penetration: internal `+/-0.5`
- Wave rule: at least `50%` of the wave closes inside the area until `+/-0.5` is reached
- Time acceptance: `4` fully inside bars
- Pullback can retest the penetrated extreme with allowed excess up to external `+/-2`
- Narrative after acceptance:
  - accepted from `DVAL` side -> `rotational_up`
  - accepted from `DVAH` side -> `rotational_down`

Outside acceptance:

- Context: `IPB`
- Minimum extension: `+/-2`
- Time acceptance: `4` fully outside bars
- Slope confirmation:
  - `normalized_vwap_slope = (VWAP_now - VWAP_lookback) / sigma_now`
  - up requires `> slope_threshold`
  - down requires `< -slope_threshold`
- Pullback can retest the broken extreme with allowed excess up to internal `+/-0.5`
- Narrative after acceptance:
  - above -> `imbalance_up`
  - below -> `imbalance_down`
- `FCS` remains active after the first `IPB` touch while the same pullback is still in progress.
  It is cancelled only when one of these happens:
  - a full bar resumes outside in the migration direction
  - a new inside acceptance is confirmed into the DVA

## Narrative fields in snapshot `v11`

- `direction`: `bullish | bearish`
- `type`: `imbalance_up | imbalance_down | rotational_up | rotational_down`
- `fcs_active`: `true | false`
- `pullback_type`: `BPB | RPB | IPB | EF`
- `pullback_state`: `pending | confirmed`

## Current implementation note

The `v11` engine always returns a narrative. If there is not enough verified acceptance history in the available rows, it falls back to the current dominant-area position and the last touched extreme so the snapshot remains complete.
