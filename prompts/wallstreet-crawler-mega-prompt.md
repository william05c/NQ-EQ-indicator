# MEGA-PROMPT — SENTINEL: Public-Company Intelligence Engine

You are building a production-grade, local-first research engine that crawls publicly available Wall Street data, reasons over it, and writes reports that can be checked line by line. This document is your complete specification. Read all of it before you write a single file.

---

## 0. Contract with me

- Deliver a **working system**, not a plan, not a scaffold, not a demo with hard-coded numbers.
- **Evidence over assertion.** Every claim you make about the system ("it works", "it reconciles", "it is accurate") must be backed by a command you ran and its output. If you have not run it, say so.
- **Never fabricate data.** If a source is blocked, rate-limited, missing or changed, record the gap in the source registry and in LIMITATIONS.md. A hole you document is worth more than a number you invent.
- **Small, honest, tested beats large, vague, untested.** Prefer a narrow vertical slice that reconciles exactly to SEC XBRL over a broad pipeline that is approximately right.
- **No placeholders in shipped paths.** No "TODO", no "implement later", no function that returns a constant because the real one was hard.
- When you must stop and ask, batch your questions (maximum five at once) and keep going on everything that does not depend on them.

---

## 1. Mission

Build **SENTINEL**: a system that answers, from public data only, questions of the form:

> "What is true about this company, what is changing, which measurable things actually matter for its future returns and fundamentals, how confident am I, and where is the evidence?"

The product is not a dashboard and not a price predictor. The product is **findings with provenance**: a growing, auditable ledger of statistically tested observations about US-listed companies, each one traceable to a filing and reproducible with one command.

Three layers, in this order of importance:

1. **Truth layer** — a point-in-time warehouse of company facts, filings, ownership, prices and text, where every row can be traced to a URL, an accession number and a retrieval timestamp.
2. **Reasoning layer** — correlation, importance ranking, anomaly detection, event studies, peer matching and calibrated extrapolation, all with statistics discipline and explicit falsifiers.
3. **Expression layer** — reports and a dashboard that render numbers **from the database**, never from memory, with a machine check that proves it.

The same engine serves two rhythms, and neither is a bolted-on extra: a **standing watch** that runs unattended and tells me what changed, and a **desk tool** I point at one company when a question occurs to me. Both read the same point-in-time warehouse, so the answer I get on demand is built from exactly the data the watch has been maintaining.

---

## 2. Definition of done

The system is done when I can run one command on a clean machine and get:

1. A local warehouse containing, at minimum, 500 US-listed companies with 10+ years of XBRL financial history, filing metadata, insider transactions, 13F holdings, daily prices, and extracted filing text — **including companies that have since been acquired or delisted**.
2. An automated data-quality report: coverage per metric, null rates, schema drift, unit anomalies, unanswered gaps.
3. At least **thirteen report types**, each generated end-to-end from the database, each with a provenance appendix.
4. A **findings ledger** with at least 25 findings produced by the system, graded A/B/C, each with a falsifier and a rerun command.
5. A calibration table for at least one forecasting task that shows the system's own hit rate out of sample — including where it loses to a naive baseline.
6. A verification gate that fails the build if any number in any report cannot be re-derived from the database.
7. A test suite that runs offline, plus a hand-checked golden set proving the numbers are right, not merely present.
8. A scheduled watch that runs unattended, detects genuine change, and produces a digest ranked by materiality — silent on days when nothing material happened.
9. An on-demand path: one command for one company, answering in seconds from warm data, and always telling me how fresh that data is.
10. A git repository whose history documents the build: tagged phase commits, a BUILD-LOG.md mapping each phase to its commits and its gate evidence, a README a stranger can follow, MIT licence, and CI that runs the offline tests on a fresh machine and passes.
11. Every digest and report downloadable as Markdown, self-contained HTML, CSV and JSON, plus a ZIP bundle, all with provenance attached.

If any of these cannot be met with free public data, say exactly which one, why, and what the minimum paid alternative would cost. Do not quietly lower the bar.

---

## 3. Scope

### 3.1 In scope

- **Universe:** all companies listed on Nasdaq and the NYSE that are or were constituents of the S&P 500, plus the Nasdaq-100 and the Nasdaq Composite. Practically: build the mechanism for "any US-listed operating company with an SEC CIK" and default the seed universe to S&P 500 + Nasdaq Composite membership, including historical membership.
- **History:** as deep as the data goes. XBRL facts from 2009 (when XBRL became mandatory, phased 2009–2011); older financials only if they can be parsed from filing documents rather than invented. Prices 15+ years. Filings back to at least 2001 where available.
- **Entity coverage:** operating companies, banks, insurers, REITs, utilities, foreign private issuers filing 20-F/6-K, dual-class structures, SPACs and de-SPACs, recent IPOs, and dead companies.

### 3.2 Explicitly out of scope (anti-goals)

- No order execution, no broker connection, no portfolio management, no trade recommendations.
- No real-time or intraday tick data. Daily bars only.
- No paywalled, login-walled, CAPTCHA-gated or ToS-violating scraping. No LinkedIn, no Glassdoor scraping, no credit-card panels, no "alternative data" that requires impersonation.
- No LLM-authored numbers. Language models may narrate, classify and summarise; they may never be the source of a figure.
- No claim of prediction accuracy that has not been measured out of sample.
- No redistribution of licensed exchange data or licensed index constituent files. Local research use only.
- Not a market simulator, not a charting platform, not a social product.

### 3.3 The existing repository

There is an existing project in this workspace (a calibrated Nasdaq range forecaster, Node.js, zero dependencies). **Do not modify it.** Build SENTINEL as a new, self-contained top-level folder. However, match its engineering culture, which is the standard I hold this work to:

- free public data, no required paid keys;
- walk-forward validation with no look-ahead;
- the system publishes its own hit rate so a sceptic can check it;
- an offline dashboard that works by opening a file;
- claims phrased with stated odds, never with certainty.

---

## 4. Non-negotiable principles

**P1 — Provenance or it did not happen.** Every fact row carries: source system, exact URL, accession number, document hash, retrieval timestamp (UTC, ISO-8601), parser version, and the run that produced it. A number that cannot be traced is a bug.

**P2 — Point-in-time.** Every table that can be revised keeps every version. Queries accept an as_of timestamp and must never see a fact that was filed after it. This is not a feature; it is the difference between a research tool and a fantasy machine.

**P3 — No survivorship.** Dead companies stay in the database forever, flagged. Any universe or backtest that silently drops them is wrong, and a test must prove they are present.

**P4 — Reproducibility.** Given a snapshot hash and a command, any past report regenerates byte-identical (modulo timestamps). Seed every stochastic process.

**P5 — Statistics discipline.** No correlation without n and a confidence interval. No feature importance without multiple-testing control and subperiod stability. No forecast without a calibration table and a naive baseline.

