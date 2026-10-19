# What the indicator shows, and how to read it

## On the chart

For every daily bar the script draws six levels, all computed from that bar's **open** plus
history that closed before it:

```
                 ── high p90 ──   the day runs hot: extreme at or above this is ~10% likely
   ▒▒▒▒▒▒▒▒▒▒    ── high p50 ──   median expected high
                 ── high p10 ──   even a quiet day usually reaches here

                 ── low  p90 ──   even a quiet day usually dips here
   ▒▒▒▒▒▒▒▒▒▒    ── low  p50 ──   median expected low
                 ── low  p10 ──   a hard sell-off reaches down to here
```

The shaded areas are the 80% intervals: the high lands inside the top band about four sessions
in five, and likewise for the low.

## Worked example — NQ, next session

| | Value |
|---|---|
| Anchor (last close) | 29,771.25 |
| High, 80% band | 29,813 – 30,371 |
| High, median | 30,029 |
| Low, 80% band | 29,067 – 29,745 |
| Low, median | 29,538 |
| Median implied range | 491 pts (1.65%) |

Read as: *"a normal session tops out near 30,029 and bottoms near 29,538; if it trades above
30,371 it is an unusually wide day (~1 in 10)."*

ES, same session: median high 7,801, median low 7,729, implied range 73 pts (0.94%).

## The three things it is actually good for

**1. Stop placement.** A stop inside the band is likely to be clipped by noise that has nothing
to do with your thesis. Placing it beyond the p10 (long) or p90 (short) says: *I only get
stopped if the day is a genuine outlier.* That is a defensible rule, and it is quantified.

**2. Position sizing.** Band width is a volatility forecast. Wide band → smaller size for the
same dollar risk. This is the same information an ATR-based sizing rule uses, but with
explicit probabilities rather than a multiple.

**3. Expansion detection.** The two built-in alerts fire when price exceeds the p90 high or
breaks the p10 low. By construction that happens ~10% of sessions — so it is a real signal, not
a threshold someone eyeballed. Expansion days often become trend days.

## What it deliberately does not tell you

| Question | Answer |
|---|---|
| Will the high come before the low? | **Unknown.** The model has no path information. |
| Will the close be up or down? | **Unknown.** Excursions are symmetric by construction. |
| Exactly where is the high? | Median error ~0.3% of price. The band is the deliverable. |
| Is this a good entry? | Not its job. It describes the range, not the direction. |

## Before you trade with it

1. **Check the table.** The indicator prints its own hit-rate on your chart. High coverage should
   read ~79–80%. If it reads ~50%, you are on an intraday timeframe — the features are wrong there.
2. **Confirm the session.** NQ/ES coefficients were fitted on 24-hour Globex bars. If your chart
   is RTH-only, switch the profile to *Cash index (RTH)*.
3. **Expect regime drift.** In calm weeks the bands look too wide; in violent weeks too narrow.
   Coverage is 91% in the calmest third of sessions and 68% in the wildest third — that is
   documented, not hidden.
4. **Backtest any rule yourself.** No strategy is included on purpose: daily-bar fills would
   flatter it. Use TradingView's Bar Replay.

## A note on the median lines

The centre lines are **medians**, not means. Because the range distribution is right-skewed, the
median sits roughly 9% below the average range. If you average many sessions you will see the
realised range come in slightly wider than the median implied range — that is correct behaviour,
not a bug.
