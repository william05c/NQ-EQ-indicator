# Methodology

## The problem

Predict, before the fact, where the session's **high** and **low** will sit.
Not the close, not the direction — the extremes.

That framing matters: a daily high is an **order statistic of an intraday path**. Predicting it
is a different (and harder) problem than predicting a return, because it depends on the shape of
the path, not just its endpoint.

## Why excursions, not levels

Regressing the high on past highs fails on any trending asset: the Nasdaq went from 4,200 to
27,700 over the sample, so the model learns trend, not structure. Instead we predict
**percentage excursions from the session's own open**:

```
u = (high − open) / open          upside excursion,  ≥ 0 in practice
d = (open − low)  / open          downside excursion, ≥ 0 in practice
```

Two separate models, because the upside and downside behave differently (crash risk vs melt-up).

## Features

All computed from bars **strictly before** the session being predicted:

| Feature | Definition |
|---|---|
| `rr5`, `rr20`, `rr60` | mean of `(high − low)/close` over the prior 5 / 20 / 60 sessions |
| `rv20` | sample standard deviation of log close-to-close returns over the prior 20 sessions |

Model (for each of `u` and `d` independently):

```
ln(u_t) = c0 + c1·ln(rr5) + c2·ln(rr20) + c3·ln(rr60) + c4·ln(rv20) + ε
```

Fitted by ordinary least squares, refit every 21 trading days on an expanding window.

### Why these features and not more

Deliberately excluded:

- **Yesterday's single-day range.** Tested: no accuracy gain, roughly doubles day-to-day noise
  in the forecast.
- **Range-based volatility estimators** (Parkinson, Garman-Klass, Yang-Zhang). Tested: no gain.
- **Menu of cross-asset, breadth, implied-vol inputs.** Tested in aggregate: no material gain
  at daily frequency. See [`05-limitations.md`](05-limitations.md).

The model is intentionally small. With ~3,000 effective observations and a hard information
ceiling, extra features buy variance, not signal.

## Probability bands

The prediction is a distribution, not a number. Bands come from the **empirical quantiles of
the model's own recent out-of-sample residuals**:

1. Keep a rolling buffer of the last 500 errors `ε = ln(actual) − ln(predicted)`.
2. On each session, take the 10th, 50th and 90th percentiles of that buffer.
3. Map back to price:

```
high_p  = open · exp(μ_u + ε_p)
low_p   = open · (1 − exp(μ_d + ε_{1−p}))      ← note the flip
```

The flip matters: the low is a *decreasing* function of the downside excursion, so the 10th
percentile of the low uses the **90th** percentile of the residual. Getting this backwards
produces an empty band and 0% coverage — it happened during development.

Because the quantiles are empirical and rolling, the bands adapt to the volatility regime
without assuming normality and without any external data.

## Validation protocol

Nothing is scored in-sample. Concretely:

- The first 300 sessions are training-only (plus 60 more until residual quantiles are usable).
- Refits use only data up to that point.
- A session's forecast is generated **before** its outcome is observed, then that outcome is
  appended to the residual buffer.
- Bands for session `t` use residuals through `t−1` only.

This is why coverage numbers can be trusted: an 80% band is a genuine claim tested 2,500 times.

## Benchmarks

| Benchmark | What it is |
|---|---|
| naive | yesterday's excursion carried forward |
| roll20 | mean excursion over the prior 20 sessions |
| EWMA | RiskMetrics λ = 0.94 volatility, calibrated multiplier |

The model beats all three on MAE (see [`03-backtests.md`](03-backtests.md)).

## The TradingView implementation

Pine cannot fit regressions or call external data, so coefficients are frozen and pasted in.
That is defensible because of an empirical result: **training on 24 years vs 10 years produces
identical accuracy** (55 vs 55 MAE).

| Component | Where it lives |
|---|---|
| coefficients + seed quantiles | constants at the top of the `.pine` |
| features, μ, residual buffer | computed live per bar |
| band width | 10/50/90 quantiles of the residual buffer, refreshed every 21 bars |

The result is a script that adapts to the regime while remaining a single self-contained file.
Its logic is verified against the research model in [`../src/pine_rehearsal.js`](../src/pine_rehearsal.js).
