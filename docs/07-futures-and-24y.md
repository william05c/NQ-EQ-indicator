# 24 years of history, and an NQ/ES indicator — what it bought, what it didn't

## What was pulled

| Dataset | Coverage | Source |
|---|---|---|
| Nasdaq Composite (^IXIC) | **6,255 sessions, 2002-01-01 → 2026-10-16 (24.8 years)** | `api.nasdaq.com` (Nasdaq's own historical endpoint) |
| Nasdaq-100 E-mini (NQ) | 2,199 sessions, 2018-04-24 → 2026-10-19 | Sina global futures |
| S&P 500 E-mini (ES) | 2,402 sessions, 2016-10-21 → 2026-10-19 | Sina global futures |

Bloomberg was not the source: without a terminal or API entitlement there is no bulk
historical download, and the public site offers none. Everything above is free and
reproducible with `node ../src/build_all_datasets.js`.

## 1. Does doubling the history improve accuracy? No — measured

Same model, same test window (2016-10-18 → 2026-10-16), trained on different amounts of history:

| Training history | MAE high | MAE low | Median error | 80% coverage (high/low) |
|---|---|---|---|---|
| **24 years (from 2002)** | **55** | **67** | 0.29% / 0.32% | 79.9% / 79.6% |
| 10 years (from 2015) | 55 | 68 | 0.29% / 0.32% | 79.8% / 80.3% |

Identical to within a rounding error. This is the ceiling result from `05-limitations.md`
showing up again: the error is not caused by insufficient history, it is the unknowable
placement of the extreme inside the path. Adding 14 more years of the same daily
`open/high/low/close` information adds no new information about that.

## 2. What 24 years *does* buy: evidence the model isn't era-specific

| Test | Sessions | Median error | 80% coverage | Correlation |
|---|---|---|---|---|
| 2003-2016 (entirely unseen by the 10-year model) | 3,382 | 0.30% / 0.35% | 79.6% / 79.2% | 0.704 |
| **Financial crisis, Oct 2007 – Jun 2009** | 441 | 0.54% / 0.63% | **73.5% / 82.5%** | 0.704 |

The model was calibrated to ~80% and stayed there through the worst volatility regime in
the sample, a period it had never trained on. That is not an accuracy gain — it is
**robustness evidence**, and it is the real reason to hold 24 years. Coverage slipping to
73.5% on the high during the GFC is the honest cost of the wildest regime.

## 3. NQ/ES: own data beats proxying, and here is the catch

| Instrument | Sessions (OOS) | Median error high/low | MAE high | 80% coverage |
|---|---|---|---|---|
| NQ futures | 1,839 | 0.43% / 0.46% | 98 pts | 78.7% / 79.9% |
| ES futures | 2,042 | 0.30% / 0.33% | 21 pts | 80.3% / 80.5% |

**The catch: these are 24-hour Globex sessions, not RTH 09:30–16:00.**

| | Mean daily range | Mean gap from prior close |
|---|---|---|
| ^IXIC (cash, RTH) | 1.44% | 0.50% |
| NQ (24h) | **1.98%** | **0.14%** |
| ES (24h) | 1.40% | 0.17% |

Because the overnight move sits *inside* each bar, the range is inflated and the open is
the Globex open — which is why NQ looks "less accurate" (0.43% vs 0.29%): it is answering a
harder, different question. A trader working the 09:30–16:00 session wants RTH bars; no free
source here provides them, and that requires intraday data.

## 4. How interchangeable are they?

Daily close-to-close return correlation:

- NQ vs ^IXIC: **0.945**
- ES vs NQ: **0.929**
- ES vs ^IXIC: 0.898

Highly correlated in *direction*, materially different in *range in points*. Use each
instrument's own history for levels; use the index only as a direction proxy.

## 5. Next-session bands (roadmap for the indicator)

Anchored at the 2026-10-19 close, 24-hour session definition:

| Contract | Close | High 80% band | High median | Low 80% band | Low median | Median range |
|---|---|---|---|---|---|---|
| NQ | 29,771.25 | 29,813 – 30,371 | 30,029 | 29,067 – 29,745 | 29,538 | 491 pts (1.65%) |
| ES | 7,763.00 | 7,771 – 7,855 | 7,801 | 7,655 – 7,758 | 7,729 | 73 pts (0.94%) |

Machine-readable in `../data/nq_es_forecast.csv`.

## Verdict

- **24 years: no accuracy gain** (55 vs 55 points). It buys robustness evidence, not precision.
- **NQ/ES: correctly built now** on their own history, but the free data is 24-hour and
  therefore answers a different question than "today's RTH high and low."
- **To actually improve the trading indicator**: RTH intraday bars are the only thing that
  moves the number (see `05-limitations.md`). Everything else is already priced in.
