# Glosario de `Vwap MantillaPB`

This document is the shared reference for talking about the VWAP indicator in the same language.
Read it before changing the Pine for this indicator.

## Reading rule

- `DVA` = Development Value Area, or `area de valor en desarrollo actual`.
- `PVA` = Previous Value Area, or `area de valor previa`.
- If a term here does not match the exact Pine variable name, this glossary defines the meaning.

## Core concepts

| Concept | Meaning |
|---|---|
| Current development area | The period that is forming now, with VWAP and bands `+1`, `+2`, `+3`, `-1`, `-2`, `-3` |
| Current value area | Synonym of current development area (`DVA`) |
| Previous value area | The already closed previous period (`PVA`) |
| Previous rectangle | Static rectangle drawn from previous `+1` to previous `-1` |
| Previous `0.5` line | Dotted midpoint between previous `VWAP` and previous `+1` / `-1` |
| Previous `1.5` line | Dotted midpoint between previous `+1` and `+2` / `-1` and `-2` |
| Annual mode | Resets every year, displayed on daily chart |
| Quarterly mode | Resets every quarter, displayed on `8H` chart |
| Monthly mode | Resets every month, displayed on `2H` chart |
| Weekly mode | Resets every week, displayed on `30m` chart |

## Naming convention

Use the period letter in front of the area name.

| Period | DVA name | PVA name |
|---|---|---|
| Yearly | `YDVA` / yearly DVA / area de valor en desarrollo anual | `YPVA` / yearly PVA / area de valor previa anual |
| Quarterly | `QDVA` / quarterly DVA / area de valor en desarrollo trimestral | `QPVA` / quarterly PVA / area de valor previa trimestral |
| Monthly | `MDVA` / monthly DVA / area de valor en desarrollo mensual | `MPVA` / monthly PVA / area de valor previa mensual |
| Weekly | `WDVA` / weekly DVA / area de valor en desarrollo semanal | `WPVA` / weekly PVA / area de valor previa semanal |

## Pine mapping

### Current source

These are the real variables in the current `Vwap MantillaPB` source.

| Pine variable | Concept | Notes |
|---|---|---|
| `anchorInput` | Manual period anchor | Base selection |
| `autoAnchorByTF` | Auto anchor by timeframe | Chooses the period from `timeframe.period` |
| `anchor` | Effective period | `Session`, `Week`, `Month`, `Quarter`, `Year`, etc. |
| `isNewPeriod` | Start of the current period | Resets the accumulating VWAP |
| `computeVWAP(isNewPeriod)` | Current `DVA` engine | Computes VWAP and standard deviation |
| `vwapValue` | Current VWAP | Center line of the current `DVA` |
| `std` | Current standard deviation | Basis for bands |
| `upperBandValue` / `lowerBandValue` | Current `+1` / `-1` band | Main `DVA` boundaries |
| `upperBandValue2` / `lowerBandValue2` | Current `+2` / `-2` band | Second deviation |
| `upperBandValue3` / `lowerBandValue3` | Current `+3` / `-3` band | Third deviation |
| `pdvavwap` | Previous VWAP | Value from the prior period |
| `pdvah` / `pdval` | Previous `+1` / `-1` band | Boundaries of the `PVA` rectangle |
| `periodStart` | Current period start | Anchor for drawing the previous area |
| `prevdvah` / `prevdval` | Previous static lines | Rectangle borders for the `PVA` |
| `prevFill` | Previous rectangle fill | Transparent fill between `+1` and `-1` |
| `mu05` / `ml05` | Current `0.5` lines | Midpoints between current VWAP and `+1` / `-1` |
| `mup2` / `mudn2` | Current `1.5` lines | Midpoints between `+1` and `+2` / `-1` and `-2` |

### Working names for v1

Use these names while discussing or implementing the next version.

| Working name | Meaning |
|---|---|
| `current_dva` | Current development value area |
| `previous_dva` | Previous development value area |
| `current_pva` | Previous value area rectangle for the prior period |
| `prev_area_high` | Previous rectangle upper boundary (`+1`) |
| `prev_area_low` | Previous rectangle lower boundary (`-1`) |
| `prev_mid_high_05` | Previous dotted `+0.5` line |
| `prev_mid_low_05` | Previous dotted `-0.5` line |
| `prev_mid_high_15` | Previous dotted `+1.5` line |
| `prev_mid_low_15` | Previous dotted `-1.5` line |

## Line behavior

- The `PVA` is a static rectangle.
- The rectangle is defined by the previous period `+1` and `-1` bands.
- The rectangle fill is transparent.
- The previous `0.5` and `1.5` lines are dotted.
- The previous `0.5` and `1.5` lines should start from the right edge of the `PVA` and extend inside that rectangle.
- The same rule applies whether the reference area is yearly, quarterly, monthly, or weekly.

## Color palette

### Current source palette

These are the actual colors declared in the current Pine source.

| Period | Area color | VWAP color | Hex |
|---|---|---|---|
| Yearly | Gray | Red | `#A2A3A8` / `#FF0000` |
| Quarterly | Orange | Red | `#FFA500` / `#FF0000` |
| Monthly | Aqua | Red | `#00FFFF` / `#FF0000` |
| Weekly | Fuchsia | Red | `#FC4AAC` / `#FF0000` |

Current source variables:

- `yearColor = #A2A3A8`
- `quarterColor = #FFA500`
- `monthColor = #00FFFF`
- `weekColor = #FC4AAC`
- `vwapBaseColor = #FF0000`

### Target palette for v1

Use this palette when implementing the first version of the new logic if you want period-specific VWAP colors.

| Period | Area color | VWAP color | Hex |
|---|---|---|---|
| Yearly | Gray | Red | `#A2A3A8` / `#FF0000` |
| Quarterly | Orange | Blue | `#FFA500` / `#0000FF` |
| Monthly | Blue / Aqua | Red | `#00FFFF` / `#FF0000` |
| Weekly | Fuchsia | Blue | `#FC4AAC` / `#0000FF` |

## How to use this glossary

1. Read this file before editing `Vwap MantillaPB`.
2. Translate the request into the working names here.
3. Map the working names to the Pine variables.
4. Keep this file updated whenever the terminology changes.

