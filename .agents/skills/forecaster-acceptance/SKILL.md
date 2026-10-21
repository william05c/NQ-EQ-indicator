---
name: forecaster-acceptance
description: Use before claiming any model, feature, or Pine change in this repo is an improvement — encodes the measured acceptance bar (benchmark scorecard, coverage window, Pine parity) and the three-files-move-together rule, so changes are judged by evidence instead of opinion.
whenToUse: Any edit touching src/benchmark.js, src/model*.js, src/fit_coefficients.js, pine/*.pine, or anything that changes a published number in README.md or docs/.
---

# Forecaster acceptance gate

This repo's stated product is that **its claims are measured**. So the same rule applies to
work done inside it: a change that "seems better" is how a calibrated model quietly gets
worse. Evidence before claims, always.

## The gate

```bash
node src/benchmark.js --json > before.json   # 1. capture the reference FIRST
#   ... make the change ...
node src/benchmark.js --json > after.json    # 2. capture again
diff before.json after.json                  # 3. show the delta, not a description
node src/pine_rehearsal.js                   # 4. Pine port must still agree (~2%)
node src/pine_lint.js                        # 5. all pine/*.pine files must pass
```

Run the baseline **before** editing. Reconstructing "before" from memory after the change is
not a baseline, and it is the most common way a real regression gets merged.

## Acceptance bar (Nasdaq Composite 24-year set)

Both must hold, and neither may fail on NQ or ES:

| Criterion | Threshold |
|---|---|
| MAE on the high | ≥ 2% better than reference (~54–55 pts) |
| MAE on the low | ≥ 2% better than reference (~66–67 pts) |
| 80% coverage, high and low | both stay in **78–84%** |
| Calm/wild coverage split | no worse than **91% / 68%** |
| Runtime | full 24-year run still under ~10 s |

Calibration is not negotiable. A model that gains MAE by making its bands dishonest has
made the product worse, not better — reject it and say why.

## Three files move together

A model change is not done until all three agree. Changing one and not the others is a bug:

1. `src/benchmark.js` — the reference implementation. Change it here **first**.
2. `src/fit_coefficients.js` — regenerates the constants.
3. `pine/nasdaq_range_forecaster.pine` — paste the new constants, then re-run `pine_rehearsal.js`.

## Reject on sight

- **Lookahead of any kind.** Every feature must be computable before the session's outcome is
  known. A suspiciously large jump in the scorecard usually means leakage, not insight.
- **Tuning on the test window.** If a parameter was chosen by looking at 2016–2026 results,
  say so; it gets re-run on 2003–2016 before merge.
- **More features for their own sake.** More history, better volatility estimators and
  yesterday's range were each tested and gave zero — see `docs/08-extending.md` before
  spending time on a fourth.
- **Decimal-only differences** presented as improvements.

## Style that already holds here

Plain CommonJS, no TypeScript, no bundler, and no new dependencies without discussing it
first. One script per question, question in the header comment. Print numbers, not adjectives.
Any new benchmark must be reproducible from the committed data in `data/`.

## Pitfalls worth repeating

- Never run the daily script on an intraday chart, and never the intraday script on a daily
  one — the features would be computed on the wrong bars. `pine/nasdaq_range_intraday.pine`
  is the 5-minute variant; it holds today's levels constant via `request.security`.
- Reporting a number that the scripts cannot reproduce is the highest-priority bug class in
  this repo. Reproduce first, then quote.

## When the claim is statistical, not just incremental

If a result rests on a Sharpe ratio, on many tried configurations, or on "it survived
walk-forward", load the `skill-backtest-overfit` skill: Deflated Sharpe Ratio, PBO (CSCV),
multiple-testing haircut and Minimum Track Record Length are exactly the tools for the
"how many things did I try before this worked" question that a single scorecard cannot answer.
