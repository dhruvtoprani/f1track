# Real-data ML pipeline

This pipeline turns public OpenF1 history into versioned models consumed by the web simulator.

```bash
python3 ml/openf1.py --years 2023 2024 2025 2026
python3 ml/features.py
python3 ml/train.py
```

Or run the complete deterministic workflow:

```bash
python3 ml/pipeline.py --years 2023 2024 2025 2026
```

Outputs:

- `ml/data/raw/`: cached API responses (ignored by Git)
- `ml/data/processed/`: reproducible feature tables (ignored by Git)
- `src/data/trained-model.json`: compact, versioned runtime artifact
- `ml/MODEL_CARD.md`: generated evaluation and provenance report

The training implementation uses NumPy/Pandas only. The primary continuous models use the project-specific APEX Temporal Robust Equilibrium Kernel (T-REK); classification components remain compact logistic/softmax models. Every scaler, random-feature projection, phase, coefficient, and selected hyperparameter is exported so inference is identical in Python and TypeScript.

## T-REK mathematical foundation

For standardized race context `x`, T-REK uses the explicit feature map

`phi(x) = [x; sqrt(2/D) cos(Wx + b)]`

and solves

`argmin_beta sum_i 2^(-session_age_i / h) Huber_delta(y_i - beta·phi(x_i)) + alpha ||beta||²`.

The spectral dimension `D`, kernel scale, session half-life `h`, Huber threshold `delta`, and regularization `alpha` are selected on an inner chronological validation split. The newest-session test split is evaluated once after selection. Final race order is decomposed into classified-finisher pace and an independent DNF hazard so reliability is not learned once in pace and sampled a second time in the simulator.

T-REK is a unique synthesis for this project, not a claim that its ingredients are newly invented. Its nonlinear map follows [Rahimi and Recht's random-feature kernel approximation](https://papers.nips.cc/paper/3182-random-features-for-large-scale-kernel-machines); its robust objective follows Huber M-estimation; temporal weighting and the simulator's empirical-Bayes priors address season drift and sparse histories.

## Models

- Race performance: T-REK on classified finishers using starting position, leakage-safe form, track timing/speed signature, weather, and distance; DNF risk is modeled separately.
- Qualifying: T-REK on leakage-safe race and qualifying form, recency/trend, circuit signature, conditions, and distance.
- Tyre degradation: temporally weighted robust T-REK regression on tyre age, nonlinear age terms, compound, race progress, temperature, and track signature.
- Pit hazard: class-balanced logistic regression on stint age, race progress, compound, conditions, and circuit signature.
- Starting compound: softmax regression using grid, form, conditions, circuit signature, and distance, with class-weight strength selected by nested chronological log loss.
- Next compound: similarly selected softmax regression at historical stint transitions.
- Incident/DNF: prevalence-preserving logistic regression on driver/team form, grid, circuit signature, weather, and distance.
- Overtaking environment: ridge regression of observed overtakes per lap on circuit timing/speed signature, conditions, and distance.
- Driver/constructor priors: empirical-Bayes-style shrinkage of qualifying, pace, racecraft, tyre, wet, consistency, reliability, and operational performance toward global means.

Chronological holdouts are used for every model; race-performance and qualifying models additionally run leave-one-circuit-out evaluation. Deployable coefficients are then refit on all observed rows. Random seeds, the source-response hash, and the training-code hash are stored in the artifact.
