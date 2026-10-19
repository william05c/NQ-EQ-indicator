# Changelog

All notable changes. The project follows semantic versioning for the *interface*
(the CSV format and the Pine inputs), not for model accuracy.

## [1.0.0] — 2026-10-19

First release.

**Model**
- Two log-linear excursion models: upside `(high−open)/open`, downside `(open−low)/open`,
  fitted on 5/20/60-day mean range and 20-day realised volatility.
- Probability bands from empirical quantiles of the last 500 out-of-sample residuals,
  recomputed every 21 trading days.
- Reference scorecard (IXIC 24y, 2016-10-18 → 2026-10-16, 2,513 sessions):
  MAE 54/66, median error 0.28%/0.31%, 80% coverage 80.0%/80.5%, 31% and 28% better than naive.

**Data**
- Nasdaq Composite, 2002-01-01 → 2026-10-16 (6,255 sessions, `api.nasdaq.com`).
- NQ E-mini, 2018-04-24 → 2026-10-19 (2,199 sessions, Sina).
- ES E-mini, 2016-10-21 → 2026-10-19 (2,402 sessions, Sina).
- Three corrupt sessions corrected against two independent feeds (2015-01-21, 2015-06-30,
  2016-06-27).

**Tooling**
- `src/benchmark.js` — canonical scoring harness with the acceptance bar.
- `src/backtest_10y.js` — benchmark comparison, per-year table, regime split.
- `src/model_compare.js` — 24y vs 10y training, NQ/ES on own data, GFC robustness.
- `src/accuracy_limits.js` — the oracle test and the 90%-accuracy question.
- `src/pine_rehearsal.js` — verifies the Pine port against the research model.

**TradingView**
- `pine/nasdaq_range_forecaster.pine` — Pine v5 indicator, three asset profiles,
  live calibration table, range-expansion alerts.

**Findings recorded so they are not repeated**
- 24 years of history does not improve accuracy over 10 (55 vs 55 MAE).
- Range-based volatility estimators (Parkinson, Garman-Klass, Yang-Zhang) give no gain.
- The high's position inside the day's range is close to uniform (sd 0.32), which is the
  binding constraint on daily-frequency data.
