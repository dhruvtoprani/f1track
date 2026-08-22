# Running Context

Persistent working memory for continuing the build after context compression or a new work session.

## Current state

- Phase: complete
- Status: Explainable strategy release is verified and published to the public GitHub/Vercel targets
- Workspace: `/Users/dhruvtoprani/Documents/ChatGPT/f1track`
- Authoritative specification: `/Users/dhruvtoprani/Downloads/F1TrackSimulation_Toprani.pdf`
- Current artifact: `APEX-ML-f0c117aca4`
- Public repository: `https://github.com/dhruvtoprani/f1track` with default branch `main`
- Live product: `https://apex-race-lab.vercel.app`

## Operating instructions

- Make pragmatic best-guess decisions when requirements are ambiguous.
- Keep `PROJECT_DECISIONS.md`, `DEV_LOG.md`, and this file current.
- Prefer aggregate forecast truth over a visually persuasive single stochastic outcome.
- Retain model changes only with leakage-safe validation and verify implementation proportionally to risk.

## Current product contract

- User draws or loads a circuit and edits scale, direction, start/finish, and pit markers.
- Geometry engine reports corners, straights, passing zones, pace, physical demands, track similarity, and OOD confidence.
- Learned OpenF1 models plus 2026 driver/team priors generate a qualifying grid and Monte Carlo profiles.
- Default action runs 10,000 independent race outcomes; no featured Grand Prix winner is presented.
- Running screen is explicitly an accelerated batch visualizer. It streams completed samples, throughput, partial win percentages, and ghost cars.
- The running screen remains visible for at least 2.8 seconds even when compute finishes sooner. A finished job is truthfully labeled “Simulation complete” / “Preparing forecast” during the remaining display window; measured compute duration is not inflated.
- Result screen declares the most frequent winner across all samples, raw modeled-win count, 95% Wilson interval, podium/points/DNF probabilities, average finish, strategies, model provenance, and CSV export.
- The Winner Model Read explains the leader through starting control, track-conditioned package rank, and execution/finish strength, explicitly framed as modeled evidence rather than causal proof.
- The Strategy Lab lets a user choose a team and apply a balanced, early-undercut, tyre-preservation, or maximum-attack plan. Non-balanced plans run against a same-grid, same-seed, same-random-world baseline and report the isolated team win-probability delta.
- Share uses the native platform sheet when available and falls back to a clipboard receipt containing the leader, probability, win count, explanation signals, any strategy impact, and product URL.
- “Resample 10,000” holds circuit, weather, learned model, and qualifying grid fixed. It changes only the Monte Carlo seed and race-world randomness, retains the prior result, and reports percentage-point deltas plus the expected two-sample movement band.
- Result hierarchy now leads with a probability dial, top-five comparison bars, precision/lead/compute cards, and an explicit fixed-vs-resampled explanation before the full 22-driver table.

## Architecture

- Vite + React + TypeScript, browser-local persistence and inference.
- `src/engine/simulator.ts`: qualifying, detailed legacy race engine, optimized batched Monte Carlo. Invariant lookups/inference are precomputed; 40 cooperative progress batches stream `MonteCarloProgress` snapshots.
- `src/components/RaceControl.tsx`: live forecast runner and completed probability dashboard.
- `src/styles.css`: Track Intelligence uses a responsive four-metric card region with matched geometry-confidence treatment at desktop/tablet widths and a two-column mobile fallback.
- `ml/`: cached OpenF1 2023-2026 ingestion, leakage-aware features, NumPy T-REK/logistic/softmax training, recency-aware shrinkage priors, artifact/model-card generation.
- T-REK maps standardized context to raw plus deterministic random Fourier features, minimizes time-weighted Huber loss with L2 control, and exports the complete projection and coefficient state for identical TypeScript inference.
- Kernel dimension/scale, Huber threshold, session half-life, regularization, and softmax class weighting are selected on inner chronological validation; newest sessions remain untouched test data.
- Race performance is a competing-risk decomposition: the pace model learns classified finishes while the independent incident model owns DNF probability, avoiding double-counting reliability.
- Strategy comparisons use common random numbers: baseline and intervention consume the same stochastic sequence, with only the selected team's strategy transform changed.

## Data and measured performance

