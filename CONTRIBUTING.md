# Contributing

This project's value is that its claims are measured. Contributions are judged the same way.

## The rule

**Every change to the model must come with a before/after scorecard from the standard
harness.** No harness output, no merge — not because of process, but because a change that
"seems better" is how models quietly get worse.

```bash
node src/benchmark.js --json > before.json
# ... make your change ...
node src/benchmark.js --json > after.json
diff before.json after.json
```

## Acceptance bar

A model change is accepted if **all** of these hold on the Nasdaq Composite 24-year set
(`--data nasdaq_composite_IXIC_daily_2002-2026.csv`), and does not fail on NQ or ES:

| Criterion | Threshold |
|---|---|
| MAE on the high | **≥ 2% better** than the current reference (54–55 pts) |
| MAE on the low | **≥ 2% better** than the current reference (66–67 pts) |
| 80% coverage, high and low | both stay in **78–84%** |
| Calm/wild coverage split | no worse than **91% / 68%** |
| Runtime | still under ~10 s for the full 24-year run |

Calibration is not negotiable. A model that gains MAE by making its bands dishonest has
made the product worse, not better.

## What gets rejected

- **Lookahead of any kind.** Features must be computable before the session's outcome is
  known. The harness is the referee; a suspiciously large jump usually means leakage.
- **Tuning on the test window.** If you changed a parameter by looking at 2016–2026
  performance, say so — it will be re-run on 2003–2016 (the earlier era) before merge.
- **More features for their own sake.** Three separate experiments found daily-frequency
  additions give zero: more history, better volatility estimators, yesterday's range.
  See [`docs/08-extending.md`](docs/08-extending.md) before spending a weekend on one.
- **Decimal-only differences** dressed up as improvements.

## Practical setup

Node 18+. No dependencies, no build step, no API keys.

```bash
node src/build_all_datasets.js   # refresh data (optional; data/ is committed)
node src/benchmark.js            # the scorecard
node src/backtest_10y.js         # benchmark comparison + per-year table
node src/pine_rehearsal.js       # must still match the Pine port
```

If you change the model, three files move together:

1. `src/benchmark.js` — the reference implementation. Change it here first.
2. `src/fit_coefficients.js` — regenerates the constants.
3. `pine/nasdaq_range_forecaster.pine` — paste the new constants.

Then `node src/pine_rehearsal.js` must still agree with the research model within ~2%.

## Style

- Plain CommonJS, no TypeScript, no bundler, no new dependencies unless discussed first.
- One script per question, with the question in the header comment.
- Print numbers, not adjectives.
- If you add a benchmark, make it reproducible from committed data.

## Pull requests

Include in the description:

1. What you changed and why you thought it would help.
2. The `--json` before/after blocks.
3. The NQ and ES scorecards if the change touches shared code.

Small, single-purpose PRs merge fastest. A PR that improves the model *and* rewrites the
docs *and* renames files will be split.

## Reporting a wrong number

If any figure in the README or `docs/` cannot be reproduced by the scripts, that is a bug
of the highest priority — open an issue with the command you ran and the output you got.
