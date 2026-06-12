# Mantilla PB DeMARK 9-13 Product Spec

## Status

Draft for review. No Pine implementation should start until this spec is approved.

Product Design plugin note: the user requested `@product-design`; Codex exposed the plugin in session context, but no Product Design-specific callable tool or skill was available through tool discovery. This document follows a product/spec workflow using the available Codex design process.

## Product Goal

Build `Mantilla PB DeMARK 9-13`, a Pine Script indicator that replicates the practical behavior of the paid DeMARK 9-13 TradingView indicator closely enough for chart-by-chart calibration, then use the same engine to build a strategy in a second phase.

The first deliverable is an indicator, not a strategy. The strategy will be implemented only after the indicator behavior is visually validated against the paid DeMARK 9-13 indicator.

## User Outcomes

- See Buy and Sell Setup counts 1-9.
- See Sequential Countdown counts 1-13.
- See Combo Countdown counts 1-13.
- See TDST support/resistance lines.
- See Perfected Setup marks.
- Optionally see Risk Levels for Sequential and Combo independently.
- Optionally enable countdown qualifiers and recycling.
- Configure colors for count types and level lines.
- Choose between dense display and clean display.
- Use the resulting visual logic as the source for a later trading strategy.

## Public Rule References

The implementation will be based on public descriptions and calibrated visually against the paid indicator:

- DeMARK Sequential overview: https://demark.com/sequential-indicator/
- DeMARK 9-13 TradingView product overview: https://demark.com/tradingview/
- TradingView DeMARK 9-13 public script page: https://www.tradingview.com/script/gVMuxasg-DeMARK-9-13/
- TD Sequential public references:
  - https://gocharting.com/docs/charting/technical-indicator/overlays/td-sequential
  - https://sai-tai.com/other/econ/indicators-strategies/td-sequential/

Important limitation: the paid DeMARK TradingView indicator is protected. This project cannot read or copy its internal source code. Any differences must be resolved through visible output comparison and configurable rule variants.

## Product Shape

### Phase 1: Indicator

File target:

- `pine/MantillaPB.DeMARK.9-13.pine`

Indicator title:

- `Mantilla PB DeMARK 9-13`

Primary purpose:

- Overlay DeMARK-style counts and levels on price charts.
- Provide enough configuration to match the paid indicator's visible behavior.

### Phase 2: Strategy

File target:

- `pine/MantillaPB.DeMARK.9-13.Strategy.pine`

Strategy purpose:

- Reuse the validated Phase 1 logic.
- Enter long on `1 Sell Setup`.
- Exit on `9 Sell Setup`.
- Stop below `close[4]` of the bar where `1 Sell Setup` appears.

Phase 2 must not start until Phase 1 is visually validated.

## Indicator Functional Requirements

### Setup Counts

Implement both directions:

- Buy Setup: count consecutive bars where `close < close[4]`.
- Sell Setup: count consecutive bars where `close > close[4]`.

Configurable rules:

- Require price flip before starting setup: on/off.
- Comparison mode: strict `>` / `<` by default; optional inclusive `>=` / `<=` if needed for calibration.
- Reset opposite setup when current setup advances.

Display:

- Buy Setup counts below bars.
- Sell Setup counts above bars.
- Count labels 1-9.
- Completed `9` remains visible even in clean display mode.

### Perfected Setup

Mark perfected setup with a dot.

Initial rule assumption:

- Buy Setup perfection: lows of setup bars 8 or 9 are less than or equal to lows of setup bars 6 and 7.
- Sell Setup perfection: highs of setup bars 8 or 9 are greater than or equal to highs of setup bars 6 and 7.

If public references or visual calibration show the paid indicator uses a delayed perfection rule, add an input:

- `Perfection Mode`: `Immediate`, `Delayed Until Confirmed`.

### TDST Lines

Implement TDST lines after completed setups.

Initial rule assumption:

- TDST resistance from completed Buy Setup: highest true high across setup bars 1-9.
- TDST support from completed Sell Setup: lowest true low across setup bars 1-9.

Display:

- Separate colors for TDST support and TDST resistance.
- Optional line extension until invalidated.
- Optional breakout qualifier mode can be scoped to a later version if calibration requires it.

### Sequential Countdown

Start after a completed Setup in the same direction.

Initial public rule assumption:

- Buy Sequential Countdown: increment on bars where `close <= low[2]`.
- Sell Sequential Countdown: increment on bars where `close >= high[2]`.
- Countdown is non-consecutive.
- Countdown counts 1-13.

Configurable cancellation:

- Cancel incomplete countdown on opposite completed setup: on/off.
- Cancel on TDST break: on/off.

### Combo Countdown

Implement Combo as a separate countdown path using the same completed setup seed.

Initial implementation will support a standard public approximation and expose a variant selector:

- `Combo Version`: `Standard`, `Conservative`, `Aggressive`.

The exact Combo rules are more likely to differ across public references. The first implementation must isolate Combo logic in helper functions so calibration changes do not disturb Setup or Sequential logic.

### Countdown Qualifiers

Sequential qualifiers:

- `13 vs 8` qualifier: on by default.
- Optional `8 vs 5` qualifier: off by default.

Initial rule assumption:

- Buy `13 vs 8`: final buy countdown low must be less than or equal to close of countdown bar 8.
- Sell `13 vs 8`: final sell countdown high must be greater than or equal to close of countdown bar 8.
- Buy `8 vs 5`: countdown bar 8 low must be less than or equal to close of countdown bar 5.
- Sell `8 vs 5`: countdown bar 8 high must be greater than or equal to close of countdown bar 5.

Display:

- When a qualifier defers completion, show `+` instead of the deferred count if enabled.
- If Pine object limits become a problem, this can be simplified to only defer count progression without showing `+`.

### Risk Levels

Risk Levels must be independently configurable:

- Enable Sequential Risk Level: on/off.
- Enable Combo Risk Level: on/off.
- Enable Sequential Risk Zone: on/off.
- Enable Combo Risk Zone: on/off.

Initial rule assumption:

- Generate risk level when countdown 13 completes.
- For buy countdowns, risk level acts as downside support/invalidation.
- For sell countdowns, risk level acts as upside resistance/invalidation.

Risk Level formula is a calibration hotspot. Public descriptions agree on purpose but are less consistent on exact calculation. Implement the formula behind a helper function and document it in code comments. Visual calibration against the paid indicator determines final formula.

### Recycling

Add recycling as an optional feature.

Inputs:

- Enable Recycle: on/off.
- Recycle Setup Count: default 22.
- Apply to Sequential: on/off.
- Apply to Combo: on/off.

Initial rule assumption:

- A completed or active countdown can be recycled when an overlapping setup in the same direction reaches the configured recycle setup count.
- When recycling occurs, display `R` instead of final `13` where applicable.
- Reset the affected countdown state.

Recycling is a calibration hotspot and should be implemented after base Setup, TDST, Sequential and Combo are stable.

## Visual Requirements

Inputs:

- Buy Setup color.
- Sell Setup color.
- Buy Sequential color.
- Sell Sequential color.
- Buy Combo color.
- Sell Combo color.
- TDST support color.
- TDST resistance color.
- Sequential Risk Level color.
- Combo Risk Level color.
- Perfected Setup dot color.

Display mode:

- `All Counts`: show every visible setup/countdown count.
- `Clean`: show only the latest active count plus historical `9`, `13`, `R`, and perfected dots.

Placement:

- Buy-side counts below candles.
- Sell-side counts above candles.
- Setup and countdown labels should use different styles or sizes so the chart remains readable.

Pine constraints:

- Use bounded label/line management to avoid TradingView object limits.
- Prefer `plotshape` where possible for fixed count markers.
- Use labels only when dynamic text, `+`, or `R` is required.

## Non-Goals

- Do not copy or decompile the paid indicator.
- Do not promise exact equivalence before calibration.
- Do not build the strategy before the indicator is validated.
- Do not add alerts in the first pass unless needed for validation.
- Do not automate trading.

## Technical Architecture

