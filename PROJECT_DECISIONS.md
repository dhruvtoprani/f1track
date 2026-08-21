# Project Decisions

This file records meaningful prioritization, assumptions, and tradeoffs made while building the project.

## 2026-08-21 — Benchmark the SOTA claim and lead with a public-audience explanation

- Context: The repository needed a clean public-facing explanation of why T-REK is preferable to state-of-the-art alternatives, but no universal superiority claim is defensible without task-matched evidence. The user explicitly chose a public repository and asked that the main explanation remain accessible to a common audience.
- Decision: Add a reproducible nested-chronological XGBoost benchmark and frame superiority narrowly: T-REK beats a tuned strong tabular baseline on this dataset and these holdouts, while broader tree/sequence SOTA can win with other data. Keep the README focused on the product, plain-English math, architecture, and headline evidence; link deeper derivations as optional appendices. Publish `dhruvtoprani/f1track` publicly.
- Rationale: T-REK achieved 5.9%, 7.3%, and 4.6% lower holdout MAE than tuned XGBoost for classified-finish pace, qualifying, and tyre residuals. The simplified narrative makes those results understandable without weakening the reproducibility record.
- Tradeoffs: The optional benchmark adds XGBoost and scikit-learn dependencies outside the lightweight production training path. A finite 18-configuration search is a strong matched baseline, not an exhaustive claim over every architecture or compute budget.
- Revisit when: New data arrive or a larger benchmark budget/sequence baseline can be evaluated under the identical split and metric protocol.

## 2026-08-21 — Replace central ridge baselines with the T-REK competing-risk kernel

- Context: Linear ridge models could not express nonlinear driver–team–circuit interactions, treated abnormal race outcomes as ordinary pace, and gave all historical sessions equal influence. The starting-compound classifier also over-corrected class imbalance and sacrificed chronological-holdout accuracy.
- Decision: Ship the project-specific APEX Temporal Robust Equilibrium Kernel (T-REK). Map standardized context through deterministic random Fourier features, fit with time-decayed Huber loss plus L2 regularization, and select spectral dimension, kernel scale, robustness, recency, and regularization only on an inner chronological split. Decompose classified-finisher pace from the independent DNF hazard. Select softmax class-weight strength and regularization by chronological validation log loss.
- Rationale: On untouched later-race holdouts, qualifying MAE improved from 0.1652 to 0.1375, tyre MAE from 0.6343 s to 0.6016 s, starting-compound accuracy from 48.5% to 65.1%, and next-compound accuracy from 49.5% to 53.0%. The classified-finisher pace kernel achieves 0.1258 MAE and beats its same-scope ridge baseline by 6.3%. Exact projections and coefficients remain portable to TypeScript.
- Tradeoffs: The artifact grows by roughly 50 KB uncompressed and its central pace metric is now explicitly conditional on a classified finish, so it must not be directly compared to the old all-outcome finish MAE. T-REK is a unique synthesis for this product, not a claim that random features, Huber loss, decay, or competing risks are newly invented. Fictional circuits and hidden setup/fuel/tyre-state variables remain irreducible uncertainty.
- Revisit when: Rolling multi-season calibration, proprietary telemetry, or enough sequence data can beat T-REK on the same nested chronological and circuit-transfer gates.

## 2026-08-21 — Treat resampling as the same question, not a new qualifying scenario

- Context: The old “New seed” action regenerated both qualifying and the 10,000 race outcomes. That silently changed the starting grid as well as Monte Carlo noise, so the displayed win percentage could move for two different reasons.
- Decision: Rename the action to “Resample 10,000,” keep circuit, weather, model weights, and the original qualifying grid fixed, and randomize race-world events only. Preserve the immediately prior forecast so the UI can show per-driver percentage-point movement.
- Rationale: A resample should estimate the same underlying probability again. For two independent 10,000-run samples, the dashboard now derives and displays the approximate 95% movement band as `sqrt(2)` times the single-sample Wilson half-width.
- Tradeoffs: Numbers still change slightly because Monte Carlo estimates are samples, not exact analytical probabilities. A fixed initial seed remains reproducible; explicit resampling intentionally generates a new sample ID.
- Revisit when: Sequential confidence stopping or an exact/variance-reduced estimator can replace independent fixed-size samples.