**P6 — Honest language.** The system says "in this sample", "as of", "associated with", "no significant edge". It never says "will", "guaranteed", "proven", "caused" unless the causal claim survived a design that supports it.

**P7 — Graceful degradation.** A dead source must not kill a run. Every adapter is independently disableable, and every report declares what was missing when it was generated.

---

## 5. Prior art — study these before you design

Spend real time on this section. Do not copy code blindly, and be careful with licences (GPL code must not be pasted into a permissively licensed product).

| Project | What it is | What to take from it |
|---|---|---|
| **SEC EDGAR APIs** (data.sec.gov) | Official JSON APIs: submissions, company facts, company concepts, XBRL frames | The backbone. Company facts is one request per company for its entire XBRL history — far better than crawling filings page by page |
| **SEC bulk data sets** | Quarterly zipped financial statement data, notes data, insider transactions, 13F datasets | The fast path for backfill. Hundreds of thousands of facts in one download instead of hundreds of thousands of requests |
| **nlpaueb/edgar-crawler** (~550★, GPL-3.0) | Downloads 10-K/10-Q/8-K and extracts specific item sections into clean JSON; published at WWW 2025 | The section taxonomy and the "extract sections, not whole documents" discipline. **Licence: GPL — read it, do not copy it** |
| **dgunning/edgartools** (~2.8k★, MIT) | Pythonic EDGAR: filings, XBRL financial statements, Form 3/4/5, 13F, ADV | API ergonomics for a filings object model; a possible optional dependency. Note how it normalises statement line items |
| **jadchaar/sec-edgar-downloader** (~700★, MIT) | Robust bulk filing downloader with filters and retries | Downloader ergonomics: company/CIK/form filters, resumable batches, sane retry policy |
| **OpenBB** (~74k★) | Open data platform for analysts and agents | The provider-adapter pattern: one standard model, many providers, explicit fallbacks, uniform metadata |
| **microsoft/qlib** (~50k★, MIT) | AI-oriented quant research platform | Point-in-time store conventions, factor expression evaluation, alpha evaluation methodology |
| **stefan-jansen/machine-learning-for-trading** (~21k★, MIT) | Book code, data sourcing to evaluation | Alphalens-style factor evaluation: information coefficient, quantile spreads, turnover, decay |
| **virattt/ai-hedge-fund** (~64k★, MIT) | Multi-agent analyst simulation | Report sectioning and analyst personas. **Do not copy its failure mode** — plausible prose with numbers that were never computed |
| **sharadar SF1 (commercial)** | Point-in-time fundamentals dataset | Read its schema documentation as the reference design for point-in-time fundamentals. Do not depend on it |
| **edgarWebR (R)** | Column-oriented EDGAR search | Query design for "give me all filers with this phrase in this form type in this window" |

After you have read them, write a short section in ARCHITECTURE.md titled "What we borrowed, what we rejected, and why". One paragraph per project. This is a required deliverable, not decoration.

---

## 6. Data source registry

The registry is the single source of truth for what the system touches. Every adapter declares: name, what it provides, auth, documented rate limit, our configured limit, licence/ToS summary, cache TTL, and a live probe result.

### 6.1 Tier 0 — required, free, no paid key

| Source | Yields | Notes and constraints |
|---|---|---|
| data.sec.gov submissions JSON | Full filing history per CIK: form type, dates, accession, items, primary document | One call per company. Contains prior names and former tickers |
| data.sec.gov company facts | Every XBRL fact ever filed by a company, with form, fiscal period, filed date, frame | Large payloads (single-digit to tens of MB). Cache aggressively |
| data.sec.gov company concept / frames | One tag across time, or one tag across all companies in a period | Frames are how you compare peers without downloading everything |
| EDGAR full-text search (efts) | Phrase search across filing text, 2001 onward | Use for targeted hunts: "going concern", "material weakness", "restatement", "covenant waiver" |
| SEC financial statement data sets | Quarterly zips: submissions, numeric facts, tags, presentation | Backfill engine. Prefer this to per-company crawling for volume |
| SEC insider transactions data sets | Form 3/4/5 in tabular form | Same reasoning: bulk first, API second |
| SEC 13F data sets | Institutional holdings by period | Remember the 45-day filing lag; state it in every report that uses it |
| SEC company tickers JSON (incl. exchange variant) | Ticker ↔ CIK ↔ exchange spine | Seed of entity resolution. Incomplete and stale — treat as a starting point |
| SEC filing indexes | Per-day and per-quarter lists of every filing | Change detection and gap filling |
| FRED | Macro series: rates, CPI, GDP, spreads, unemployment | Free API key. Cache with long TTL |
| Ken French Data Library | Factor returns (market, size, value, momentum, profitability, investment) | No key. Fixed files, versioned by update date |
| Index provider holdings (e.g. IVV/SPY constituent files) | Current membership | Point-in-time membership must be reconstructed from history, not assumed |
| Wikipedia index-constituent pages | Historical membership changes | Scrape politely, cache, and cross-check against provider files. Flag disagreement |
| Stooq or yfinance | Daily OHLCV | **Unofficial.** Disabled by default behind a config flag, with the ToS caveat documented in the registry |

### 6.2 Tier 1 — recommended, free tier with key (optional adapters)

Alpha Vantage, Financial Modeling Prep, Finnhub, Tiingo, Polygon. Use for: price cross-checks, earnings calendars, splits/dividends, company profiles, news headlines. Each adapter must degrade cleanly when the key is absent. **Do not hard-code free-tier limits from memory — read them from the provider docs at build time and put them in the registry.** Assume the documented limit and then apply 20 percent headroom.

### 6.3 Tier 2 — optional, only if cheap to add

GDELT (news volume and tone), USPTO PatentsView (patent grants), BLS and BEA (labour and output), Nasdaq short interest, options chains, Common Crawl for archived pages. Add these only behind a feature flag, and only after Tier 0 is solid.

### 6.4 Compliance rules — hard requirements

- **SEC:** a descriptive User-Agent on every request of the form SENTINEL-research/0.1 (william.cossey05@yahoo.com). Be aware this address appears in SEC server logs and is effectively public — that is the standard and expected trade for polite automated access. Store it in config, never hardcode it in source.
- **SEC rate:** **no more than 10 requests per second sustained**; honour Retry-After; exponential backoff with jitter on 403/429/5xx; never parallel-hammer a single host; prefer bulk downloads over thousands of small requests.
- **robots.txt** fetched, parsed and obeyed per host, including crawl-delay.
- **No** paywall circumvention, no CAPTCHA solving, no credential sharing, no scraping behind a login.
- **Personal data:** only what is disclosed in filings about officers, directors and large holders. No scraping of personal social media.
- **Licensing:** record the licence/ToS summary per source. Market prices from an exchange are licensed; store locally for research and never redistribute.
- Every report ends with a disclaimer that this is research, not investment advice.

