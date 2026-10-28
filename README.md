<div align="center">
  <h1>HarnessPro</h1>
  <p><strong>Shared tool budgets for OpenCode 2, Codex, and Pi—with an Orca control panel.</strong></p>

  <p>
    <a href="https://github.com/wzasd/HarnessPro/tree/v0.2.2"><img alt="Release" src="https://img.shields.io/badge/release-v0.2.2-blue" /></a>
    <a href="https://github.com/wzasd/HarnessPro/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green" /></a>
    <img alt="Orca" src="https://img.shields.io/badge/Orca-%3E%3D1.4.0-6f42c1" />
  </p>

  <p><a href="README.md">English</a> · <a href="docs/i18n/zh-CN.md">简体中文</a> · <a href="docs/i18n/ja.md">日本語</a></p>
</div>

## Three agents walk into a repository

One reads the same file twelve times. One downloads a novel-length build log. One keeps calling tools after the tests pass.

HarnessPro gives all three the same budget, a gentle nudge to wrap up, and a firm stop when the tool meter runs out. It also gives you an Orca panel to run checks without babysitting a terminal.

This is a third-party engineering project inspired by the HarnessPro paper. It is **not** the authors' official implementation, and it does not claim their benchmark results.

## What is in the toolbox?

| Component | What it does today | What it does not do yet |
| --- | --- | --- |
| Orca plugin | Start, inspect, and stop checks; show completion notifications | No stable-panel guarantee while the plugin API is experimental |
| Shared policy | Lite, Medium, and Heavy tool budgets | Keyword-based auto routing with manual override |
| OpenCode 2 adapter | Phase reminders, hard limits, repeated-log folding | Model mappings live in `policy.json` |
| Codex adapter | Phase reminders, hard limits, parallel-call accounting | No log folding; Codex hooks cannot rewrite tool output |
| Pi adapter | Phase reminders, hard limits, log folding, in-session profile switching | Model mappings live in `policy.json` |

The short version: **less wandering, more finishing.**

## The 30-second quick start

### Requirements

- Linux
- Node.js 22+
- Python 3.12+
- Orca 1.4.0+
- OpenCode 2, Codex, or Pi, as needed

### Install

1. Clone and install the test dependencies:

   ```bash
   git clone git@github.com:wzasd/HarnessPro.git
   cd HarnessPro
   npm install
   ```

2. Link the plugin and adapters:

   ```bash
   npm run install:local
   ```

3. Open **Settings → Plugins** in Orca.
4. Choose **Install from local path** and select this project directory.
5. Review the requested capabilities and enable HarnessPro.

The installer backs up existing files before creating symlinks. Backup suffixes are `.backup-before-project` and `.backup-before-harnesspro-project`.

## Pick a budget, not a mystery

Start your agent with a profile:

```bash
harnesspro lite opencode2 --standalone
harnesspro medium codex
harnesspro heavy pi
```

| Profile | Economy | Convergence | Hard limit | Good starting point |
| --- | ---: | ---: | ---: | --- |
| Lite | 8 | 14 | 22 | Small, well-scoped tasks |
| Medium | 14 | 26 | 44 | Everyday coding work |
| Heavy | 20 | 36 | 60 | Harder investigations |

These are local starting values, not recommendations from the paper. Tune them against pass rate and cost on your own tasks.

Pi users can also switch during a session:

```text
/harnesspro lite
/harnesspro medium
/harnesspro heavy
/harnesspro off
```

No profile means no budget enforcement.

### Automatic model routing

Let the router classify the task and select both the model and the budget:

```bash
harnesspro auto --task "Fix a typo in the README" pi
harnesspro auto --task "Add parser tests" codex
harnesspro auto --task "Debug a production race condition" opencode2 --standalone
```

The current router uses deterministic keywords. Empty task descriptions default to Medium. It is a simple fallback, not a measured classifier; review routes on real tasks before relying on them.

## Run checks from Orca

Use `Ctrl + Alt + R`, or type:

```bash
harnesspro checks start
harnesspro checks status
harnesspro checks stop
```

Checks run in a separate process. Closing the panel does not stop them.

```text
~/.local/state/harnesspro/checks.json
~/.local/state/harnesspro/checks.log
```

## Multi-agent evolution

Start a real Orca-coordinated evolution run:

```bash
harnesspro evolve start
harnesspro evolve status
harnesspro evolve stop
```

