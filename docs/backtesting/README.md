# Backtesting — separate from the forecasting docs

This folder is deliberately kept apart from `docs/00`–`docs/10`, which describe how the
forecast is built. Everything here is about **turning a forecast into a trade and measuring
what happens**. The two get confused constantly, so they live apart.

Interactive report: [`reports/backtest_dashboard.html`](../../reports/backtest_dashboard.html)
(open it in a browser; it is self-contained and works offline).

---

## 1. Three separate objects — name the one you mean

Most disagreement about this project has come from collapsing these into one word.

| # | Object | What it is | How it is measured | What it is **not** |
|---|---|---|---|---|
| 1 | **Daily model** | Predicts a session's high and low band from prior daily bars | MAE, band coverage (2,513 OOS sessions) | Not a strategy |
| 2 | **Intraday nowcast** | Given the running high/low, gives P(new high) and P(new low) | Calibration by decile (205,015 observations) | Not a strategy |
| 3 | **A trading rule** | Entry at a band touch, exit by target/stop/close | Win rate, expectancy, t-stat | Not the indicator |

> **A win rate is a property of object 3 only.** The indicator has no win rate. Every win
> rate quoted anywhere in this project belongs to a rule that someone wrote, using the
> indicator's band levels as entry prices.

## 2. Definitions

- **H** = half the band width = `(upper band − lower band) / 2`. Targets and stops are
  quoted as multiples of H so sessions of different volatility are comparable.
- **Win** = net P&L per trade > 0 after the round-trip cost (2 bp).
- **Expectancy** = mean net P&L per trade. *This is the number that decides whether a rule
  makes money, not the win rate.*
- **Hours traded** = the window in which the entry may occur. Four windows are measured:

  | id | window | ET clock |
  |---|---|---|
  | `full` | full 23-hour Globex session | 18:00 → 17:00 |
  | `rth` | cash hours only | 09:30 → 16:00 |
  | `first2h` | first two cash hours | 09:30 → 11:30 |
  | `last2h` | last two cash hours | 14:00 → 16:00 |

- **Alignment** = the daily CSV is a *back-adjusted* continuous series, sitting up to 24%
  below raw intraday prices in 2022. Bands are rescaled per session by
  `intradayOpen / dailyOpen` before use. Without this, the band is compared against a
  different price series and every result is garbage — see §6.

## 3. Data

| Item | Value |
|---|---|
| Instrument | CME NQ front-month |
| Intraday | `data/nq_1min_2022_2025.csv` — 1-minute bars, 2022-12-26 → 2025-12-11, 767 sessions, CC0 |
| Daily | `data/nq_futures_daily.csv` — walk-forward band source |
| Sessions used | 765 (2 dropped as too short) |
| Band touches | **102** (13% of sessions — consistent with a 90th-percentile band) |

## 4. Results

### Object 2 — the nowcast is calibrated

| Decile | Predicted | Realised |
|---|---|---|
| 1 | 2.1% | 3.8% |
| 5 | 45.2% | 44.1% |
| 10 | 94.9% | 95.0% |
| **Overall** | **65.8%** | **66.0%** |

Worst decile disagreement: **2.6 points**. The diffusion assumption survives real tape.

### Object 3 — no rule works

- **0 of 288** rule variants reach t > 2.
- The highest win rate with at least 20 trades is **85.7%** (first 2 cash hours, fade,
  0.1H target) and it makes **+$1.8 per trade, t = 0.31** — indistinguishable from zero.
- Widening the stop in that same cell raises nothing but the win rate; expectancy goes
  **negative** ($−0.3, −$2.2, −$4.2, −$5.0 at 1H/1.5H/2H/3H stops).

This is the concrete demonstration of the point: **a 85.7% win rate and a 0.31 t-stat can
coexist.** Win rate without expectancy is decoration.

## 5. Reproduce

```bash
node src/backtest_report.js      # recompute -> reports/backtest_results.json
node src/render_report.js        # render   -> reports/backtest_dashboard.html
node src/verify_intraday.js data/nq_1min_2022_2025.csv --split   # data integrity + Test 1
```

## 6. Errors already found here — read before trusting an earlier claim

| Error | Symptom | Consequence |
|---|---|---|
| Target credited with pre-entry moves (daily bars) | 99.8% win rate, Sharpe 7.8 | Retracted; needs sub-daily sequencing |
| Back-adjusted daily vs raw intraday | 96% of sessions "touched" the band | Retracted; fixed by per-session rescale |
| `normCdf` missing 1/√2 (Pine) | 61.6% shown as 47.5% | Fixed; lint rule added |
| Filters built from the session's own outcome | Fake Sharpe 2.67 | Retracted; prior-only filters now enforced |
| Win rate reported without expectancy | 90%+ win rates that lose | Every table now shows expectancy, t, and stop count |

The pattern: **each claim that looked too good was a sequencing or alignment error.** That is
why the dashboard shows the stop count next to every win rate — a rule with zero stops in
102 trades has not been tested against the tail.

## 7. What would change the conclusion

- More history containing crash regimes (2008, 2011, 2020). The current sample has no
  crash, so every stop-loss statistic here is optimistic.
- Tick or 1-second data, to test whether the band-break edge decays inside the first minute.
- ES as a second instrument, to see whether any surviving effect replicates.
