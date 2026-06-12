# Mantilla PB DeMARK 9-13 Calibration Log

Use this log to compare `Mantilla PB DeMARK 9-13` against the paid DeMARK 9-13 TradingView indicator using the paid indicator's default settings.

## Baseline Charts

- `NASDAQ:QQQ`, daily
- `SPY`, daily
- `COINBASE:BTCUSD`, daily
- `NASDAQ:GOOGL`, daily
- `NASDAQ:TSLA`, daily

## Entry Template

```text
Symbol:
Timeframe:
Date range:
Paid indicator output:
Mantilla output:
Mismatch type:
Likely rule:
Decision:
Status:
```

## Known Calibration Hotspots

- Price flip requirement for Setup start.
- Strict vs inclusive Setup comparison.
- Perfected Setup strictness and delayed perfection.
- TDST true high / true low behavior on gaps.
- Whether Sequential countdown can start on Setup bar 9.
- Combo start timing and extra Combo constraints.
- Risk Level formula for Sequential and Combo.
- Recycling trigger beyond setup count 22.

## Visual Calibration Convention

- Setup counts: green numbers.
- Sequential countdown counts: red numbers.
- Combo countdown counts: blue numbers.
- TDST support: green line.
- TDST resistance: red line.
- Verification screenshots should show both `DeMARK 9-13` and `Mantilla PB DeMARK 9-13` overlaid on the same chart.

## 2026-06-06: QQQ Daily Initial Calibration

```text
Symbol: BATS:QQQ
Timeframe: 1D
Date range: visible chart, through 2026-06-05
Paid indicator output: DeMARK 9-13 loaded with default settings; MCP snapshot reports 498 labels.
Mantilla output: Mantilla PB DeMARK 9-13 loaded; after calibration defaults update, MCP snapshot reports 500 labels.
Mismatch type: Initial visual density mismatch was caused by Mantilla defaulting to Clean mode and showing S/C prefixes.
Likely rule: Paid DeMARK default displays dense numeric labels without S/C prefixes.
Decision: Changed Mantilla default Display Mode to All Counts, changed Max Managed Labels default to 500, and added Show Countdown Prefixes default false.
Status: Fixed for first visual-density pass. Needs bar-by-bar review for exact count alignment, especially overlapping setup/sequential/combo labels and recycle events.
```

Screenshot:

- `screenshots/mantilla-demark-qqq-d-calibration-v2.png`

## 2026-06-06: SPY Daily Initial Calibration

```text
Symbol: BATS:SPY
Timeframe: 1D
Date range: visible chart, through 2026-06-05
Paid indicator output: DeMARK 9-13 loaded with default settings; MCP snapshot reports 487 labels and 18 perfected setup markers.
Mantilla output: Mantilla PB DeMARK 9-13 loaded; MCP snapshot reports 500 labels.
Mismatch type: Label density is now close. Perfected Setup requires visual review because Mantilla renders dots with plotshape while the paid snapshot exposes perfected markers as label-like objects.
Likely rule: Perfected Setup strictness and delayed perfection remain calibration hotspots.
Decision: Keep current rendering for now; compare screenshot visually before changing perfection logic.
Status: Needs visual bar-by-bar review.
```

Screenshot:

- `screenshots/mantilla-demark-spy-d-calibration.png`

## 2026-06-06: BTCUSD Daily Initial Calibration

```text
Symbol: COINBASE:BTCUSD
Timeframe: 1D
Date range: visible chart, through 2026-06-06
Paid indicator output: DeMARK 9-13 loaded with default settings; MCP snapshot reports 496 labels, 109 current labels, and 26 perfected setup markers.
Mantilla output: Mantilla PB DeMARK 9-13 loaded; MCP snapshot reports 500 labels and 99 current labels. Perfected dots are rendered with plotshape and are not reported as labels by the MCP snapshot.
Mismatch type: Overall label density is close, but current/active count totals differ and perfected setup output needs visual validation.
Likely rule: Combo timing, recycle behavior, and perfected setup strictness are the next likely sources of mismatch.
Decision: Preserve current defaults and use BTCUSD as a high-volatility calibration case for the first correction pass.
Status: Needs visual bar-by-bar review.
```

Screenshot:

- `screenshots/mantilla-demark-btcusd-d-calibration.png`

## 2026-06-06: BTCUSD Snapshot Comparison Notes

```text
Symbol: COINBASE:BTCUSD
Timeframe: 1D
Current chart state: Mantilla PB DeMARK 9-13 and paid DeMARK 9-13 are both loaded on the debug TradingView instance.
Paid current snapshot: current bar resolves as a buy combo 3; active history includes buy combo progression through 13 and 26 perfected setup markers.
Mantilla current snapshot: current bar resolves as buy setup 3 plus an overlapping combo 3; active/current labels total is lower than paid.
Mismatch type: Mantilla is likely over-rendering active setup counts during an overlapping countdown phase, while paid defaults prioritize or visually separate the active combo sequence.
Likely rule: Display arbitration between Setup, Sequential, and Combo families; Combo continuation timing; perfected setup marker representation.
Decision: First correction pass should not alter setup arithmetic yet. Start with display-family arbitration and then validate combo timing bar-by-bar.
Status: Open.
```

## 2026-06-11: Phase 1 Overlay Verification

```text
Scope: Reconnected TradingView Desktop debug session after machine restart, reloaded Mantilla PB DeMARK 9-13, and verified against the paid DeMARK 9-13 with both studies visible on daily charts.
Implementation update: Default colors now match the calibration convention: Setup green, Sequential red, Combo blue, TDST support green, TDST resistance red.
Technical verification: Pine compiled successfully with 0 errors and 0 warnings. Contract test passes 6/6.
Visibility issue found: TradingView had Mantilla loaded but hidden after script update, so first screenshots were invalid for overlay comparison. Fixed by using indicator_toggle_visibility on entity PYXzSF and repeated captures.
Visual mismatch found: Mantilla now visibly overlays the paid indicator, but still produces extra/smaller labels in active regions where the paid indicator appears to prioritize one count family. BTCUSD and TSLA show the clearest mismatch around overlapping Setup, Sequential, and Combo phases.
Likely rule: Display-family arbitration and Combo continuation timing should be the next correction pass before touching setup arithmetic.
Status: Needs user visual review before phase 2 logic changes.
```

Valid overlay screenshots:

- `screenshots/mantilla-demark-overlay-qqq-d-20260611-visible.png`
- `screenshots/mantilla-demark-overlay-spy-d-20260611-visible.png`
- `screenshots/mantilla-demark-overlay-btcusd-d-20260611-visible.png`
- `screenshots/mantilla-demark-overlay-googl-d-20260611-visible.png`
- `screenshots/mantilla-demark-overlay-tsla-d-20260611-visible.png`

Invalid first-pass screenshots, kept only as debugging evidence because Mantilla was hidden:

- `screenshots/mantilla-demark-overlay-qqq-d-20260611.png`
- `screenshots/mantilla-demark-overlay-spy-d-20260611.png`
- `screenshots/mantilla-demark-overlay-btcusd-d-20260611.png`
- `screenshots/mantilla-demark-overlay-googl-d-20260611.png`
- `screenshots/mantilla-demark-overlay-tsla-d-20260611.png`