## 2026-08-21 — Shift result design from dense metrics to probability hierarchy

- Context: The first forecast dashboard was correct but the leader, field shape, uncertainty, and resampling semantics competed for attention.
- Decision: Introduce a probability dial, ranked top-five comparison bars, compact precision/lead/compute cards, an always-visible fixed-vs-resampled explainer, prior-sample deltas, and a clearer resample action while retaining the complete 22-driver table.
- Rationale: The redesigned hierarchy answers “who leads, by how much, how certain is it, and why did it move?” before exposing full model detail.
- Tradeoffs: The full table remains horizontally scrollable on narrow screens because preserving all statistical columns is more useful than hiding them.
- Revisit when: User testing indicates a need for a simplified mobile summary or alternate light theme.

## 2026-08-21 — Make the 10,000-run distribution the only forecast truth

- Context: A featured replay could name a different winner from the Monte Carlo leader because it was one stochastic sample. Presenting both as predictions was mathematically valid but product-level misleading.
- Decision: Remove the featured-race result and Grand Prix winner from the primary product flow. Qualifying establishes the starting conditions; one batched 10,000-run Monte Carlo job now produces the live view, headline, table, strategies, CSV, and model explanation.
- Rationale: “Who wins what percentage of the time?” is an aggregate question. One aggregate source prevents contradictory winner labels and lets the UI explain counts, probabilities, and 95% Wilson sampling intervals directly.
- Tradeoffs: The detailed lap replay engine remains tested code but is no longer presented as forecast evidence. The running animation is explicitly labeled an accelerated batch visualizer, not one real race.
- Revisit when: A replay is reintroduced as an optional, clearly labeled sample drawn from the aggregate distribution.

## 2026-08-21 — Keep 10,000 forecasts interactive in-browser

- Context: Ten thousand runs are statistically more stable but repeated driver/team lookups and model inference inside every race would waste UI time.
- Decision: Precompute invariant driver profiles and learned predictions once, sample only race variance in the hot loop, yield 40 progress batches, and stream partial leaderboards plus throughput to the UI.
- Rationale: Verified default jobs complete in roughly 0.4 seconds on this machine at about 24,000–27,000 races/second while remaining visibly progressive.
- Tradeoffs: Browser execution is still single-threaded; very large future jobs should move to a Web Worker or server worker pool.
- Revisit when: Forecast fields exceed 100,000 runs or simulations add full per-lap physics to every sample.

## 2026-08-21 — Ship only leakage-safe model improvements that clear holdout

- Context: More features do not automatically improve future-race accuracy.
- Decision: Add prior-form interactions to qualifying and nonlinear age/progress/weather terms to tyre degradation. Select ridge regularization on an inner chronological split, then report performance once on the untouched newest-race holdout.
- Rationale: The change improved qualifying MAE from 0.1670 to 0.1652, tyre residual MAE from 0.6638 s to 0.6343 s, and overtake-rate holdout R² from -0.3468 to +0.0338.
- Tradeoffs: Race-finish MAE improved only marginally and pit/incident models did not change, so runtime continues to blend weak components with structured priors.
- Revisit when: More seasons, telemetry features, or a rolling backtest can support validated nonlinear ensembles.

## 2026-08-20 — Replace the placeholder calibration boundary with reproducible real-data training

