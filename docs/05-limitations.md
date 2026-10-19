# Can this get to 90% accuracy? What data would help?

Short version: **90% is already achieved if "accuracy" means band coverage, and is
essentially impossible if it means point precision.** Below is the measurement that
settles it, then a ranked data wishlist.

![Where the high sits inside the range](../charts/high_position_histogram.png)

## 1. The hard part isn't the width, it's the placement

The daily high is an **order statistic of an intraday path**. Knowing the day's volatility
tells you how *wide* the range will be — it says nothing about *when* in the session the
extreme prints.

Measure it directly. Let `w = (high − open) / (high − low)` be the high's position inside
the range (0 = high at the open, 1 = high at the close):

- mean 0.50, **sd 0.32** — nearly uniform
- 50% of sessions put the high **within 20% of one of the two edges**
- the distribution is U-shaped: extremes cluster at the open and the close, the middle is a valley

So imagine an **oracle that is handed the exact daily range in advance** and still has to
place the high:

| | Median error on the high |
|---|---|
| Oracle: knows the exact range, places the high at its median position | **0.310%** |
| This model, daily bars only, no oracle | **0.280%** |

The model is already **at the oracle's level** — so the residual error is not information
we are failing to extract from volatility. It is the unknowable *location* of the extreme
inside the path. More daily-frequency data cannot fix that; it is a property of the
sampling, not of the features.

## 2. "90% accuracy" — three different questions

| Definition | Status |
|---|---|
| 90% of days, the actual high is inside my band | **Already true.** The 90% band is ±0.58% of price (**±152 points** at today's level). |
| 90% of days, the point forecast is within **0.50%** | 74% today |
| 90% of days, the point forecast is within **0.25%** | 44% today |
| 90% of days, the point forecast is within **0.10%** | 17% today — this is what "90% precision" would actually require |
| 90% hit rate on *which side* the extreme appears (open-run vs close-run) | No. The U-shape is real but which mode a given day lands in is driven by intraday flow. |

You can have 90% confidence **or** 90% precision, not both. The band already delivers the
first at a width of ±0.58%.

## 3. What data would actually improve MAE — ranked

### Tier 1 — changes the problem (real gains)

**Intraday bars (1–5 minute), 5+ years.** The single highest-value addition.
- *Pre-open forecasting*: modest gain, maybe 10–20% MAE, because it only sharpens volatility
  and the gap estimate.
- *Intraday conditional forecasting*: **the big one**. After the first 30–60 minutes a large
  fraction of the day's range is already realised. Re-forecasting the final high/low at
  10:30, 12:00 or 14:00 is a different, much easier problem — because you are nowcasting a
  partly observed path rather than forecasting an unobserved one. This is where "90% within
  0.1%" becomes reachable, and it is how desks actually operate.

**Options-implied data: VIX, VIX9D, VIX3M, VVIX, gamma exposure / max-pain levels.**
Implied vol is the market's own range forecast and it reacts to scheduled events that
historical vol cannot see. Expect a **5–10%** MAE improvement, concentrated on event days,
plus better band width (the calibration weakness at 68% in the wild third).

**Economic calendar + mega-cap earnings dates.** FOMC, CPI, NFP and the big-tech earnings
dates produce 2–4× normal ranges. A day-type flag improves *calibration* markedly (wider
bands exactly when needed) and MAE by roughly **5%** overall, far more on those days.

### Tier 2 — incremental

- **Overnight / pre-market futures (NQ, ES).** The gap between prior close and open is
  currently unmodelled. Pre-market range is informative about the coming session.
- **Breadth** — advance/decline, % of constituents above their 50-day average, sector dispersion.
- **Cross-asset** — 10-year yield, dollar index, oil, credit spreads.
- **VIX term-structure slope** — contango vs backwardation is a regime signal.

### Tier 3 — marginal for this target

- Order flow / dark-pool prints (expensive, thin edge for an index-level daily forecast)
- Sentiment surveys, put/call ratios, CFTC positioning, fund flows
- Seasonality, day-of-week, month-end effects

**Realistic aggregate:** all of Tier 1 + Tier 2 *at daily frequency* might take the MAE from
~54 points to ~45 (**15–20%**). That is the honest ceiling of "add more daily data."
Intraday data is the only thing that breaks through, and it does so by changing the
question from "predict the high" to "update the high as it forms."

## 4. Where the error actually lives

Error scales with the size of the day, which tells you where to spend effort:

| Quintile of realised range | Range | Median error on the high |
|---|---|---|
| Q1 (calmest) | 0.22–0.69% | 0.15% |
| Q2 | 0.69–0.99% | 0.21% |
| Q3 | 0.99–1.32% | 0.31% |
| Q4 | 1.32–1.92% | 0.43% |
| Q5 (wildest) | 1.93–12.6% | 0.63% |

The model is already excellent on calm days and weakest exactly on the days that matter
most — event days. That is the strongest argument for the options-implied and calendar data:
it targets Q4/Q5 rather than shaving Q1.

## 5. Recommendation

1. **Now** — add a VIX/implied-vol input and an event calendar (cheap, targeted at Q5,
   improves calibration immediately).
2. **Next** — obtain 1-minute NQ/^NDX bars and build the intraday *nowcaster*. Report
   accuracy at 10:00 / 12:00 / 14:00 rather than "for the day".
3. **Ignore** — more daily-frequency features. The oracle test above shows they cannot
   move the number materially.
