# First two cash hours — study and replication spec

Window: entries only **09:30–11:30 ET**. Companion dashboard:
[`reports/first2h_report.html`](../../reports/first2h_report.html).

> **Verdict up front: nothing here is tradeable.** The best of 72 cells earns
> +$12.96 per trade with t = 1.28, and the 95% bootstrap CI on expectancy is
> **[−$4.63, +$34.33]** — it includes zero. The constraint is sample size:
> **44 entries in three years.**

---

## 1. Exact specification (replicate from this)

| Element | Rule |
|---|---|
| **Instrument** | CME NQ front-month, 1-minute bars |
| **Session** | 18:00 ET → 17:00 ET; elapsed minutes measured from 18:00 |
| **Entry window** | first touch must occur with `930 ≤ elapsed < 1050` (09:30–11:30 ET) |
| **Entry trigger** | price touches the daily band: `high ≥ upper` (sell side) or `low ≤ lower` (buy side) |
| **Entry price** | the band level; if the session opened beyond it, the bar's open |
| **Direction `fade`** | buy the lower band, sell the upper band |
| **Direction `momentum`** | the opposite |
| **Target** | `f × H` in favour, `H = (upper band − lower band) / 2` |
| **Stop** | `g × H` against |
| **Same-bar rule** | if target and stop both occur inside one 1-minute bar, the **stop** is assumed first |
| **Time stop** | any open position is closed at the **11:30 ET** bar close |
| **Max trades** | one per session (the first touch) |
| **Cost** | 2 bp round trip |
| **Size** | fixed $10,000 notional per trade, no leverage, no compounding |
| **Alignment** | daily bands rescaled per session by `intradayOpen / dailyOpen` (the daily series is back-adjusted) |

Grid: `direction × f ∈ {0.1,0.2,0.3,0.5,0.8,1.0} × g ∈ {0.3,0.5,1.0,1.5,2.0,3.0}` = **72 cells**.

## 2. Sample

| | |
|---|---|
| Sessions available | 767 |
| Sessions with a band touch inside the window | **44** |
| Entries per year | 2023: 5 · 2024: 22 · 2025: 17 |
| Long / short | 28 / 16 |

Five entries in 2023 is the first warning sign: this window is not where the band gets tested. Across the full session there are 102 touches; only 44 fall in the first two cash hours.

## 3. Results

| dir | f | g | n | win% | expectancy | total | maxDD | t | CVaR95 | targets | stops | timeouts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fade | 0.8 | 1.0 | 44 | 52.3 | **+$12.96** | +$570 | −$202 | **1.28** | $57 | 3 | 0 | 41 |
| fade | 1.0 | 1.0 | 44 | 52.3 | +$11.64 | +$512 | −$202 | 1.14 | $57 | 1 | 0 | 43 |
| fade | 0.5 | 1.0 | 44 | 52.3 | +$11.41 | +$502 | −$202 | 1.45 | $57 | 7 | 0 | 37 |

**41 of 44 trades end at the time stop.** Only 3 hit target and **0 hit a stop**. The target/stop structure barely binds, which means the 72 cells are not 72 independent tests — they are one two-hour hold with slightly different clipping. That also explains why "32 of 36 cells positive" looks like stability: the cells are near-identical.

## 4. Risk assessment

| Metric | Value |
|---|---|
| Expectancy | +$12.96 (95% CI −$4.63 to +$34.33) |
| Win rate | 52.3% (95% CI 36.4% – 65.9%) |
| Worst trade | −$57 |
| VaR95 / CVaR95 per trade | $49 / $57 |
| Max drawdown | −$202 over 12 trades underwater |
| Skew / excess kurtosis | **+2.55 / +7.39** |
| Kelly fraction | not computed — an edge whose CI includes zero has no defined Kelly size |

**Ruin path.** Position size is the whole risk here. A −$202 drawdown on $10,000 per
trade is 2% of one stake, but the strategy is only "safe" because it never gets
stopped. With a 44-trade sample and a +2.55 skew, the measured drawdown is a lower
bound: the sample contains no trade that ran against the position for two hours.

## 5. Multiple testing

72 cells. Expected number clearing |t| > 2 by chance: **3.3**. Observed: **6**.
Bonferroni threshold: |t| > **3.48**. Best cell: **1.28**. Nothing survives.

## 6. Year split

| Year | n | expectancy | total |
|---|---|---|---|
| 2023 | 5 | +$3.53 | +$18 |
| 2024 | 22 | +$3.12 | +$69 |
| 2025 | 17 | **+$28.47** | **+$484** |

The result is carried by 17 trades in one year. Remove 2025 and expectancy falls to
$3.2/trade on 27 trades — noise.

## 7. What a quant would do next, in order

1. **Do not trade this.** 44 observations cannot support a decision.
2. Broaden the window. The full session has 102 touches; the first two cash hours
   have 44. If the effect is real it should exist elsewhere — testing that is a
   cheap falsification.
3. Get more history. 2008–2022 contains ~15× more sessions and the crash regimes this
   sample lacks.
4. Only then estimate risk. Every drawdown and CVaR number above is measured on a
   sample with no crisis in it.

## 8. Reproduce

```bash
node src/first2h_study.js      # -> reports/first2h_results.json (includes full trade log)
node src/render_first2h.js     # -> reports/first2h_report.html
```

Trade log: `reports/first2h_results.json` → `bestTradeLog`, one record per trade with
`date, side, entry, exit, why, at, dollars`.