Single Pine indicator with internally separated sections:

1. Inputs and visual configuration.
2. Shared utility functions:
   - true high / true low
   - count label creation
   - line lifecycle management
   - risk level calculation
3. Setup engine:
   - buy setup state
   - sell setup state
   - perfected setup state
4. TDST engine.
5. Sequential countdown engine.
6. Combo countdown engine.
7. Recycling engine.
8. Render layer.

Design principle:

- Calculation and rendering should be kept separate where Pine allows it. This makes visual calibration safer.

## Implementation Phases

### Milestone 1: Setup + Perfected Setup

- Build Buy/Sell Setup 1-9.
- Add price flip input.
- Add perfected setup dots.
- Validate on at least 5 symbols and 3 timeframes.

### Milestone 2: TDST

- Add TDST support/resistance lines.
- Add colors and line extension behavior.
- Compare against paid indicator.

### Milestone 3: Sequential Countdown

- Add Sequential 1-13.
- Add cancellation settings.
- Add `13 vs 8` and optional `8 vs 5`.
- Compare count placement against paid indicator.

### Milestone 4: Combo Countdown

- Add Combo 1-13.
- Add Combo version input.
- Compare against paid indicator.

### Milestone 5: Risk Levels

- Add Sequential Risk Levels and zones.
- Add Combo Risk Levels and zones.
- Calibrate formula visually.

### Milestone 6: Recycling

- Add recycle inputs.
- Add `R` rendering.
- Validate against cases where the paid indicator recycles.

### Milestone 7: Strategy Spec

- Create a separate strategy spec once indicator behavior is approved.

## Visual Validation Plan

Use TradingView Desktop debug instance with both indicators loaded:

1. Load paid DeMARK 9-13 indicator.
2. Load `Mantilla PB DeMARK 9-13`.
3. Use the same chart symbol and timeframe.
4. Compare bar-by-bar outputs.
5. Record mismatches in a calibration log.

Validation matrix:

- Symbols:
  - `NASDAQ:QQQ`
  - `SPY`
  - `COINBASE:BTCUSD`
- Timeframes:
  - `D`
- Market regimes:
  - strong trend
  - sideways range
  - reversal area
  - gap-heavy equities session for QQQ and SPY
  - continuous crypto price action for BTCUSD

Comparison checklist:

- Setup counts start on the same bars.
- Setup counts reset on the same bars.
- Setup 9 appears on the same bars.
- Perfected dots appear on the same bars.
- TDST levels match or differ by documented true high/true low rule.
- Sequential counts match.
- Combo counts match.
- Deferred `13` behavior matches when qualifiers are enabled.
- Risk Levels match or formula differences are documented.
- Recycle events match.

Calibration log format:

```text
Symbol:
Timeframe:
Date range:
Paid indicator output:
Mantilla output:
Mismatch type:
Likely rule:
Decision:
```

## Test Plan

### Static Tests

- Run existing Pine analyzer on the script.
- Verify no array out-of-bounds patterns.
- Verify no unguarded historical references before enough bars exist.
- Verify object creation is bounded.

### Compile Tests

- Compile in TradingView Pine Editor through MCP.
- Fix syntax/type errors.
- Confirm indicator loads on chart.

### Visual Smoke Tests

- Screenshot chart with paid and Mantilla indicators active.
- Confirm labels and lines render without overlap severe enough to block use.
- Toggle display mode between `All Counts` and `Clean`.
- Toggle each feature independently.

### Calibration Tests

- Use screenshots and MCP state reads where available.
- Compare against the validation matrix.
- Store findings in `docs/product/mantilla-pb-demark-9-13-calibration-log.md`.

## Open Questions

Resolved decisions:

1. The first calibration target is the exact default settings of the paid DeMARK 9-13 TradingView indicator.
2. The first golden-reference charts are `NASDAQ:QQQ` daily, `SPY` daily, and `COINBASE:BTCUSD` daily.
3. Alerts are out of scope for Phase 1 and will be handled later in the strategy phase.

## Approval Gate

Implementation should start only after the user approves this spec or requests changes.
