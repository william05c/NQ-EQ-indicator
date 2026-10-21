# Intraday data provenance

## Source in use

Kaggle: `tgtanalytics/nq-futures-1min-bar-2022-2025`
Licence: CC0 public domain. Downloaded 2026-10-20, unauthenticated.

| Property | Value |
|---|---|
| Rows | 1,048,575 data rows |
| Coverage | 2022-12-26 18:01 ET -> 2025-12-11 20:52 ET |
| Sessions | 767 (median 1,380 one-minute bars each = a full 23h session) |
| Columns | timestamp ET, open, high, low, close, volume, Vwap_RTH, Vwap_ETH |
| Integrity | 0 unparseable, 0 out-of-order, 0 duplicates, 0 OHLC inconsistencies |

Notes:
- Timestamps are **US Eastern**, confirmed by the bar-count pattern (Friday 1,020 bars
  ending 17:00, Sunday 360 bars starting 18:00).
- The file stops mid-session at exactly 2^20-1 rows, so the final session is truncated.
  `src/verify_intraday.js` drops sessions under 90% of the median bar count, which
  covers this and the genuine half-days (32 sessions).
- The CSV is git-ignored: 69 MB does not belong in the repository. Re-download and
  re-run `src/verify_intraday.js` to reproduce.

## Why not the alternatives

- Databento (GLBX.MDP3) is the better dataset - 19 years, exchange-grade - but signup
  was unavailable. Its $125 credit remains the recommended route for a longer sample.
- FirstRate Data (NQ, 2008->present) verified spec-compliant via its free sample, but
  one-off purchase pricing is only shown at checkout.
- Yahoo / Polygon free tiers give 60 days of 5-minute bars: insufficient.