# T-REK versus a strong tabular SOTA baseline

This report answers a narrow, reproducible question: on this project's leakage-safe OpenF1 tables and newest-session holdouts, does APEX T-REK outperform a tuned XGBoost baseline?

It does **not** claim that T-REK universally supersedes every state-of-the-art model. “SOTA” depends on the task, available inputs, split, metric, and compute budget. Large proprietary telemetry datasets or dense sequential inputs could favor boosted ensembles, Temporal Fusion Transformers, sequence models, or foundation models.

## Protocol

- Data: the same cached OpenF1 2023–2026 feature tables used by the shipped artifact.
- Outer test: newest sessions, untouched until final evaluation.
- Inner selection: older training sessions split chronologically again.
- XGBoost search: 18 configurations spanning depth 2/3/5, 150/250/350 trees, learning rate 0.03/0.05/0.08, and L2 regularization 1/10.
- Selection score: `MAE + 0.25 × RMSE`, matching T-REK's tail-stability guardrail.
- Seed: `20260820`.
- Pace scope: classified finishers for both models; the separate DNF hazard is not folded into clean pace.

## Untouched chronological holdout

| Task | T-REK MAE | Tuned XGBoost MAE | T-REK advantage | T-REK / XGB R² |
|---|---:|---:|---:|---:|
| Classified-finish pace | **0.1258** | 0.1337 | **5.9% lower** | 0.5328 / 0.5309 |
| Qualifying percentile | **0.1375** | 0.1483 | **7.3% lower** | 0.6534 / 0.6315 |
| Tyre residual | **0.6016 s** | 0.6306 s | **4.6% lower** | 0.1943 / 0.1898 |

## Why T-REK wins here

1. **Small, structured data.** There are 81 races rather than millions of independent examples. Huber regularization and deterministic low-rank nonlinear features have lower variance than a high-capacity sequence model.
2. **The split matches deployment.** Recency and hyperparameters are selected using past-to-future validation, not random-row shuffling.
3. **Outcomes are disentangled.** Classified-finisher pace and DNF hazard are separate competing risks, so reliability is not learned and then sampled twice.
4. **The loss matches the product.** Huber loss improves typical error while the mixed MAE/RMSE selection score rejects unstable tail behavior.
5. **The runtime constraint is real.** The complete 87 KB artifact executes identically in Python and TypeScript with no model server, native tree runtime, or opaque serialization layer.

## Where broader SOTA remains stronger

- Gradient-boosted trees are still a leading default for medium-sized tabular datasets; a broad NeurIPS benchmark found tree ensembles stronger than many deep tabular systems. That is why XGBoost is the matched baseline here, not a weak linear strawman.
- Temporal Fusion Transformers and newer time-series systems can learn richer long-range sequence structure when dense, aligned histories and substantially more data are available.
- This project does not possess setup, fuel mass, tyre temperature, aero-map, energy-deployment, or proprietary telemetry inputs. No model can recover those absent variables from public timing alone.

Primary context: [Grinsztajn, Oyallon & Varoquaux, NeurIPS 2022](https://papers.neurips.cc/paper_files/paper/2022/hash/0378c7692da36807bdec87ab043cdadc-Abstract-Datasets_and_Benchmarks.html), [Lim et al., Temporal Fusion Transformers](https://research.google/pubs/temporal-fusion-transformers-for-interpretable-multi-horizon-time-series-forecasting/), and [Rahimi & Recht, random Fourier features](https://papers.nips.cc/paper/3182-random-features-for-large-scale-kernel-machines).

## Reproduce

```bash
python3 -m pip install -r ml/requirements-benchmark.txt
python3 ml/features.py
python3 ml/benchmark_sota.py
```

The script prints the selected XGBoost configuration and complete MAE, RMSE, and R² values for both models.