The coordinator uses four Orca workers: test synthesizer, trajectory analyzer, evolution planner, and harness editor. Candidates then run real Codex evaluations against fixed tests. The report includes pass rate, latency, and token cost, with no invented dollar estimate.

No terminal is required. Use `Ctrl + Alt + E` to start, `Ctrl + Alt + S` to inspect status, and `Ctrl + Alt + X` to stop. The panel shows these shortcuts and links the apply command.

When the status becomes `awaiting-approval`, review the report and apply a profile explicitly:

```bash
harnesspro evolve apply medium
```

Nothing replaces the shared policy until you run `apply`.

## How the pieces fit

```mermaid
flowchart LR
  A[Orca panel] --> B[Independent check process]
  B --> C[checks.json]
  B --> D[checks.log]

  E[policy.json] --> F[OpenCode 2]
  E --> G[Codex]
  E --> H[Pi]

  F --> I[Reminders and limits]
  G --> I
  H --> I
  F --> J[Repeated-log folding]
  H --> J
```

Plugin code, policy, and job records live separately. Updating the plugin does not delete your policy or logs.

## Paper trail

The project name and budget-profile idea come from this paper:

**HarnessPro: Recursive Harness Self-Improvement with Pareto Optimization for Performance-Cost Trade-offs**

- **Authors:** Zhuoshi Pan, ZhiYuan Feng, Yukuo Cen, Honglin Lin, Junru Lu, Zhongxia Chen, Shuo Yang, H. Vicky Zhao, Jie Tang
- **Paper:** [arXiv:2610.26770v2](https://arxiv.org/abs/2610.26770v2), published 2026-10-20
- **DOI:** [10.48550/arXiv.2610.26770](https://doi.org/10.48550/arXiv.2610.26770)
- **Status:** Under review
- **Official code:** [pzs19/HarnessPro](https://github.com/pzs19/HarnessPro)

| Source | What it contains |
| --- | --- |
| Paper | Label-free test synthesis, multi-agent harness evolution, performance–cost Pareto selection |
| Official repository | Nine harness artifacts and evaluation code for three benchmarks |
| This repository | An Orca plugin, shared budgets, agent adapters, and a check coordinator |

The paper uses Lite, Medium, and Heavy for performance–cost operating points. This repository currently uses the same names for tool-budget profiles only. It does not reproduce the paper's Pareto frontier or experimental results.

## Marketplace installation

1. Open **Settings → Plugins → Marketplace sources** in Orca.
2. Add:

   ```text
   https://github.com/wzasd/HarnessPro.git
   ```

3. Set the ref to `main`.
4. Install `harnesspro.orca` and review its capabilities.
5. Enable the plugin.

The marketplace index currently points to `v0.2.2`.

## Updates

For a local symlink installation:

```bash
git pull
npm install
npm test
```

No second install is needed; the links still point to the project.

Marketplace installations require an update confirmation in Orca. Policy and job records stay outside versioned plugin directories.

## Development

### Project map

```text
orca-plugin.json       Orca manifest
orca-marketplace.json  Marketplace index
main.mjs               Orca worker
panel.html             Orca panel
coordinator.mjs        Independent check process
router.mjs             Task classification and model routing
evolution.mjs          Multi-agent evolution coordinator
evolution-core.mjs     Candidate scoring and test isolation
core.mjs               Shared OpenCode 2 and Pi logic
policy.json            Shared budgets
adapters/              OpenCode 2, Codex, and Pi adapters
scripts/               Local installation and registration
```

### Test

```bash
npm test
```

The suite covers policy loading, parallel accounting, log folding, process lifecycle, Orca worker behavior, Codex hook input/output, and legacy hook-path migration.

### Release a new version

1. Update `package.json` and `orca-plugin.json`.
2. Update the ref in `orca-marketplace.json`.
3. Run `npm test`.
4. Commit and create a matching Git tag.
5. Push the commit and tag.

## Current limits

- The router uses keywords, not a benchmarked task classifier.
- Automatic policy replacement still requires explicit approval.
- The included evolution tasks are a small smoke suite, not the paper's benchmarks.
- The repository does not reproduce the paper's full training procedure or reported results.

## Translations

- [English](README.md) — canonical version
- [简体中文](docs/i18n/zh-CN.md)
- [日本語](docs/i18n/ja.md)

English is the maintenance source of truth. Update translations in the same pull request when behavior or setup changes.

## License

[MIT](LICENSE)
