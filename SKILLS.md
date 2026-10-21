# Agent Skills — what is installed, why, and how to use it

A working setup for the tools that make agent-written code better: skills for design, planning,
debugging, verification, web-research discipline, statistical honesty and trading-risk review,
plus the one skill written specifically for this repository.

**Status: installed and verified.** 25 skills are live in this session (24 user-level, 1
project-level) plus the 1 bundled harness skill. The catalog updated live on every install — no
restart was needed.

Three different things get called "skills" on GitHub, and they are not interchangeable:

| Want | Mechanism | Covered in |
|---|---|---|
| Better judgement — how to verify, plan, debug, size risk | **A skill** (`SKILL.md`) | §3 |
| A new *capability* — drive Premiere, click a desktop, query TradingView | **An MCP server** (a tool), optionally plus a skill that teaches its use | §4 |
| Reach the internet, read a file | **Already built in** — `web_search`, `web_fetch`, shell and file tools | §4 |

---

## 1. What a skill actually is

A skill is a directory containing a `SKILL.md` with YAML frontmatter and a Markdown body:

```
frontend-design/
├── SKILL.md          # frontmatter + instructions
├── LICENSE.txt
└── (optional) scripts/, references/, assets/
```

Loading is deliberately three-stage, so a big skill costs almost nothing until it is used:

1. **Discovery** — only `name` + `description` enter the context, as a one-line catalog entry.
2. **Invocation** — the full body loads when the description matches the task, or when you ask
   for it by name.
3. **Resources** — scripts and reference files are read only when a step says to read them.

Required frontmatter is `name` and `description`; the name should match the directory name.
Extra keys are preserved as metadata and do not break loading — which is why the
`license:`/`category:`/`metadata:`/`name_zh:` blocks in third-party skills work unchanged.

> This format is the portable part. The same `SKILL.md` runs under Claude Code and under this
> harness, which is why installation is a directory copy and not an adapter.

## 2. Where this harness looks (verified in the provider source)

| Root | Scope | Rank |
|---|---|---|
| `<project>/.dsh/skills` | this project, harness-specific | 100 (highest) |
| `<project>/.agents/skills` | this project, portable | 200 |
| `customSkillDirs` from config | whatever you point at | 300 |
| `~/.dsh/skills` | all projects, harness-specific | 400 |
| `~/.agents/skills` | all projects, portable | 500 |
| bundled with the harness | shipped | lowest |

Lower rank wins on a name collision. `.agents/skills` is the useful one: it is a cross-tool
convention, so a skill dropped there is visible to this harness *and* to Claude Code, Codex and
Cursor without being adapted. Only one level is scanned — one directory per skill, exactly one
`SKILL.md` deep.

## 3. Skills installed

### 3a. Code quality and process — `obra/superpowers` (MIT, 302k★)

| Skill | When it fires |
|---|---|
| `brainstorming` | before any creative work — interrogates what you actually want before building |
| `writing-plans` / `executing-plans` | turning a spec into a plan, then working it with checkpoints |
| `test-driven-development` | feature or bugfix, before implementation |
| `systematic-debugging` | any bug or test failure — root cause before any fix |
| `verification-before-completion` | before claiming "done" — fresh evidence, not memory |
| `requesting-code-review` / `receiving-code-review` | review handoff, both directions |
| `finishing-a-development-branch`, `using-git-worktrees` | landing work, isolating parallel work |
| `using-superpowers`, `subagent-driven-development`, `dispatching-parallel-agents`, `diagnosing-superpowers`, `writing-skills` | the framework tying the above together |

### 3b. Design and UI — `anthropics/skills` (Apache-2.0, 182k★)

`frontend-design` (aesthetic direction for `web/index.html`, avoiding templated defaults),
`skill-creator` (draft, eval and benchmark a skill), `webapp-testing` (Playwright — see §8).

### 3c. Web research and data verification — `SerhiiKorniienko/bullshit-detector` (158★)

The best-instrumented research skills found. Not a link list: a 40 KB `SKILL.md`, a 38 KB
`RUBRIC.md`, and a `RUN-RECORD.md` of measured runs (the skill itself contains an estimate that
15% of run time is spent deliberating before the first tool call, citing 35 instrumented runs).

| Skill | What it does |
|---|---|
| `bullshit-detector` | Decomposes a source into discrete claims, verifies each against independent sources, and scores credibility. Its core rule is the one that matters: **search for what would refute the claim, not for more of what you already have.** |
| `coverage-check` | Counts *origins*, not URLs. Queries GDELT, collapses reprints and wire copy, and flags syndication bursts. "Widely reported" becomes a number you can defend — or collapses to one press release. |
| `fetch-content` | Normalizes YouTube/TikTok/web/PDF/X content into clean text with metadata, neutralizing prompt-injection attempts inside the fetched text. |

