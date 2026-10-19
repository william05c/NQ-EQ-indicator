# TradingView port — install and verify

The model is now available as a native Pine Script indicator:
[`../pine/nasdaq_range_forecaster.pine`](../pine/nasdaq_range_forecaster.pine)

It draws, for every daily bar, the 10 / 50 / 90 percentile bands for **today's high and low**,
computed from the session open, plus a live calibration table.

## Install (2 minutes)

1. Open any TradingView chart — `NQ1!` or `ES1!`, **daily timeframe**.
2. Pine Editor (bottom panel) → *Open* → *New indicator*.
3. Delete the template, paste the whole `.pine` file, press **Add to chart**.

The script auto-detects the instrument from the ticker (`NQ*` → NQ coefficients,
`ES*` → ES coefficients, anything else → cash-index coefficients). You can override this
in *Settings → Asset profile*.

## What you get

- **Teal band** = 80% interval for today's high (p10–p90)
- **Maroon band** = 80% interval for today's low
- **Solid centre lines** = median forecast for each
- **Table (top right)** = live hit-rate and median error computed on the bars currently on
  your chart

Two alerts are pre-wired: *high above p90 band* and *low below p10 band* — the
range-expansion signals.

## Verify it yourself

The table is a real backtest running on your chart's history. On NQ1! daily you should see:

| Metric | Expected |
|---|---|
| High inside 80% band | ~79% |
| Low inside 80% band | ~80% |
| Median error, high | ~0.43% of price |
| Median error, low | ~0.46% |

On ES1!: ~80% coverage, ~0.30% error. On a cash index (e.g. `NASDAQ:IXIC`): ~80%, ~0.29%.

If you see ~50% coverage, you are on an intraday chart (or a symbol with a very different
session structure) — switch to daily.

## Why it can be ported at all

Pine cannot call external data or fit regressions cheaply, so the split is:

| Part | Where it runs |
|---|---|
| Regression coefficients | fitted offline on 24y index / 8.5y NQ / 10y ES, pasted as constants |
| Features (5/20/60-bar range, 20-bar realized vol) | computed live in Pine |
| Band width (residual quantiles) | computed live in Pine every 21 bars, from the model's own recent errors |

The bands are **not** static — they adapt to the volatility regime.

## Faithfulness check

I cannot compile Pine here, so I reimplemented the exact script logic in JavaScript and ran
it against the same data. Static coefficients + runtime quantiles reproduce the research
backtest:

| Asset | Rehearsal MAE_H | Reference MAE_H | Rehearsal coverage | Reference coverage |
|---|---|---|---|---|
| IXIC | 54.8 | 55 | 79.9% | 79.9% |
| NQ | 95.6 | 98 | 79.1% | 78.7% |
| ES | 19.5 | 21 | 82.0% | 80.3% |

`node ../src/pine_rehearsal.js` reproduces this table.

## Honest limitations

- **Daily bars only.** On intraday timeframes every feature is wrong by construction.
- **No repainting.** Bands use the current bar's open plus closed-bar history only; they are
  fixed once the bar opens.
- **Static coefficients.** Accuracy is insensitive to the fit window (24y and 10y score
  identically), which is why this is safe — but a structural regime change would need a refit.
- **Session definition.** NQ/ES coefficients were fitted on 24-hour Globex bars. If your
  chart uses RTH-only data, prefer the cash-index profile or refit on RTH data.
- **Not a strategy.** No entry/exit logic is included on purpose — daily-bar fills would be
  optimistic. Use TradingView's *Bar Replay* if you want to test discretionary use.
- The table's coverage is computed with coefficients fitted on history, so treat it as a
  sanity check on calibration, not as a clean out-of-sample result. The clean numbers are in
  `03-backtests.md`.

## Refreshing the coefficients

After updating the data or adding years:

```
node ../src/build_all_datasets.js     # refresh the three CSVs
node ../src/fit_coefficients.js       # prints new coef/seed constants
```

Paste the printed values into the constant block near the top of the `.pine` file. Only
those 16 numbers need updating.
