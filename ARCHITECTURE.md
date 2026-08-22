# Architecture

## Delivery topology

```text
Circuit studio (React + SVG)
        |
        v
Geometry engine
  closure -> smooth -> resample -> curvature -> track features
        |
        +---------------------+
        |                     |
        v                     v
Trained ML runtime      Track intelligence
  pace + tyres + pit
  compound + priors
        |                     |
        v                     |
Starting grid + tyres <-------+
        |
        v
10,000-run Monte Carlo
  reliability + incidents + weather + strategy + traffic
        |
        +---------------------+
        |                     |
        v                     v
Live batch visualizer    Sufficient statistics
        |                     |
        +----------+----------+
                   v
        Probability forecast + explanations
```

All runtime compute currently runs locally. Engines are pure TypeScript functions with explicit inputs, outputs, and seeds; trained NumPy coefficients are exported to JSON and executed identically in the browser.

## Historical training pipeline

```text
OpenF1 sessions (2023-2026)
  -> cached endpoint responses + SHA-256 manifest
  -> time-ordered race/driver/lap/stint/pit feature tables
  -> outer chronological train/holdout split
  -> inner chronological kernel/robustness/recency/class-weight selection
  -> T-REK Huber-kernel + selected logistic/softmax training
  -> classified-finish pace + independent DNF competing-risk decomposition
  -> learned recency-aware driver/team shrinkage priors
  -> trained-model.json + MODEL_CARD.md
  -> TypeScript inference runtime
```

Rolling driver and team form are calculated using only races preceding each sample. Holdouts use the newest sessions, not random rows, so future performance cannot leak backward through form features.

## Geometry pipeline

The SVG stroke is an authoring format, never a pixel embedding. The engine:

1. requires enough points to define a loop;
2. closes open endpoints;
3. rejects intersections among non-adjacent planar segments;
4. smooths the polyline with circular Chaikin passes;
5. resamples the circuit at equal arc-length intervals for a 360-point computational/visual profile;
6. reports the production-equivalent 2 m sample count from physical length;
7. cyclically shifts the sequence to start/finish and reverses it for counter-clockwise races;
8. derives signed curvature, a low-pass curvature sequence, straights, separated apex peaks, speed class, passing zones, and global features;
9. compares a normalized feature vector with reference circuit profiles using cosine similarity;
10. widens uncertainty from embedding distance and unusual corner count.

## Performance model

Each driver/car pairing gets a circuit-conditioned score. Historical finish, qualifying, pace, racecraft, degradation, wet, reliability, and pit-service observations are shrunk toward population means before being blended with the current-season identity. The learned finish model consumes grid percentile, lagged driver/team form, timing/speed track signature, weather, and race distance.

The runtime boundary is deliberately structured so a future nonlinear model service can provide the same outputs:

```ts
type GeometryPerformanceAdapter = {
  qualify(track, driver, car, conditions): LapDistribution
  racePace(track, driver, car, conditions): SpatialPaceProfile
  tyre(track, driver, car, compound, age, conditions): PacePenalty
  strategy(raceState): ActionDistribution
}
```

## Qualifying

The 22-car rule profile advances 16 cars from Q1 and 10 from Q2. Each stage samples multiple attempts with track evolution, driver consistency, circuit suitability, and seeded execution noise. The best attempt controls advancement.

## Detailed race engine (retained, not primary forecast truth)

The simulator maintains cumulative time, compound, tyre age, stops, service plan, best/last lap, position, and status for every driver. Each lap applies:

```text
clean pace
+ fuel penalty
+ conditional compound/degradation penalty
+ traffic loss
+ weather mismatch
+ execution noise
+ pit/service loss when selected
```

Position is always determined from cumulative time. Undercuts and overcuts therefore emerge from tyre delta, traffic, and pit loss rather than a scripted rule. Incidents and mechanical failures have separate hazards. Severe events may trigger VSC or SC, which changes pace, compresses gaps, and lowers the cost of a stop.

The detailed engine remains available for simulation invariants and possible future sample replays. The product does not present one detailed run as a second predicted winner.

## Monte Carlo

Monte Carlo runs use a lower-detail path and retain sufficient statistics only:

- win, podium, and points counts;
- finish-position histograms;
- DNF counts;
- average stops;
- most common strategy sequences.

Invariant team/driver lookups and learned predictions are precomputed once per forecast. Forty progress batches stream partial normalized distributions, run count, elapsed time, and throughput to the live UI. Work is yielded between batches to keep the browser responsive. The completed dashboard derives its headline, table, strategies, and CSV from the same aggregate object and reports 95% Wilson sampling intervals.

### Paired strategy experiments

A strategy intervention runs beside a balanced baseline with the same qualifying grid, simulation seed, and random-number sequence. Only the selected team's strategy transform changes. This common-random-number design reduces comparison noise and lets the UI report the team's baseline win probability, intervention probability, and percentage-point delta. It is a modeled counterfactual, not a claim about a real team's hidden instructions.

## Persistence and export

Circuits are stored in browser `localStorage`. The data contract is `CircuitDraft` from `src/types.ts`; it is JSON serializable and accepted by the import control. Full probability forecasts export to CSV.

Completed results also render into a self-contained SVG share card and rasterize locally to a 1200×630 PNG. Supported devices receive that image through Web Share; other browsers download the PNG and copy its caption. No circuit or forecast data leaves the browser during card generation.

## Production upgrade path

The research specification's service topology maps cleanly onto the local modules:

| Local module | Production replacement |
|---|---|
| `engine/geometry.ts` | Track FastAPI service + cached tensors |
| `ml/` NumPy training + `data/mlRuntime.ts` | Versioned PyTorch/LightGBM training and serving |
| `simulateQualifying` | Season-versioned qualifying service |
| Live forecast batches | Race worker with WebSocket progress stream |
| `runMonteCarlo` | Redis queue + distributed workers |
| `localStorage` | PostgreSQL user-circuit and simulation entities |

The UI does not depend on where those computations run.

## Verification

Automated tests cover chronology isolation, artifact provenance/contracts, model output domains, path closure, uniform resampling, intersection detection, physical sample/race-distance derivation, deterministic qualifying, Q1/Q2/Q3 advancement, full classification invariants, lap-history completeness, and normalized Monte Carlo distributions.

Browser QA covers circuit authoring controls, a visible intermediate batch, paired-strategy output, winner explanations, share behavior, final win counts and intervals, keyboard-operated tabs, all 22 probability rows, responsive overflow, touch targets, reduced motion, and runtime console output. Automated axe checks cover WCAG 2/2.1 A and AA rules.