- Context: The completed product initially used transparent handcrafted calibration because the supplied repository had no data or weights. The user clarified that machine-learning training and real-data operation are part of the expected delivery.
- Decision: Add a one-command OpenF1 2023-2026 pipeline and ship its learned artifact. Train auditable ridge, prevalence-aware/class-balanced logistic, and softmax models for race performance, qualifying, tyre residuals, pit decisions, starting and next compounds, incidents, and overtaking environment; derive shrinkage-stabilized driver/team priors; execute all coefficients locally in TypeScript.
- Rationale: OpenF1 provides freely accessible timing, lap, stint, pit, weather, overtake, driver, and result history from 2023 onward. Compact models make the full data-to-inference chain reproducible without cloud credentials and expose measured chronological holdout performance.
- Tradeoffs: Linear baselines are less expressive than the specification's eventual TCN/attention research target, but are trainable, testable, interpretable, and genuinely used at runtime. Fictional-track geometry still requires explicit extrapolation because it has no historical labels. Missing endpoint observations remain missing rather than being fabricated.
- Revisit when: A larger licensed warehouse, proprietary setup/fuel data, continuous retraining infrastructure, or enough circuit sequences to justify a validated nonlinear model becomes available.

## 2026-08-20 — Deliver a complete local simulator before production ML infrastructure (superseded for model calibration)

- Context: The specification describes both a user-facing product and a production research platform (historical warehouse, trained TCN/attention models, Python services, queues, databases, and distributed workers). The repository contains no training data, trained weights, cloud credentials, or existing code.
- Decision: Build the full user journey and domain engine as a locally runnable React/TypeScript application. Use transparent, seeded, calibrated heuristic model adapters for geometry-to-performance, qualifying, strategy, tyres, traffic, incidents, and Monte Carlo outcomes.
- Rationale: Every requested product behavior can be exercised and verified immediately, while clean model interfaces preserve the upgrade path to trained services.
- Tradeoffs: Predictions are plausible counterfactual simulations, not claims of proprietary physical accuracy. Distributed persistence/training infrastructure is documented but not provisioned without data or deployment authority.
- Revisit when: Historical datasets and trained artifacts are available, or production deployment is requested.

## 2026-08-20 — Browser-local architecture

- Context: The document recommends Next.js + FastAPI + PostgreSQL + Redis workers, but this workspace begins empty and the requested outcome is a one-shot working build.
- Decision: Use Vite, React, and TypeScript with modular pure simulation packages. Store authored circuits locally and run Monte Carlo in cooperative batches in the browser.
- Rationale: Minimizes operational failure modes and makes the entire experience portable while retaining API-ready boundaries.
- Tradeoffs: No multi-user accounts, remote persistence, or horizontal workers in this delivery.
- Revisit when: Collaboration, large-scale jobs, or hosted persistence become product requirements.

## 2026-08-20 — Current grid and calibration baseline

- Context: Driver/team membership and performance are time-sensitive.
- Decision: Ship the official 22-driver, 11-team 2026 grid and use championship standings available on 2026-08-20 as the baseline calibration signal, augmented with transparent driver and car attribute priors.
- Rationale: Matches the specification's promise to simulate the current real grid.
- Tradeoffs: Strength ratings are frozen snapshots and should be versioned rather than silently changing.
- Revisit when: A data refresh pipeline is connected or a new season begins.

## 2026-08-21 — Guarantee an observable simulation window without misreporting compute

- Context: The optimized 10,000-run job often finishes in under half a second, making the accelerated lap visualizer too brief to read and the Track Intelligence cards collapsed into a narrow responsive grid column at the common 1280px viewport.
- Decision: Keep actual Monte Carlo execution untouched, but hold the running view for a minimum of 2.8 seconds before revealing results. When computation finishes during that window, label the state “Simulation complete” and “Preparing forecast” instead of pretending the model is still calculating. Recompose Track Intelligence as a four-column responsive card region with a matched geometry-confidence card and aligned supporting panels.
- Rationale: Users can observe the simulation metaphor and understand the transition without compromising timing telemetry or making a false performance claim. The new grid restores the intended metric hierarchy at desktop and tablet widths.
- Tradeoffs: Fast jobs now wait briefly before result presentation; actual compute duration and races-per-second remain the measured values shown in the result. Narrow screens still collapse the cards to two columns.
- Revisit when: The visualizer gains a user-controlled speed setting, real per-lap batch telemetry, or simulations consistently take longer than the minimum window.

## Decision template

### YYYY-MM-DD — Decision title

- Context:
- Decision:
- Rationale:
- Tradeoffs:
- Revisit when:
