# Extending this — where the headroom actually is

Written so the next person does not spend a weekend rediscovering a dead end.

## The model, in one picture

```
features (prior bars only)              targets (today)
─────────────────────────              ────────────────
rr5, rr20, rr60  = mean range          u = (high − open) / open
rv20             = stdev of returns    d = (open − low)  / open
        │                                      │
        └──► OLS on ln(u), ln(d) ──► μ_u, μ_d ─┘
                                            │
residual buffer (last 500 errors) ──► p10/p50/p90
                                            │
                        high_p = open·exp(μ_u + ε_p)
                        low_p  = open·(1 − exp(μ_d + ε_{1−p}))
```

Everything is in `src/benchmark.js` (reference), mirrored in
`pine/nasdaq_range_forecaster.pine` (port).

## The one number that decides everything

Median error on the high is **0.28% of price**. An oracle handed the day's exact range in
advance scores **0.31%**, because it still has to guess *where* in that range the high
printed — and `w = (high−open)/(high−low)` has sd 0.32 and is close to uniform.

That is the wall. Any idea that only adds more **daily OHLC** is pushing against it. Before
you start, check [`05-limitations.md`](05-limitations.md).

## Already tried, did not work

Do not re-run these; the numbers are in the repo.

| Idea | Result |
|---|---|
| 24 years of history instead of 10 | **identical** (55 vs 55 MAE) |
| Parkinson / Garman-Klass / Yang-Zhang vol | **identical** (54.8 vs 54.8) |
| Adding yesterday's single-day range as a feature | no gain, ~2× more day-to-day noise |
| Naive carry-forward baseline | −31% worse than the model |
| EWMA (RiskMetrics) baseline | −5 to −7% worse than the model |

## Where the real headroom is, ranked

### 1. Intraday nowcasting — the big one

By 11:00 a large share of the day's range has already happened. Re-forecasting the final
high/low from the morning's realised path is a different and much easier problem.

- **Expected gain:** large (the only thing that moves the ceiling)
- **Data:** 1-min RTH bars for NQ/ES (Databento, Polygon)
- **How to test:** truncate each session at 10:30/12:00/14:00, forecast the final high/low
  from data up to that point, report error by cut-off time
- **Falsified if:** error at 14:00 is not materially below the daily model

### 2. Regime-conditional residual quantiles — the cheapest win

The known weakness: coverage is **91% in the calmest third** of sessions and **68% in the
wildest**. The 500-error residual window lags regime shifts by weeks.

- **Expected gain:** MAE unchanged, but the calm/wild split tightens toward 80/80
- **How:** scale the residual window by realised-vol decile, or fit quantiles on
  vol-conditioned errors; equivalently a GARCH-style variance state
- **How to test:** the calm/wild lines in `benchmark.js`
- **This is the most accessible PR in the repo** — no new data needed

### 3. Event calendar — targeted at the tail

Error by day type is 0.15% in the calmest quintile of ranges and **0.63% in the wildest**.
FOMC, CPI, NFP and mega-cap earnings are most of that tail.

- **Expected gain:** ~3–5% overall MAE, much more on the ~5% of days that matter
- **Data:** free economic calendars
- **How to test:** add a dummy, check the Q5 error specifically, verify calm days do not regress
- **Risk:** easy to overfit; use a fixed public calendar, not a hand-picked one

### 4. Options positioning (gamma, pinning, max pain)

The only *new information class* available on a daily schedule: dealer gamma constrains
where price can travel, especially into expiry.

- **Expected gain:** meaningful on expiry weeks, small otherwise
- **Data:** CBOE open interest by strike (free with delay)
- **How to test:** condition the low/high forecast on distance to the largest gamma strike
- **Falsified if:** no improvement on the top-decile-|move| subset

### 5. Pooled estimation across NQ / ES / index

Three correlated instruments, one model. Pooling (or a shared prior) may stabilise the
coefficients, particularly for NQ which has the shortest history.

- **Expected gain:** small, mostly variance reduction
- **How to test:** fit on ES+IXIC, predict NQ; compare with NQ-only fit

### 6. Conformal prediction for the bands

Replace the empirical-quantile band with split-conformal intervals, which carry a finite-
sample coverage guarantee.

- **Expected gain:** possibly better calibrated in the tails; honest coverage statement
- **How to test:** coverage per year, especially the GFC-era window (currently 73.5% on the high)

## Adding an instrument

1. Drop a CSV in `data/` with `Date,Open,High,Low,Close`, ascending, no duplicate dates.
2. `node src/benchmark.js --data your_file.csv --from YYYY-MM-DD`
3. If it scores well, `node src/fit_coefficients.js` — add a profile block to the fitter.
4. Paste the constants into the `.pine` and add the option to the `Asset profile` input.
5. `node src/pine_rehearsal.js` — the port must agree with the research model.

**Session warning:** this is where people go wrong. Daily bars from different vendors use
different session definitions. Compare the mean range and the mean gap from prior close: a
RTH series has a gap near 0.5%; a 24-hour series near 0.15%. Mixing them silently breaks the
model. See [`02-data.md`](02-data.md).

## What would falsify this project

Intellectual honesty cuts both ways. If someone shows any of these, the conclusion should
change:

- A daily-frequency feature that cuts MAE by more than 2% while holding calibration.
- Evidence that the `w` distribution is predictable ex ante — i.e. that the high's position
  inside the range is forecastable from pre-session data.
- A vendor dataset with a different session definition that materially beats this on the
  same window.

Until then, the ceiling stands, and the honest roadmap is intraday.