- 81 races, 24 circuits, 1,639 race/qualifying rows, 78,291 tyre laps, 13,935 pit states, 1,636 starts, and 3,009 compound transitions.
- Classified-finish pace holdout: MAE 0.1258, R² 0.5328, track-holdout MAE 0.1252; 6.3% lower MAE than the same-scope ridge baseline.
- Qualifying holdout: MAE 0.1375, R² 0.6534, track-holdout MAE 0.1620; prior production MAE was 0.1652.
- Tyre holdout: MAE 0.6016 s, R² 0.1943; prior production MAE was 0.6343 s.
- Pit log loss 0.4838; starting/next compound accuracy 0.6510/0.5297; incident log loss 0.4367.
- Overtake holdout: MAE 0.7611, R² 0.0338; still shrunk toward its intercept at runtime.
- Browser benchmark: default 10,000-run dry forecasts completed in 374–421 ms at about 23,700–26,700 races/second on the QA machine; leader sampling half-width was about 0.9 percentage points.

## Verification baseline

- 9 TypeScript tests and 2 Python tests pass.
- `pnpm test:ml`, `pnpm lint`, `pnpm test -- --run`, and `pnpm build` pass.
- Browser QA verified the live 4,250/10,000 intermediate state, final 10,000 outcome table, all 22 drivers, strategy/model tabs, zero horizontal overflow at 1280×720, and no warning/error console entries.
- Resample QA verified identical top qualifying markers (`VER`, `NOR`, `RUS`) across two samples; the leader moved from 38.1% to 39.4%, and the UI correctly reported +1.35 percentage points against an approximately ±1.35 pp two-sample 95% movement band.
- Current UI QA at 1280×720 measured four equal 166×94 Track Intelligence cards and a matched 230×94 confidence card with zero document overflow. A fast completed forecast remained in the explicit completed/preparing state at 900 ms and revealed results after 2.880 seconds; console warning/error count remained zero.
- T-REK verification: schema v2 model dimensions and all coefficients are finite; Python artifact tests, TypeScript inference/simulator tests, strict typecheck, and production build pass. The attempted fresh browser regression was not completed because Browser Use blocked localhost navigation after the preview was restarted; prior UI QA remains the visual baseline.
- Matched SOTA benchmark: nested-chronologically tuned XGBoost scored 0.1337 pace, 0.1483 qualifying, and 0.6306 s tyre MAE versus T-REK's 0.1258, 0.1375, and 0.6016 s—T-REK advantages of 5.9%, 7.3%, and 4.6%. This is a task-specific result, not a universal SOTA claim.
- Public release: `https://github.com/dhruvtoprani/f1track` is public with `main` as its default branch, and `https://apex-race-lab.vercel.app` is the branded Vercel production alias. The main README is written for a common audience, deeper math/benchmark documents remain optional, and dependency/build/cache/raw processed data stay ignored while the trained artifact and reproducibility code are included.
- Explainable-strategy release QA: dynamic labels remain consistent at 250, 1,000, 5,000, and 10,000 outcomes; maximum attack produced a paired, plausible McLaren shift from 30.8% to 34.7% (+3.96 pp) in the inspected sample; balanced mode made no comparison claim. Semantic snapshots verified skip navigation, labeled progress, complete tab semantics with arrow-key navigation, and a captioned forecast table. Axe found zero WCAG 2/2.1 A/AA violations. Browser checks found no horizontal page overflow or interactive targets below 44 px at 375×812, 812×375, or desktop widths; reduced-motion behavior and a zero-warning/error console also passed.

## Open work

- None for the current release.
- Optional: persistent circuit/scenario links; custom strategy parameters; community/remix loops; Web Worker/server workers above 100,000 runs; rolling-season calibration/backtests; forecast-level probability reliability diagrams; proprietary telemetry or a sequence model that clears the same T-REK gates; hosted persistence/accounts.

## Runbook

- Install: `pnpm install`
- Develop: `pnpm dev` (currently verified at `http://127.0.0.1:5174/`)
- Test: `pnpm test -- --run`
- ML test: `pnpm test:ml`
- Retrain from cache/data: `pnpm train:ml`
- Typecheck: `pnpm lint`
- Production build: `pnpm build`