Degrades gracefully: `bullshit-detector` uses the other two *if installed*, and falls back to the
built-in fetch tool otherwise.

### 3d. Quantitative risk and backtest rigour — `quantskills` (GPL-3.0) + `Viprasol-Tech`

| Skill | What it does |
|---|---|
| `skill-backtest-overfit` | Deflated Sharpe Ratio, PBO (CSCV), multiple-testing haircut, Minimum Track Record Length. Answers "how many things did I try before this worked?" |
| `backtesting-bias-avoidance` | A look-ahead-free engine end to end: quantifies look-ahead bias, Newey–West HAC t-stats and 95% CIs on every Sharpe, CSCV/PBO, DSR, linear-plus-impact cost model, walk-forward, full metric set. Offline synthetic by default, `yfinance` optional. |
| `risk-management-review` | Reviews a strategy or position: loss distribution, VaR/CVaR (ES), Sharpe/Sortino/Calmar/UPI, Kelly and vol-targeted sizing, concentration and leverage caps, stress tests — and outputs a verdict plus sizing recommendation. |

Most of the `quantskills` organisation (235 repos) is A-share specific and needs the `panda_data`
vendor SDK (`PANDA_DATA_USERNAME`/`PASSWORD`). These two are the vendor-neutral exceptions; a
third, `skill-risk-model` (Barra-style factor risk), advertises an offline fallback but is still
A-share-shaped and was left out.

### 3e. Project-specific, written for this repo

| Skill | What it encodes |
|---|---|
| `forecaster-acceptance` | The acceptance bar from `CONTRIBUTING.md` as an executable gate: capture `benchmark.js --json` **before** editing, the ±2% MAE bar, coverage must stay 78–84%, calm/wild ≥ 91/68, the three files that must move together, and the standing reject list. |

If you keep re-explaining a bar to the agent, it belongs in a skill.

## 4. Controlling the PC and your software — MCP, not skills

This is the one bucket where a skill is the wrong tool. A skill can only *tell* the agent how to
do something; it cannot add a way to do it. Software control needs an **MCP server**, and then a
skill may teach the agent to drive that server well.

**What already works here, with no skill and no MCP:** reading and writing any file, running
PowerShell, `web_search`/`web_fetch`, and launching processes. File access is not a gap — this
session already runs with full file access. The gap is *GUI* interaction: clicking, typing into
another application, driving an editor timeline.

### The servers worth knowing

| Want | Repo | Stars | Install |
|---|---|---|---|
| Premiere Pro | [leancoderkavy/premiere-pro-mcp](https://github.com/leancoderkavy/premiere-pro-mcp) | 418★, active | `npm install -g premiere-pro-mcp` |
| General desktop control (click/type/screenshot/OCR) | [mrpulor-gh/nuphus-mcp](https://github.com/mrpulor-gh/nuphus-mcp) | 327★ | see repo |
| Windows-specific computer use | [sandraschi/windows-computer-use-mcp](https://github.com/sandraschi/windows-computer-use-mcp) | 48★ | see repo |
| TradingView data and screeners | [atilaahmettaner/tradingview-mcp](https://github.com/atilaahmettaner/tradingview-mcp) | 5.1k★ | `pip install tradingview-mcp-server`, run via `uvx` |
| TradingView Desktop control | [pueschel88/Tradingview-MCP](https://github.com/pueschel88/Tradingview-MCP) | 133★ | drives the desktop app via CDP |
| Pine Script development | [cklose2000/pinescript-mcp-server](https://github.com/cklose2000/pinescript-mcp-server) | 105★ | install command not verified |

### Wiring one in

MCP servers are Cordis plugin instances. The file to edit is the profile patch layer:

`C:\Users\wp\.dsh\profiles\web\cordis.patch.yml`

That file is a YAML **array** of loader patch entries. `cordis.yml` next to it is generated and
says *"Edit cordis.patch.yml, not this file"* — respect that.

```yaml
- id: mcp-nuphus
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    transport: stdio          # or: streamable-http
    serverName: nuphus        # [A-Za-z0-9_-], max 32
    command: npx
    args: ["-y", "nuphus-mcp"]
    env: {}
    toolCallTimeoutMs: 60000
    failOnStartupError: false
```

Tools then appear to the agent as `mcp__nuphus__<toolName>`. The HTTP variant takes
`transport: streamable-http`, `url`, and `headers` instead of `command`/`args`.

Two honest caveats:

1. **`@deepseek-ai/dsh-mcp-client` is a harness dependency but it is *not* in the base bundle** —
   `dsh-base` ships only `dsh-mcp-resources`. So the entry above has to be added explicitly, and
   it has **not been tested here**: I did not edit the live profile or restart your GUI to prove
   it, because that would interrupt this session.
2. The loader applies the patch at boot, so a **host restart** is expected to be required.

Say the word and I will wire one up, restart, and confirm the tools register.

### One security note worth repeating

The `tradingview-mcp` README carries a warning that copies of that repository published under
other accounts ship a `package.json` that installs malware through npm
(`oracle-redis`, [MAL-2026-16390](https://osv.dev/vulnerability/MAL-2026-16390)). That is the
general risk with this bucket: an MCP server is an executable running with your full user
privileges, not a text file. Install from the canonical repo, pin the version, and read the
`package.json` before `npm install`.

## 5. Deliberately not installed

| Considered | Why not |
|---|---|
| `docx`, `pdf`, `pptx`, `xlsx` (anthropics) | Real value, but document-shaped work. Heavy; add on demand. |
| `web-artifacts-builder`, `canvas-design`, `theme-factory`, `brand-guidelines` | Overlap with `frontend-design`; a small catalog is a feature. |
| `bullshit-detector`'s `explain`, `summarize`, `share`, `report-card` | The suite's own optional extras. `report-card` needs `uv` (present) if you want rendered HTML output. |
| `wshobson/agents` (41k★), `VoltAgent/awesome-claude-code-subagents` (26k★) | Plugin marketplaces of *subagents*, not skills. |
| `davila7/claude-code-templates` (33k★) | A CLI for configuring Claude Code, not a skill library. |
| `ComposioHQ/awesome-claude-skills` (77k★), `travisvn/awesome-claude-skills` (15k★) | Link directories — installing the list installs nothing. No license on either. |
| `K-Dense-AI/scientific-agent-skills` (53k★, 177 skills) | Excellent for bio/chem; 177 descriptions is a large permanent context tax for near-zero relevance here. |
| ~230 A-share `quantskills` repos | Require the `panda_data` vendor SDK and credentials. |
| `mvanhorn/clawdbot-skill-parallel` (21★) | High-quality research routing, but needs a paid Parallel.ai API key. |
| `maxgfr/ultrasearch`, `hashbulla/deep-research` | 1★ each. Right shape, no adoption, not worth the trust. |
| ADR skills (`muthub-ai/c4-skills`, `Jvdbreemen/adr-skill`, `EvolveHQ/docflow`) | The right idea for decision-making, but 1–16★. `brainstorming` + `writing-plans` cover the same ground with a maintained backing. |

## 6. Use

Nothing is auto-run. A skill engages automatically when its description matches, by name when
you say so, or not at all if you override it.

```text
Model or Pine change      → forecaster-acceptance → verification-before-completion
A claim or number online  → bullshit-detector → coverage-check
"I want to add X"         → brainstorming → writing-plans → test-driven-development
A number looks too good   → systematic-debugging (leakage) → skill-backtest-overfit
Sizing / drawdown / VaR   → risk-management-review → backtesting-bias-avoidance
Dashboard or chart work   → frontend-design → webapp-testing
Writing your own skill    → skill-creator
```

## 7. Install, update, remove

**Caveat found here:** `git clone` from GitHub fails on this machine — git ignores the WinINET
proxy at `127.0.0.1:12334` and times out, while `Invoke-WebRequest` works. Use tarballs, or give
git the proxy explicitly:

```powershell
git -c http.proxy=http://127.0.0.1:12334 clone --depth 1 https://github.com/obra/superpowers.git
```

Tarball route (what was actually used):

```powershell
$src = "$env:TEMP\skills-src"; New-Item -ItemType Directory -Force $src | Out-Null
Invoke-WebRequest "https://codeload.github.com/obra/superpowers/tar.gz/refs/heads/main" `
  -OutFile "$env:TEMP\sp.tgz" -UseBasicParsing
New-Item -ItemType Directory -Force "$src\superpowers" | Out-Null
tar -xzf "$env:TEMP\sp.tgz" -C "$src\superpowers" --strip-components=1
Copy-Item "$src\superpowers\skills\*" "$env:USERPROFILE\.agents\skills\" -Recurse -Force
```

Multi-skill repos nest their skills (`skills/<category>/<name>/SKILL.md`) — copy the leaf
directory, not the category. Some repos name the file `skill.md`; rename it to `SKILL.md`. Non-ASCII
filenames in a tarball can extract mangled on Windows (three Chinese sample reports from
`backtesting-bias-avoidance` did); rename them to ASCII, or ignore them if unlinked.

Update = re-download and replace the directory. Remove = delete the directory; the catalog
updates within a second. To scope a skill to one project, put it in `<project>/.agents/skills/`.

Share one copy with Claude Code (junction, no admin needed, verified working):

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills" `
  -Target "$env:USERPROFILE\.agents\skills"
```

For a non-standard location, add it to the harness config as `customSkillDirs` (array of
absolute paths).

## 8. Dependencies and gaps

| Need | State |
|---|---|
| Python for skill scripts | Only the `py` launcher works (3.11/3.14/3.15); `python` on PATH is the Microsoft Store stub. Use `py -m pip ...`. |
| `uv` / `uvx` | Present (0.12.1) — needed by `coverage-check`, `fetch-content` and the tradingview MCP route. |
| `skill-backtest-overfit`, `backtesting-bias-avoidance` | `py -m pip install numpy pandas scipy matplotlib` (the overfit skill pins `numpy<2.0`; bias-avoidance does not). |
| `webapp-testing` | Playwright browsers are cached (`chromium-1228`) but no Playwright package is installed: `py -m pip install playwright`. |
| Claude Code CLI | Not installed. The `~/.claude/skills` junction is ready, and skills are model-agnostic — this harness is using them now. |

Until installed, those skills still work as **method**: the instructions and reference documents
are usable, only the helper scripts are not.

## 9. Cautions worth stating plainly

- **A skill is instructions executed with your privileges** — it can tell the agent to run
  commands, read files, or trust a source. **An MCP server is worse: it is a program.** That is
  why each skill here was read before copying and why provenance is recorded in
  `~/.agents/ATTRIBUTION.md`. Do not bulk-install a marketplace.
- **Every catalog line is a permanent context tax.** 25 is comfortable; 100 is not.
- **Licences differ.** Superpowers MIT, Anthropic's Apache-2.0, `quantskills` GPL-3.0. Vendoring
  GPL-3.0 into an MIT repo would relicense it — hence user level, not the repo.
- **Skills drift.** They are files; upstream changes do not reach you. Pin a commit if a skill
  becomes load-bearing.

## 10. What was verified, not assumed

- Repo identities, star counts and licences from the GitHub API — which caught two repos that do
  not exist: `mhattingpete/claude-code-plugins` and `zircote/claude-marketplace`.
- Skill inventories from each repo's git tree.
- Actual `SKILL.md` bodies read before copying, for every skill installed.
- Licenses checked per source, which corrected a guess: `bullshit-detector` and
  `risk-management-review` are both MIT (not unlicensed, as the skill directories alone suggested),
  and `backtesting-bias-avoidance` reports `NOASSERTION` on the API but ships a GPL-3.0 `LICENSE`.
- `backtesting-bias-avoidance` confirmed functional after install: `references/backtest-guide.md`,
  `references/sample_report_backtest.md` and `scripts/run_backtest.py` all present.
- All 25 installed directories: `SKILL.md` present, `name` matches directory.
- The harness catalog refreshed **live, three times**, with no restart.
- Project gates run: `pine_lint.js` → 4 files ok; `pine_rehearsal.js` → 79.9% / 79.1% / 82.0%
  high coverage, matching the reference.
- Junction `~/.claude/skills` → `~/.agents/skills` resolves to all 24 user-level skills.
- MCP config schema read from `@deepseek-ai/dsh-mcp-client` source; `dsh-base` confirmed to ship
  `mcp-resources` only. **The MCP entry itself is untested — no profile edit, no restart.**

## 11. Suggested next steps

1. **Install the Python dependencies** (`playwright`, then `numpy pandas scipy matplotlib`) to
   turn two "method" skills into working tools.
2. **Run `skill-backtest-overfit` against the published scorecard.** The honest test is whether
   the result survives a multiple-testing haircut given how many specifications
   `docs/08-extending.md` records as tried.
3. **Wire one MCP server** — `nuphus-mcp` for desktop control is the cheapest way to see whether
   the MCP path works at all; Premiere Pro if video work is the actual goal.
4. **Write a second project skill** (`pine-port-parity`): constants, the daily-vs-intraday bar
   trap, the ~2% rehearsal tolerance. It is the other knowledge re-derived every session.