### 6.5 Registry verification

Before writing any ingestion code, probe every Tier 0 endpoint live and record: HTTP status, latency, response size, a trimmed sample payload, and the exact schema shape you observed. Write it to docs/SOURCE_REGISTRY.md and commit it. Where my description and reality disagree, **reality wins** — update the doc and tell me.

---

## 7. Architecture

### 7.1 Components

1. **Adapters** (one per source): declare metadata, fetch raw bytes, parse to a normalised record, expose a schema. Stateless.
2. **Crawler kernel**: per-host token-bucket rate limiter, retry/backoff, circuit breaker, robots cache, content-addressed raw store, request log, resume state.
3. **Warehouse**: DuckDB file plus Parquet partitions; migrations; views that implement the as-of contract.
4. **Normaliser**: tag→metric mapping, fiscal-period alignment, restatement tracking, unit and scale checks, split/dividend adjustment.
5. **Feature builder**: derived metrics and industry-relative scores, each with a documented formula.
6. **Analytics**: correlation, importance, anomaly, event study, ownership flow, peer matching, forecasting.
7. **Report engine**: templates that bind to queries, provenance appendix, numeric verification gate.
8. **Dashboard**: local web UI over the warehouse.
9. **QA**: data-quality monitors, reconciliation checks, golden-set tests, bias tests.
10. **CLI**: every capability reachable from one command with --help that actually explains it.

### 7.2 Stack — my defaults, change only with a written reason

- Python 3.11+, managed with uv (or pip + requirements lock).
- httpx for HTTP, selectolax or lxml for HTML, pdfplumber for PDFs, openpyxl for XLSX.
- polars for heavy transforms, pandas where the ecosystem demands it.
- DuckDB as the warehouse, Parquet as the cold store.
- pydantic v2 for record schemas, pydantic-settings for config.
- scipy, statsmodels, scikit-learn; lightgbm optional.
- Jinja2 for reports, Plotly or ECharts for charts, WeasyPrint optional for PDF.
- FastAPI + Jinja + HTMX for the dashboard.
- Typer for the CLI, pytest + respx/vcrpy for tests, ruff + mypy for hygiene.
- Windows-first: every command must work in PowerShell, and a single bootstrap script must set up the environment.

### 7.3 Repository layout

    sentinel/
      README.md
      pyproject.toml
      config/
        sources.yaml          # enable/disable, keys, limits
        universe.yaml         # seed universe + provenance
        metrics.yaml          # metric dictionary (tag chains, signs, units)
      src/sentinel/
        cli.py
        adapters/             # one module per source
        crawler/              # rate limiter, cache, retry, robots, resume
        warehouse/            # schema.sql, migrations, connection, as-of views
        normalize/            # tag map, periods, restatements, adjustments
        features/             # derived metrics, industry z-scores
        analytics/            # correlation, importance, anomaly, events, forecast
        reports/              # templates, renderers, verifier
        web/                  # FastAPI app, templates, static
        qa/                   # monitors, reconcilers
      sql/
      data/
        raw/<source>/<sha256>.gz
        warehouse/sentinel.duckdb
        snapshots/<hash>/manifest.json
      reports/out/YYYY-MM-DD/
      tests/
        fixtures/             # cassettes and golden CSVs
      docs/
        ARCHITECTURE.md  DATA_DICTIONARY.md  SOURCE_REGISTRY.md
        LIMITATIONS.md   RUNBOOK.md          BIAS_REGISTER.md
      scripts/bootstrap.ps1

### 7.4 Data flow

    source → raw bytes (hashed, immutable) → parsed records → validated → normalised
      → warehouse tables → as-of views → features → analytics → findings ledger
      → report templates → rendered report + provenance.json → verification gate

The raw layer is immutable and content-addressed. Re-parsing never requires the network. This is what makes the system debuggable two years from now.

### 7.5 Two operating modes, one truth layer

**Mode A — Watchtower (unattended).** A scheduled run that keeps the warehouse current and tells me what changed. It is not a crawler that dumps files into a folder; it is an editor deciding what deserves my attention.

- Runs daily, plus a weekly deeper sweep, with no interaction.
- Uses the SEC daily index to find what actually changed, then fetches only that. Incremental cost should be minutes, not hours.
- Diffs every changed document against its prior version. A hash change is not automatically news; a **materiality scorer** decides what surfaces (see 15.5).
- Produces a change digest, and a narrower brief for a configured watchlist.
- Is **quiet by default**. A day with nothing material produces one line saying so. No filler, no padding invented from noise.

**Mode B — Desk (on demand).** One command, one company, a complete answer.

- Any of ticker, CIK, CUSIP or name fragment resolves to the company and returns the dossier.
- Warm path under five seconds from the warehouse; cold path (a company never ingested) under sixty seconds including a targeted fetch.
- Opens with a **freshness header**: as_of, last successful refresh per source, and an explicit warning when any source is stale or degraded.
- Never silently answers from yesterday's cache when newer data exists, and never hides that it did.

**Shared rules that make the two modes one system:**

- One warehouse, one schema, one analytics layer. The desk must not have a private data path, because two paths means two sets of numbers that will eventually disagree.
- The desk may force a refresh for one company; that refresh updates the shared warehouse, so the watch benefits. No side-channel caches.
- Both modes emit identical provenance records and pass the same numeric verification gate.
- Freshness is a first-class field on every output the system produces, not a footnote.

---

## 8. Crawl layer requirements

- **R-CRAWL-1 Idempotence.** Fetching the same URL twice inside its TTL downloads once. Conditional requests (ETag / If-Modified-Since) where the source supports them.
- **R-CRAWL-2 Resumability.** Killing the process mid-run loses at most one in-flight request. State is checkpointed per queue, not per run.
- **R-CRAWL-3 Per-host token bucket.** Configurable rate and burst; defaults strictly below documented limits; the limiter is the only path to the network.
- **R-CRAWL-4 Backoff.** 429/5xx → exponential with jitter, capped, then escalate to circuit-open.
- **R-CRAWL-5 Request log.** Every request recorded: URL, source, timestamp, status, bytes, latency, attempt, cache hit, user agent.
- **R-CRAWL-6 Content-addressed raw store.** Bytes written once, keyed by SHA-256, indexed by URL and retrieval time. Documents are never overwritten.
- **R-CRAWL-7 Change detection.** Re-fetched documents that differ in hash are marked as revisions. A changed 10-K is a finding, not a silent update.
- **R-CRAWL-8 Scheduling.** Daily incremental, weekly full-text sweeps, monthly bulk refresh. Implemented via CLI plus a documented Task Scheduler/cron recipe — not a daemon that must stay resident.
- **R-CRAWL-9 Circuit breaker.** After N consecutive failures on a source, disable it, mark dependent outputs as degraded, and continue.
- **R-CRAWL-10 Budget governor.** Configurable max requests/day and max bytes/day per source, logged as consumed budget.
- **R-CRAWL-11 Change-driven refresh.** The daily run starts from the SEC daily index and the sources' own change feeds, not from the universe list. Fetching 500 companies to discover that 12 filed is a design failure.
- **R-CRAWL-12 Freshness stamping.** Every table row and every derived output records when it was last successfully refreshed, and every consumer can ask how old its inputs are.

---

## 9. Storage and data model

### 9.1 Tables

At minimum (extend as needed, document everything in DATA_DICTIONARY.md):

- **dim_company** — cik (PK), name, former names, sic, naics, sector, industry, state of incorporation, fiscal year end, status (active/delisted/acquired), first and last filing date.
- **dim_security** — ticker, exchange, cik, share class, valid_from, valid_to, is_primary. Slowly changing; tickers are attributes of a security, never a primary key.
- **dim_index_membership** — index code, cik, valid_from, valid_to, source.
- **fact_filing** — accession (PK), cik, form type, filed date, acceptance datetime, period end, 8-K items, document count, primary document URL, is_amendment, document hash.
- **fact_xbrl** — grain: one reported fact per filing. accession, cik, taxonomy, tag, label, unit, value, decimals, frame, period type, period start, period end, fiscal year, fiscal period, form, filed date, accepted at, source URL.
- **fact_xbrl_canonical** — cik, period end, period type, metric_id, value, unit, method used, contributing tags, confidence, lineage accession.
- **map_tag** — taxonomy, tag, metric_id, sign multiplier, scale, priority, confidence, notes.
- **fact_price** — cik, ticker, date, open, high, low, close, volume, adjusted close, adjustment factor, source.
- **fact_ownership** — form type, accession, filer cik, issuer cik, insider name and relationship, transaction code, shares, price, shares after, transaction date, filed date.
- **fact_13f** — accession, manager cik, period, cusip, issuer cik, shares, value, put/call, discretion, filed date.
- **fact_corporate_action** — cik, action type (split, dividend, merger, spinoff, name change, ticker change, delisting, bankruptcy), effective date, ratio, cash amount, counterparty.
- **dim_document_section** — accession, section id, section name, text, char count, sentiment scores, readability, hash.
- **fact_news** — id, source, URL, published at, title, body, tickers, sentiment, dedupe cluster.
- **fact_macro** — series id, date, value, unit, source.
- **crawl_log**, **dq_issue**, **finding**, **report_run**, **data_snapshot**.

### 9.2 Mandatory provenance columns

On every fact table: source_system, source_url, retrieved_at (UTC), accession_no, document_sha256, parser_version, extractor_run_id, schema_version.

### 9.3 The as-of contract

Every analytic function and every report takes as_of (default: now, truncated to date). Warehouse views enforce it. The test that proves it:

> Generate a report with as_of = 2020-01-01 and assert that no number in it derives from a fact with accepted_at later than 2020-01-01. This test must run in CI and must be able to fail.

### 9.4 Snapshots

Before generating a dated report: hash every table (row count plus a stable content hash), write data/snapshots/<hash>/manifest.json, and stamp the hash into the report front matter. Regenerating that report later must reproduce it from that snapshot.

---

## 10. Universe and entity resolution

- **CIK is the primary key** for a company. Tickers, names and exchanges are time-varying attributes.
- Ticker reuse is real and dangerous. Every ticker→company link carries valid_from/valid_to, and the resolver refuses to map a ticker to a company outside its validity window without an explicit override.
- **Corporate actions rewrite identity.** Mergers, spinoffs, name changes and ticker changes must produce successor/predecessor links, not silent renames.
- **Delisted and acquired companies are retained forever** with status and dates. Any universe query defaults to including them, with an override for "currently tradable only".
- **Index membership is historical**, reconstructed from provider files, Wikipedia changes, and filings where available. Where sources disagree, keep both and flag the conflict.
- **Foreign private issuers** file 20-F/6-K and use IFRS taxonomies. Handle them or exclude them explicitly — do not silently mis-parse them as US GAAP.
- Provide a resolver CLI: given any of ticker, CIK, CUSIP, name fragment or LEI, return the company and the resolution path with confidence.

---

## 11. Normalisation and the metric dictionary

This is the hardest part of the build and the part that decides whether the reports are worth anything.

- **Metric dictionary:** at minimum 60 canonical metrics covering the three statements plus shares and per-share items, each with: metric_id, display name, statement, sign convention, unit, an **ordered chain of candidate us-gaap tags**, fallback logic, and a one-line definition.
- **Tag drift is the norm.** Example: revenue arrives as RevenueFromContractWithCustomerExcludingAssessedTax, or Revenues, or SalesRevenueNet, depending on era and industry. The dictionary must express priority order, and the pipeline must **record which tag was chosen**. A tag switch inside one company's history is itself a data point worth surfacing.
- **Restatements:** the same (cik, period, tag) reported in different filings is normal. Keep every version; mark original versus latest; compute restatement delta and percentage; expose it in reports. Silent overwriting is a P1 violation.
- **Fiscal calendars:** 52/53-week retailers exist. Map to fiscal_year, fiscal_period and period_end; never align by naive calendar quarter without flagging it.
- **Units and scale:** unit strings come from XBRL. Detect scale errors (values off by 1000) with cross-checks against prior periods and against frames, and **quarantine** rather than silently repair.
- **Adjustments:** raw prices stored untouched; split and dividend adjustments derived from corporate actions into separate columns; both available to analytics.
- **Derived features:** margins, returns, leverage, liquidity, efficiency, growth (YoY, 3-year CAGR, TTM), working-capital cycle, accruals, free cash flow, NOPAT, invested capital, ROIC, and industry-relative z-scores. Every derived feature documents its formula, its inputs, and its missing-input behaviour.
- **Industry relative, not absolute.** Most ratios are only meaningful within an industry. Compute z-scores within SIC-based buckets and say so.

---

## 12. Document and text intelligence

From 10-K (Items 1, 1A, 7, 7A, 8), 10-Q (Part I Items 2 and 4), 8-K (notably 2.02 results, 1.01 material agreements, 5.02 officer changes, 4.02 non-reliance), and DEF 14A:

- Extract sections into structured text with page anchors.
- Score with the **Loughran-McDonald** finance dictionaries: positive, negative, uncertainty, litigious, constraining; plus Fog readability, length, and a boilerplate ratio (n-gram overlap with the prior year).
- **Narrative drift detection:** TF-IDF diff against the same company's prior year, surfacing the newest and most distinctive phrases, each linked to its sentence and accession. New language about liquidity, covenants, going concern or auditor issues is exactly the kind of "significant finding" this system exists to produce.
- **Disclosure event flags:** auditor change, going-concern language, material weakness, restatement or non-reliance, late filing notice, officer departure, covenant waiver, guidance withdrawal.
- Every text metric must be reproducible from the stored section text; no re-download required.

---

## 13. Analytics

Every method below ships with its assumptions, its sample size, and its failure modes written next to it.

### 13.1 Company fingerprint and peer matching

Build a ~40-dimension vector of industry-neutralised ratios per company-year. Cosine similarity yields a comparable set. Validate on at least 20 hand-labelled pairs (for example KO/PEP, V/MA, XOM/CVX, HD/LOW) and report precision@10. If the fingerprints do not recover obvious peers, the features are wrong — fix them before trusting anything downstream.

### 13.2 Accounting-quality and red-flag scorecard

Implement and document: Beneish M-score, Altman Z and Z-double-prime, Ohlson O-score, Piotroski F-score, Sloan accruals, cash conversion (CFO/net income), days sales and inventory trends versus revenue, capitalisation flags, auditor changes, restatements, late filings, going-concern language. State each model's original sample, era and known limitations (for example: Altman Z is not for banks; Beneish was calibrated on a specific period). Never present a score without its interpretation band and its caveats.

### 13.3 Correlation and co-movement — with discipline

- Pairwise Pearson and Spearman on returns; report **n and a confidence interval** with every coefficient, always.
- Rolling 252-day correlation, plus a stability statistic. A correlation that flips sign across subperiods is not a relationship.
- Lead-lag cross-correlation up to plus or minus five periods, with Newey-West standard errors.
- Partial correlation controlling for market, sector, size, value and momentum.
- Cointegration (Engle-Granger, Johansen) only after unit-root testing (ADF and KPSS). Do not run cointegration on stationary series.
- **Spurious-correlation guard:** effective sample size, Benjamini-Hochberg false-discovery control across the whole tested set, subperiod sign consistency, and a label-shuffle placebo test.
- Separate contemporaneous co-movement from predictive signal. Only the second one is a signal, and only if it survives out of sample.

### 13.4 Importance — which data points actually matter

This is the core of the user-facing promise, so it gets the most rigour.

1. Define targets explicitly: forward 12-month total return, forward revenue growth, next-quarter earnings surprise, delisting or distress within 24 months. One pipeline per target.
2. Candidate features: all canonical metrics, derived ratios, growth rates, volatility, text metrics, ownership flows.
3. Preprocess: winsorise at 1/99, log skewed variables, industry-neutralise, keep missingness indicators.
4. Univariate: information coefficient (Spearman), t-stat with HAC errors, FDR-corrected q-values, and decile spread with its own standard error.
5. Multivariate: elastic-net with stability selection across bootstraps, plus gradient boosting with permutation importance and SHAP values.
6. Stability: split the sample into at least three eras; require sign consistency; require survival in a held-out final period.
7. **Kill criteria, applied automatically:** a feature that only works in one era, or that vanishes under industry neutralisation, or whose q-value exceeds 0.10, is not reported as important. It goes in a "rejected" appendix with the reason.

Output: a ranked table per target with feature, horizon, mean IC, IC information ratio, t, q, permutation importance, stability score, economic significance, sample size — and a plain-English sentence stating what it does and does not imply.

### 13.5 Event studies

Market-model abnormal returns over (-1,+1), (-5,+20) and (-20,+60) windows; CAR and BHAR; cross-sectional t-statistics clustered by event date; event typology (earnings 8-K, guidance change, insider cluster, activist 13D, auditor change, index inclusion). Always report the placebo distribution from randomly shifted dates as the null.

### 13.6 Ownership and insider flows

Form 4 transaction codes (P, S, A, M, F, G), insider cluster detection (three or more insiders within 30 days), net insider buying ratio, 13F concentration and herding, new 13D/13G positions, institutional ownership change. **State the 45-day 13F lag and the two-business-day Form 4 deadline in every report that uses them.** A flow measured late is not the same as a flow measured now.

### 13.7 Extrapolation and forecasting — the calibration contract

Distinguish sharply between two things and never mix them in one table:

- **Statistical forecast:** a model with intervals, validated walk-forward.
- **Scenario extrapolation:** assumptions stated by a human, arithmetic applied honestly.

For the statistical side:

- Baselines are mandatory: naive, seasonal naive, and a random-walk-with-drift for anything price-like.
- Models: ETS/ARIMA on quarterly series, a simple factor regression, and gradient boosting on the panel. Keep the model set small and justified.
- Validation: rolling-origin walk-forward only. Report MAE, MAPE or MASE, pinball loss, and **empirical coverage of the 80 and 95 percent intervals** — coverage is the headline, not the point estimate.
- A model that does not beat the naive baseline is reported as not beating it, in bold, at the top.
- Horizon limits: beyond eight quarters, output is a scenario with an explicit assumption ledger, never a forecast.
- Evaluation universes must include delisted names; a forecast accuracy measured only on survivors is fiction.

### 13.8 Causal language policy

Maintain a linting list. Words like causes, drives, leads to, because of, will, proves are blocked in generated prose unless the sentence carries a causal-design tag (difference-in-differences, event study with a clean control, instrument) that the system actually ran. Correlational results are written as "associated with" and carry the confounders that were and were not controlled.

### 13.9 Capital allocation and deal history

The brief asked for "the different trades each company has made", and that is a real, under-used signal: what management did with the cash, and whether it worked.

Build a capital-allocation ledger per company from filings and XBRL:

- **Share repurchases:** authorisation size, actual spend per period, average implied price, and shares retired versus shares issued for compensation.
- **Dividends:** initiation, growth streak, cut or suspension, and payout ratio against free cash flow.
- **Debt:** issuance, retirement, refinancing, maturity wall, and whether leverage rose specifically to fund buybacks.
- **Acquisitions and divestitures:** 8-K items 1.01 and 2.01, S-4 and DEFM14A where relevant, deal size against cash flow, and goodwill impairments that follow within three years.
- **Equity issuance and dilution:** S-1 and 424B filings, shelf takedowns, ATM programmes, and stock-based compensation as a percentage of revenue.

Then score it, carefully:

- **Buyback timing quality:** the average price paid in each buyback year against the stock's subsequent one, three and five-year return. A company that consistently buys high is telling you something — but report n, because a handful of years is not a track record.
- **Reinvestment quality:** incremental ROIC against WACC over rolling five-year windows.
- **Dilution-adjusted return of capital:** total shareholder yield net of stock-based compensation dilution.

State the limits every time: buybacks are reported as quarter-end aggregates, intra-quarter timing is unknown, and one company's history is far too short for a significance claim. This module produces descriptions and hypotheses, not verdicts, and its findings grade accordingly.

Report thirteen, **Capital Allocation**, presents this: what they bought, what they paid, and whether it worked.

---

## 14. The findings ledger

The ledger is the product's memory and its reputation.

Schema: id, created_at, title (a claim, not a topic), one-sentence claim, entities, sample period, method, data references (accessions and query hashes), effect size with CI, p-value, q-value, n, subperiod stability, confidence grade, falsifier, status (new / confirmed / retired), rerun command, reviewer note.

Grading:

- **A** — survives FDR correction, replicates out of sample, economically meaningful, robust to industry neutralisation and subperiod split.
- **B** — statistically significant but sensitive to one of the above; hypothesis-worthy.
- **C** — descriptive only; a lead, not a result.

Rules: every finding states **what evidence would overturn it**. Findings that later fail replication are moved to retired with a note — never deleted. The system must be able to show me a finding it produced and then killed. That is the strongest possible evidence of honesty.

---

## 15. Reports

### 15.1 Report types (minimum thirteen)

1. **Company Dossier** — business, segments, 10-year financials, margins, cash conversion, balance sheet, quality scores, ownership, recent filings, what changed.
2. **Peer and Comparables** — fingerprint neighbours, relative valuation context, where the company sits versus its cohort.
3. **Universe Screener** — ranked shortlist against a stated rule, with methodology and the number of names screened.
4. **Correlation and Co-movement Atlas** — clusters, notable pairs, instability warnings, the spurious-correlation appendix.
5. **What Matters** — feature importance per target, with the rejected list and the kill reasons.
6. **Red Flags and Accounting Quality** — scorecard, trend breaks, disclosure event flags, each with the underlying numbers.
7. **Event Study** — a specific event type across a defined sample, with the placebo null.
8. **Ownership and Insider Flows** — clusters, 13F changes, activist entries, with lag caveats.
9. **Forecast and Calibration** — the forecast, the intervals, the historical coverage achieved, and how it compares with naive.
10. **Data Quality and Coverage** — what is missing, what drifted, what was quarantined.
11. **Change Digest** — everything material that changed since the previous run, ranked, each item stating why it surfaced and linking to the filing. Daily by default, weekly by config.
12. **Watchlist Brief** — the same logic scoped to companies I have flagged, with per-name thresholds.
13. **Capital Allocation** — buybacks, dividends, debt, deals and dilution, scored on whether the capital produced a return, with the timing caveats stated.

### 15.2 Provenance rules

- All numbers in the rendered output come from template bindings to query results. **No figure is ever typed by hand or written by a language model.**
- Inline reference markers on every figure, resolving to an appendix entry: source, URL, accession, retrieval date, query hash.
- Each report emits report.md, report.html, provenance.json and a run manifest.

### 15.3 The numeric verification gate

A verifier that parses the rendered report, extracts every bound number, re-executes its query, and asserts equality within rounding. The build fails if any number is unbound, stale or mismatched. Provide a deliberate failing example in the tests to prove the gate works.

### 15.4 Language rules

Executive summary is at most five bullets, each with a citation. Mandatory sections: methodology box, limitations, provenance appendix, disclaimer. Banned phrasing enforced by lint: will, guaranteed, sure thing, proven, risk-free, to the moon, buy, sell, target price. Every ranked list states how many items were considered. Every percentage states its denominator.

### 15.5 Materiality, digests and alerting

A digest is only useful if it is short, so ranking is a first-class subsystem, not a sort expression.

Event classes with seed weights (all tunable in config/events.yaml): non-reliance or restatement (critical), going-concern language (critical), delisting notice (critical), auditor change (high), late-filing notice (high), 8-K item 1.01 material agreement (high), 8-K item 2.02 results (high), 8-K item 4.02 non-reliance (critical), officer departure or appointment under 5.02 (medium-high), insider cluster of three or more within 30 days (high), new 13D or activist stake (high), dividend initiation, cut or suspension (high), guidance withdrawal (high), covenant waiver (high), index inclusion or deletion (medium), split (medium), three-sigma volume or price gap (medium), large 13F position change (low), routine Form 4 (low, suppressed by default).

Scoring rules:

- Weight multiplied by extraction confidence, never rounded up.
- Routine events are suppressed unless they clear a statistical threshold against that company's own history.
- Every surfaced item carries a one-sentence **why this is here** and a link to the accession number.
- Thresholds live in config, are versioned with the data snapshot, and are shown in the digest footer so I can see what was filtered out and why.

Delivery, through a notifier interface with at least three implementations: local file (always written), rendered HTML digest, and optional SMTP email or Windows toast. **No external service, no telemetry, no account.**

- Dedupe key of (entity, event class, accession) with a cooldown, so an event never fires twice.
- A daily alert budget caps total items; anything beyond the cap is summarised as a count, never silently dropped.
- Digest runs are idempotent: running the watch twice on unchanged data produces an empty digest the second time.

### 15.6 Quiet by default

The system's resting state is silence. "Nothing material today" is a valid and valuable output, and the digest must be willing to say exactly that in one line. Padding a digest to look busy is a failure mode I care about more than missed minor events, because it trains me to ignore the system.

A weekly rollup exists for when I would rather have one message than seven.

### 15.7 Downloadable artifacts

Every digest and every report must exist as a file I can take away, not only as something on a screen. All formats are generated from the same data in the same run:

- **Markdown** — canonical, diffable, readable in any editor.
- **HTML** — a single self-contained file: no CDN, no external fonts, charts inlined as SVG, opens offline by double-click.
- **PDF** — optional via WeasyPrint; if the renderer is missing, skip cleanly with a warning rather than failing the run.
- **CSV** — one file per underlying table, so I can pivot the evidence myself.
- **XLSX** — optional, for numbers I want to handle in a spreadsheet.
- **JSON** — the machine-readable digest: every event, its score, its reason, its evidence pointers, and the list of what was suppressed.
- **ZIP bundle** — one download containing the report, its charts, its CSV tables, provenance.json and a manifest.

Naming is deterministic: YYYY-MM-DD_<kind>_<subject>.<ext>. Two runs over unchanged data produce the same filenames and identical content hashes.

provenance.json ships with every artifact and always lists the snapshot hash, the as_of timestamp, the generator version, the sources used with their refresh times, and anything that was degraded or missing.

---

## 16. Dashboard

Local-only, no authentication, opens fast, works offline once data is loaded.

Pages: **Change digest** with a timeline, per-item rationale and a visible record of what was suppressed; **Watchlist manager** with per-name rules and thresholds; Universe explorer with filters and sortable metrics; Company page (financials, filing timeline, ownership, text drift, peers, findings that mention it); Correlation atlas; Findings feed with grading and falsifiers; Data quality board; Report library; Run monitor with crawl logs and budgets.

Requirements: every page under two seconds on a laptop with the full universe loaded; every chart exportable as PNG and underlying data as CSV; every number on screen clickable through to its source; no client-side dependency on a CDN.

**The digest is a first-class page**, not a text blob: per-item rationale, filters by event class, entity and score, a suppressed tab showing exactly what the scorer filtered out and why, and a one-click export of whatever is on screen.

**Download controls everywhere.** Every digest and report carries a Download button producing the formats in 15.7, streamed from the report output directory with the correct content type and a filename the browser will save rather than render. A downloads index page lists every artifact ever generated with its date, kind, subject, size and content hash, so I can go back to last month's digest as a file.

**The data behind the numbers is browsable.** Any figure on screen links to a table view of the rows that produced it, with the accession numbers visible. The UI exists to show what the crawler found; it should never be the only place a number can be seen.

---

## 17. Quality gates and validation

### 17.1 Golden set

25 companies, hand-verified, covering: mega-cap tech; a money-centre bank; an insurer; a REIT; a utility; an energy major; a 52/53-week retailer; a pre-revenue biotech; a recent IPO under three years old; an acquired or delisted company; a foreign private issuer on 20-F; a dual-class company; a de-SPAC; a company that restated financials; a micro-cap.

For each: five years, three statements, ten line items, checked against the filing document itself, stored as CSV in tests/fixtures/golden with the accession and page reference. Tolerance: exact for counts, plus or minus 0.5 percent or one thousand dollars for money. 100 percent coverage required on the ten core metrics.

### 17.2 Reconciliation

For Assets, Revenues, NetIncomeLoss and NetCashProvidedByUsedInOperatingActivities, compare 100 randomly chosen company-quarters against the SEC frames API. Tolerance 0.1 percent. Report any systematic bias, not just pass/fail.

### 17.3 Tests

- Unit: tag chains, period alignment, restatement logic, adjustment maths, as-of views, rate limiter.
- Integration: adapters against recorded cassettes. **CI must not touch the network.**
- Property-based: quarterly sums reconcile to annual within 1 percent; adjusted prices have no unexplained jump above 50 percent; no fact has accepted_at in the future; no accession appears twice in filings.
- Regression: golden set, PIT leak test, delisting-presence test, restatement-versioning test, idempotency test (ingest twice, identical hashes).
- Watch behaviour: inject a synthetic filing into a fixture source and assert it appears in the digest exactly once, with the correct reason; run the watch twice on unchanged data and assert the second digest is empty; assert an event does not re-fire inside its cooldown; assert the stale-source warning appears when a source exceeds its refresh SLA; assert the desk's freshness header matches the warehouse state.
- Verifier: the numeric gate, including its failing case.

### 17.4 Bias register

A table in docs/BIAS_REGISTER.md with one row per bias: survivorship, look-ahead, restatement and backfill, selection on data availability, acceptance-time versus period-end, split and dividend adjustment, currency, ticker reuse, multiple testing, forecast overfitting, period cherry-picking, publication lag (13F, quarterly reporting), index reconstitution effects. Columns: why it bites here, the control implemented, the test that proves the control works, and residual risk.

**A control without a test is a wish.** Each row must name a test.

### 17.5 Data-quality monitors

Run nightly: coverage per metric and per company, null rates, schema drift, unit anomalies, value jumps above 10x, filing gaps above 400 days, tag-switch counts, restatement counts, orphan facts (accession with no filing), duplicate accessions, and stale companies (no filing in 18 months without a delisting record).

---

## 18. Performance targets

- Full backfill of 500 companies by 15 years, using bulk datasets where possible and APIs for gaps: under six hours on an eight-core laptop, resumable and interruptible.
- Daily incremental update: under ten minutes.
- Dossier report for one company: under five seconds.
- Dashboard page with the full universe loaded: under two seconds.
- Disk: document the footprint. Target under 25 GB for the full universe including raw filings.

If you cannot hit these, report the achieved numbers honestly rather than the target.

---

## 19. Legal, ethical and security posture

- Public data only; identify yourself; obey robots and rate limits; prefer bulk to scraping.
- Store the licence/ToS summary for every source in the registry and surface it in the docs.
- No redistribution of licensed data. Reports are for local research.
- No secrets in the repository; keys come from environment variables or a local .env that is git-ignored.
- **Email delivery is opt-in and credential-gated.** The digest can be mailed to william.cossey05@yahoo.com through SMTP, but the password comes from an environment variable and never from the repo. Yahoo requires an app password rather than the account password — document that setup step in RUNBOOK.md, including how to revoke it. If credentials are absent, the system logs "email not configured" and delivers to file and web instead. A missing password must never break a run.
- Email is a convenience, never the only copy. The file and the web page are the record; the email is a notification that points at them.
- The dashboard binds to localhost only.
- Every report carries: "Research output generated from public data. Not investment advice. Numbers are as of the stated retrieval date and may since have been restated."

---

## 20. Deliverables checklist

- README.md — what it is, one-command quickstart, what it can and cannot do, screenshots of the digest and a company page.
- BUILD-LOG.md — the phase-by-phase record of how this was built, with gate evidence.
- .github/workflows/ci.yml — offline tests on Ubuntu and Windows, no secrets required.
- docs/ARCHITECTURE.md — including the prior-art section and the as-of design.
- docs/DATA_DICTIONARY.md — every table, every column, every metric.
- docs/SOURCE_REGISTRY.md — every source, live probe result, limits, licence.
- docs/BIAS_REGISTER.md — biases, controls, tests, residual risk.
- docs/LIMITATIONS.md — everything the system cannot do today.
- docs/RUNBOOK.md — daily, weekly, monthly operations; how to recover from a broken source.
- Working CLI with subcommands for: init, migrate, backfill, update, verify, report, screen, find, dashboard.
- Thirteen report templates with sample outputs committed for three companies.
- The findings ledger populated with at least 25 graded findings.
- Test suite passing offline, with coverage reported.
- scripts/bootstrap.ps1 — one command to a working environment on Windows.

### 20.1 The repository

The deliverable is a git repository, not a folder of files.

- **Target: github.com/william05c/for-deepseek-to-change.** This repository is the deliverable and the lab notebook. Clone it into a sibling directory (deepseek-harness/for-deepseek-to-change) and build there.
- **Do not build inside default-workspace.** That directory is a clone of a different project (the NQ/EQ indicator) and its remote is not the one to push this to. Run git remote -v before the first commit; if origin is not for-deepseek-to-change, stop and fix the path.
- **Existing contents:** the repository is a scratch repo holding a stub README and a placeholder file. Clear the placeholders in one clearly labelled commit (chore: remove placeholder content) rather than silently, and never delete anything that looks like real work without asking me first.
- **The history is the documentation.** I chose this repository so the build is visible as it happens. Each phase therefore gets its own branch, a merge with --no-ff into main, and a tag at the merge (v0.1-phase0 through v0.8-phase8). Commit messages say what was built; the tag marks what the gate proved. A single squash-everything initial commit fails this requirement.
- **BUILD-LOG.md is mandatory.** One entry per phase: the date, the commits, the gate evidence (the actual test output), what was deferred and why, and what changed from the original spec. Reading the log alone must let a stranger reconstruct how this was built and where it went wrong.
- **Never force-push, never rewrite history, never touch another repository.** GitHub authentication is already configured on this machine through Git Credential Manager (account william05c), so HTTPS pushes work without a prompt; verify with a dry-run push before the first real one. If authentication ever fails, commit locally, write the remote into the README, and give me the exact commands. Do not claim a push succeeded without the command output that proves it.
- **This repository is public.** That is another reason nothing sensitive — no .env, no keys, no personal data beyond the contact address already in the SEC User-Agent — ever enters a commit.
- **Branches and commits:** main is always green. One logical change per commit, message explaining the why. Never commit a red test suite.
- **Never committed:** the warehouse (*.duckdb), raw documents, data/, .env, credentials, generated reports over a few hundred KB. Write .gitignore before the first commit, not after.
- **Always committed:** all source, config, tests, fixtures under 1 MB, docs, the three sample HTML reports, and the CI workflow.
- **Commit this specification as docs/SPEC.md**, verbatim. It is the contract. Any later change in scope shows up in the diff, which keeps me honest about what I asked for and you honest about what was built.
- **CI:** GitHub Actions on Ubuntu and Windows, running the offline suite with no network and no secrets. A workflow that needs an API key is not a CI workflow. The badge in the README must reflect a real run.
- **LICENSE:** MIT for the code, plus a "Data and licensing" README section naming the SEC, FRED and any index providers, and stating that the data is not redistributed.
- **README:** what it is, one-command quickstart, a screenshot of the digest and of a company page, honest limitations, and the disclaimer.

---

## 21. Execution protocol

Work in phases. At each gate, run the tests, show the evidence, and stop for my review before continuing. Do not proceed past a red gate "to save time".

**Phase 0 — Reconnaissance.** Probe every Tier 0 endpoint. Record status, latency, sample payloads, observed schemas. Write SOURCE_REGISTRY.md. List anything that contradicts this document. **Stop and report.**

**Phase 1 — Vertical slice.** Repository initialised with .gitignore, CI and a real commit history from the start. Then one company, end to end: filings → facts → canonical metrics → one dossier report → verification gate → tests. The numbers must reconcile to SEC XBRL. **Gate: exact reconciliation and a passing PIT test.**

**Phase 2 — Universe and backfill.** Bulk datasets, entity resolution, historical membership, delisted companies retained. **Gate: 500 companies loaded, delisting test passes, coverage report generated.**

**Phase 3 — Dictionary and features.** Full metric dictionary, derived features, industry neutralisation, restatement handling, DQ monitors. **Gate: golden set passes on 25 companies.**

**Phase 4 — Analytics.** Fingerprints and peers, quality scorecard, correlation atlas, importance pipeline, event studies, ownership flows. **Gate: peer precision@10 reported; importance kill criteria demonstrably rejecting features.**

**Phase 5 — Extrapolation.** Forecast models, walk-forward validation, coverage measurement, naive baselines. **Gate: a calibration table exists, including where the model loses.**

**Phase 6 — The watch.** Change-driven refresh, document diffing, materiality scoring, digest generation, notifiers, watchlist, quiet-by-default behaviour. **Gate: an injected filing appears exactly once with the right rationale, a quiet day yields a one-line digest, and re-running produces nothing.**

**Phase 7 — Expression.** All thirteen reports, the dashboard, provenance and verification wiring. **Gate: verifier fails on a deliberately tampered number.**

**Phase 8 — Hardening.** Docs, runbook, bootstrap script, performance measurement, final demo. **Gate: clean-machine setup works.**

---

## 22. Decisions I have already made — do not re-litigate

- Python, DuckDB, local-first, free public data, no required paid keys.
- A new top-level project folder; the existing forecaster repo is untouched.
- Windows-first, PowerShell-friendly.
- CIK as the entity key; tickers are time-varying attributes.
- Reports rendered from templates bound to queries; no hand-typed numbers.
- Bulk downloads preferred over per-filing crawling for volume.
- Statistical honesty over impressive-sounding output. A finding of "no significant edge" is a valid, valuable result and must be reported as such.
- **Both operating modes are first-class.** The watch and the desk share one warehouse and one analytics layer. Neither gets a shortcut, and neither may drift from the other.
- **Three delivery surfaces, one source of truth:** downloadable files, a local web UI, and optional email pointing at both. The email never carries the only copy.
- **SENTINEL is its own repository**, never a folder inside the indicator repo.

---

## 23. Questions you may ask me, batched, maximum five

Only ask if the answer changes what gets built. Examples of legitimate questions: whether reports should be English-only; how far back the default universe should go; whether to include non-US ADRs and 20-F filers in v1; whether a language-model narration layer is wanted at all; whether the dashboard needs to be reachable from another machine.

Everything else: make the call, write it in ARCHITECTURE.md as **your** decision, and move.

---

## 24. Final acceptance demo

These must work from a clean clone, in order, on Windows:

1. scripts/bootstrap.ps1 — creates the environment, installs dependencies, initialises the warehouse.
2. sentinel backfill --universe sp500 --years 15 — resumable, shows progress and budget consumption.
3. sentinel verify --reconcile — prints pass/fail against SEC frames with tolerances and any systematic bias.
4. sentinel report dossier --ticker AAPL — writes markdown, HTML and provenance.json; the verifier passes.
5. sentinel screen --rule quality_compounder --top 20 — a ranked table with methodology and names screened.
6. sentinel findings list --grade A — the ledger, with falsifiers visible.
7. sentinel forecast --ticker MSFT --horizon 4 --calibrate — a forecast with intervals and its own historical coverage.
8. sentinel watch run --since 1d — a digest that is silent when nothing material changed, and explains every item it does include.
9. sentinel dashboard — opens localhost, the digest page renders with per-item rationale and a suppressed tab, and the Download control produces the ZIP bundle.
10. git log --oneline --decorate and BUILD-LOG.md — one tagged commit set per phase, the log matching the history, and the CI badge green on a fresh clone.

Then show me one finding the system produced and then retired because it failed replication. That last item is not optional.

---

## 25. Tone of the code

Write for the person who inherits this in a year with no context. Docstrings explain why, not what. Every module has a CLI entry point with a real example in its help text. Config is explicit and validated at startup, not discovered by magic. Logs are structured and say what was attempted, what happened, and what was skipped. Comments explain non-obvious arithmetic — especially anything involving fiscal periods, restatements or adjustments, which is where silent errors live.

Be boring where correctness matters and clever only where it is cheap to be clever.
