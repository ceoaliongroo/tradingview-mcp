# DeMARK 9-13 Color Table

Default TradingView colors for the local DeMARK 9-13 indicator:

| Family | Shade | HEX | ARGB int | Meaning |
| --- | --- | --- | --- | --- |
| `setup` | dark | `#388E3C` | `4281898556` | buy / dark green |
| `setup` | light | `#A5D6A7` | `4289050279` | sell / light green |
| `tdst` | dark | `#F57C00` | `4294276096` | TDST / orange |
| `tdst` | light | `#FFCC80` | `4294950016` | TDST / light orange |
| `sequential` | dark | `#B22833` | `4289865779` | buy / dark red |
| `sequential` | light | `#FAA1A4` | `4294613412` | sell / light red |
| `combo` | dark | `#0097A7` | `4278220711` | buy / dark cyan |
| `combo` | light | `#80DEEA` | `4286631658` | sell / light cyan |

Notes:

- These are the default fallback values used by the classifier when the study inputs cannot be read.
- In the live chart, the actual current colors are read from the active DeMARK 9-13 inputs and should override these defaults when available.
- Direction should still be confirmed with bar-relative placement when possible.
- If labels overlap on the same bar, the snapshot keeps both families when they are distinct. Dedupe only removes true duplicates.
