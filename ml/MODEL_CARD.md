# APEX ML model card

- Model version: `APEX-ML-f0c117aca4`
- Trained: 2026-08-21T19:28:45.829410+00:00
- Source: OpenF1 historical API, seasons 2023-2026
- Races: 81
- Pace rows: 1639
- Qualifying rows: 1639
- Tyre laps: 78291
- Pit-decision rows: 13935
- Starting-compound rows: 1636
- Next-compound rows: 3009
- Source SHA-256: `9bc45fe8e59fc5ce53c9e59bbb63117de6dbd17edb6f3a915b46fe2da9b2bec6`
- Pipeline SHA-256: `cf661027f723bd4460a8cfdfa8d5589f4b176e6bd00b0d91fbb27fceb54d2276`

## Mathematical foundation — T-REK

APEX T-REK is the project-specific **Temporal Robust Equilibrium Kernel**. For standardized context `x`, it forms an explicit nonlinear map `phi(x) = [x; sqrt(2/D) cos(Wx + b)]`, weights observation `i` by `2^(-session_age_i / h)`, and minimizes `sum_i weight_i * Huber_delta(y_i - beta·phi(x_i)) + alpha * ||beta||²`. `D`, kernel scale, `h`, `delta`, and `alpha` are chosen only on an inner time split. Race order is modeled conditional on a classified finish while a separate calibrated hazard owns DNF risk, preventing reliability from being counted twice.

This is a unique synthesis for this simulator, built from auditable established methods rather than a claim of a new universal theorem. Every projection, phase, coefficient, scaler, and selected hyperparameter is exported for identical TypeScript inference.

## Holdout evaluation

All component metrics use the newest sessions as a chronological holdout. Kernel, robustness, recency, regularization, and class-weight settings are selected on a separate inner chronological validation split; newest-session test rows do not participate in fitting or selection. Race-performance and qualifying models also use leave-one-circuit-out evaluation.

| Model | Metric | Result |
|---|---:|---:|
| Classified-finish pace | MAE | 0.1258 finish percentile |
| Race performance | R2 | 0.5328 |
| Race performance | Improvement vs same-feature ridge | 6.3% |
| Race performance | Selected spectral dimensions | 64 |
| Race performance | Leave-one-circuit-out MAE | 0.1252 |
| Qualifying percentile | MAE | 0.1375 |
| Qualifying percentile | Improvement vs same-feature ridge | 3.6% |
| Qualifying percentile | Selected spectral dimensions | 64 |
| Qualifying percentile | Leave-one-circuit-out MAE | 0.1620 |
| Tyre degradation | MAE | 0.6016 seconds |
| Tyre degradation | R2 | 0.1943 |
| Tyre degradation | Improvement vs same-feature ridge | 5.2% |
| Pit hazard | Log loss | 0.4838 |
| Pit hazard | Accuracy | 0.7815 |
| Starting compound | Accuracy | 0.6510 |
| Starting compound | Log loss | 0.9242 |
| Next compound | Accuracy | 0.5297 |
| Next compound | Log loss | 0.9974 |
| Incident / DNF | Log loss | 0.4367 |
| Overtakes per lap | MAE | 0.7611 |
| Overtakes per lap | R2 | 0.0338 |

## Runtime use

The TypeScript runtime imports `src/data/trained-model.json`, blends learned driver/team priors with current-season identity, and executes the exported coefficients directly for qualifying, race performance, tyres, pit hazard, starting and next compounds, incident probability, and overtaking environment. Weak holdout components are blended conservatively with the structured simulator priors rather than trusted blindly.

## Limitations

- Public timing data do not expose setup, fuel mass, tyre temperature, aero maps, or energy deployment.
- Track timing and speed signatures proxy geometry in the historical tabular models; fictional geometry is supplied by the local geometry engine.
- T-REK is a project-specific synthesis of established robust regression, random-feature kernel approximation, time decay, and competing-risk decomposition; it is not claimed as a new general theorem.
- The overtake-rate regressor has low positive holdout R2, so runtime inference still shrinks it toward the empirical mean.
- The incident model is useful for probability calibration but not threshold classification; runtime blends it with explicit reliability and driving-risk hazards.
- Predictions are calibrated counterfactuals, not official Formula 1 or team forecasts.
