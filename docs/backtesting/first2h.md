# First two cash hours — complete study

Window: entries only **09:30–11:30 ET**. Dashboard:
[`reports/first2h_report.html`](../../reports/first2h_report.html). Brief:
[`prompts/mega_prompt_first2h.txt`](../../prompts/mega_prompt_first2h.txt).

> **Nothing here is tradeable.** The best of 72 cells earns +$12.96 per trade with
> t = 1.28 and a 95% CI of **[−$4.91, +$34.51]** that includes zero — and
> **two trades produce 94% of the profit**. Remove them and expectancy is **+$0.85**
> over the remaining 42.

---

## 1. Exact specification

| Element | Rule |
|---|---|
| **Instrument** | CME NQ front-month, 1-minute bars |
| **Session** | 18:00 ET → 17:00 ET; elapsed minutes measured from 18:00 |
| **Entry window** | first touch must occur with `930 ≤ elapsed < 1050` (09:30–11:30 ET) |
| **Entry trigger** | `high ≥ upper band` (sell side) or `low ≤ lower band` (buy side) |
| **Entry price** | the band level; the bar's open if the session gapped through it |
| **`fade`** | buy the lower band, sell the upper band |
| **`momentum`** | the opposite |
| **Target** | `f × H` in favour, `H = (upper − lower)/2` |
| **Stop** | `g × H` against |
| **Same-bar rule** | if target and stop both occur inside one minute, the **stop** is assumed first |
| **Time stop** | any open position is closed at the **11:30 ET** bar close |
| **Nothing triggers** | no trade that session |
| **Max trades** | one per session (the first touch) |
| **Cost** | 2 bp round trip |
| **Size** | fixed $10,000 notional, no leverage, no compounding |
| **Alignment** | bands rescaled per session by `intradayOpen / dailyOpen` |

## 2. Sample

| | |
|---|---|
| Sessions | 767 |
| Sessions with a touch in the window | **44** |
| Entries by year | 2023: 5 · 2024: 22 · 2025: 17 |
| Long / short | 28 / 16 |

## 3. The grid (72 cells; top 12 by expectancy)

| dir | f | g | n | win% | expectancy | total | maxDD | t | VaR95 | CVaR95 | avgW | avgL | stops | timeouts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fade | 0.8 | 1.0 | 44 | 52.3 | **+$12.96** | +$570 | −$202 | **1.28** | $49 | $57 | $48 | −$26 | 0 | 41 |
| fade | 1.0 | 1.0 | 44 | 52.3 | +$11.64 | +$512 | −$202 | 1.14 | $49 | $57 | $46 | −$26 | 0 | 43 |
| fade | 0.5 | 1.0 | 44 | 52.3 | +$11.41 | +$502 | −$202 | 1.45 | $49 | $57 | $46 | −$26 | 0 | 37 |

**41 of 44 trades exit at the time stop. Zero ever hit a stop.** The target/stop
structure barely binds, so the 72 cells are not independent tests — they are one
two-hour hold with different clipping.

## 4. Risk assessment

| Metric | Value |
|---|---|
| Expectancy | +$12.96 (95% CI **−$4.91 to +$34.51**) |
| Win rate | 52.3% (95% CI 36.4% – 65.9%) |
| Mean win / mean loss | +$48 / −$26 |
| p5 / p50 / p95 per trade | −$57 / +$2 / +$61 |
| Worst / best trade | −$57 / +$294 |
| Skew / excess kurtosis | **+2.55 / +7.39** |
| VaR95 / CVaR95 | $49 / $57 |
| Max drawdown | −$202, 12 trades underwater |
| Bootstrapped drawdown (10k resamples) | p50 $178 · p95 $366 · p99 $474 |

**Ruin.** A 20% drawdown needs an account of ~$889 at the median, ~$1,832 at the 95th
percentile. But no-leverage forces the account to be at least the $10,000 stake, so a
20% drawdown requires $2,000 of losses — **5.5× the 95th-percentile drawdown**. Ruin
is not the binding risk. The edge is.

**Kelly.** Full Kelly = **2,889% of capital per trade**. That is not a recommendation,
it is proof the estimator is broken here: a mean whose CI spans zero divided by a
variance flattered by 41 time-stopped micro-outcomes. Rejected.

## 5. Profit concentration — the decisive number

| drop the k largest | trades left | expectancy | total |
|---|---|---|---|
| 0 | 44 | +$12.96 | +$570 |
| 1 | 43 | +$6.44 | +$277 |
| **2** | **42** | **+$0.85** | **+$36** |
| 3 | 41 | −$2.21 | −$90 |
| 5 | 39 | −$5.48 | −$214 |

Two trades (+$294, +$241) carry 94% of the result. This is the single statistic that
settles the question.

## 6. Multiple testing

72 cells → **3.3** expected to clear |t| > 2 by chance; **6** observed. Bonferroni
threshold |t| > **3.48**. Best cell: **1.28**. Nothing survives.
(The brief's arithmetic assumed 144 cells; 2 directions × 6 × 6 = 72.)

## 7. Robustness

**By year**

| Year | n | expectancy | total |
|---|---|---|---|
| 2023 | 5 | +$3.53 | +$18 |
| 2024 | 22 | +$3.12 | +$69 |
| 2025 | 17 | **+$28.47** | **+$484** |

Remove 2025 and expectancy falls to $3.2/trade on 27 trades.

**Parameter stability.** 32 of 36 same-direction cells are positive — but because 41
of 44 trades are time-stopped, those cells are near-identical, so this is not
independent confirmation.

**Entry-rule sensitivity (first touch vs break persistence)**

| persistence | n | win% | expectancy | t |
|---|---|---|---|---|
| 0 min | 44 | 52.3 | +$12.96 | 1.28 |
| 1 min | 23 | 52.2 | +$25.53 | 1.42 |
| 2 min | 23 | 52.2 | +$22.76 | 1.25 |
| 5 min | 20 | 50.0 | +$27.12 | 1.33 |
| 10 min | 21 | 38.1 | +$11.20 | 0.67 |
| 15 min | 20 | 30.0 | +$3.18 | 0.20 |

Expectancy peaks at 1–5 minutes of persistence then decays — the shape of a
short-lived effect. But the filter halves the sample to ~20 trades, so the peak is
one observation away from zero. **No variant reaches t = 1.5.**

## 8. Honest conclusion

**No variant is worth trading.** The number that kills it is not the win rate, nor the
t-statistic — it is **+$0.85 per trade after removing two trades**, on 42 observations.

A desk would reject this on sample size before it ever looked at the parameters.

## 9. Reproduce

```bash
node src/first2h_study.js    # -> reports/first2h_results.json
node src/render_first2h.js   # -> reports/first2h_report.html
```

The JSON contains `bestTradeLog` and `topTradeLogs` (three variants) with every trade's
date, side, entry, exit, reason and P&L.
