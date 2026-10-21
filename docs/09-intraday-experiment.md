# Intraday validation experiment — the protocol to run the day the data lands

This is the one test the project has never run: **does the intraday nowcast behave on
real tape the way it behaves in simulation?** Everything below is pre-registered —
written before the data exists, so the result cannot be talked into existence after
the fact.

## What the data has to be

| Field | Requirement |
|---|---|
| Instrument | CME NQ front-month continuous (ES as a second sample) |
| Granularity | 1-minute OHLCV (5-minute acceptable) |
| Session | **full Globex 18:00–17:00 ET**, not RTH-only |
| Range | 2015-01-01 to present, minimum 5 years |
| Timezone | UTC, DST-correct |
| Gaps | left missing, never forward-filled |
| Rolls | documented, prices spliced consistently |

RTH-only data would make `rthVarShare` unfittable and invalidate test 1.

## Test 1 — fit `rthVarShare` (currently an assumed 0.70)

Split each session into overnight (18:00–09:30 ET) and cash (09:30–16:00 ET).
Compute realised variance on 1-minute log returns for each block, per session.

```
rthVarShare = Σ var_cash / (Σ var_cash + Σ var_overnight)
```

Report the distribution across sessions, not just the mean — if the share is
unstable across regimes, a single constant is the wrong model and that is a finding
in itself.

**Acceptance:** if the fitted value is outside 0.55–0.85, the business-time clock
needs a regime term, not a constant.

## Test 2 — does `P(new high)` match reality?

The nowcast's core claim. For every session, at each 5-minute mark `t`:

1. Take the running high `H_t`, price `P_t`, remaining variance from the fitted
   business clock.
2. Record **predicted** `P(final high > H_t)` = `2(1 − Φ((H_t − P_t)/σ_rem))`.
3. After the close, record whether the final high **did** exceed `H_t`.

Bucket the predictions into deciles and compare predicted vs realised frequency.

| Outcome | Verdict |
|---|---|
| Max decile error < 5 points | the Monte Carlo was representative |
| Error 5–10 points | usable, note the correction |
| Error > 10 points | the reflection model is misspecified for real tape |

The falsification condition is specific: the low-prediction deciles (predicted 0–10%)
are where fat tails bite. If realised frequency there exceeds 20%, the diffusion
assumption fails and the nowcast needs a jump component — which is a different model,
not a parameter tweak.

## Test 3 — the win-rate question, measured properly

Daily bars cannot order an intraday target against an intraday stop; that is what
produced a fake 99.8% win rate. Minute bars can.

For each band touch, walk **forward** from the touch bar and record which of the
following happens first:

- target hit (`f × H` in favour)
- stop hit (`g × H` against)
- neither, session ends → exit at the close

Grid: `f ∈ {0.1, 0.2, 0.3, 0.5, 0.8, 1.0}` × `g ∈ {0.3, 0.5, 1.0, 1.5, 2.0, 3.0}`.

**Pre-registered expectation:** win rate rises monotonically as `f` falls, and
expectancy stays ≤ 0. If both hold, the 90% target is an artifact of target size, not
skill. If any cell shows win rate > 75% **and** positive expectancy **and**
`t > 2.9` (Bonferroni over 72 cells), that is a real result and worth acting on.

## Test 4 — the one positive result, examined

The daily study found **momentum at the band** (enter on the break, hold to the close)
positive on all three datasets: IXIC +$7.32/trade (t = 3.02, n = 1,185), NQ +$7.91
(t = 1.31), ES +$7.50 (t = 1.38).

The intraday data can say **why**: does the break bar itself carry the edge (order-flow
continuation, immediate), or does it accrue over the following hours (drift)? Enter at
the touch and exit after 1, 5, 15, 30 and 60 minutes, then at the close.

If the edge is concentrated in the first few minutes it is a microstructure effect that
will not survive retail execution. If it accrues slowly it is tradeable. **This is the
single most useful thing the purchase buys.**

## What would make me abandon the whole intraday branch

- `rthVarShare` unstable enough that no constant fits
- prediction-decile error > 10 points with fat tails in the low deciles
- momentum edge concentrated entirely in the first minute (unreachable after costs)

Any of those moves the project's honest conclusion to "the daily band is the deliverable,
and intraday adds nothing".

## Reporting format

Numbers, not adjectives; every figure reproducible from `data/` by a committed script.
The write-up goes in `docs/10-intraday-results.md`, and if a claim fails, the failure is
published with the same prominence as a success.
