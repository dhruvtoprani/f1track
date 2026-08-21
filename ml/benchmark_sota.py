"""Reproduce the nested-chronological T-REK vs XGBoost comparison."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from xgboost import XGBRegressor
except ImportError as error:  # pragma: no cover - optional benchmark dependency
    raise SystemExit(
        "Install optional benchmark dependencies with "
        "`python3 -m pip install -r ml/requirements-benchmark.txt`."
    ) from error

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
sys.path.insert(0, str(ROOT))

from features import PACE_FEATURES, QUALIFY_FEATURES, TYRE_FEATURES  # noqa: E402
from train import chronological_split, matrix  # noqa: E402

SEED = 20260820
CONFIGS = [
    (depth, estimators, rate, regularization)
    for depth in [2, 3, 5]
    for estimators, rate in [(150, 0.03), (250, 0.05), (350, 0.08)]
    for regularization in [1.0, 10.0]
]


def score(frame: pd.DataFrame, features: list[str], target: str) -> dict[str, object]:
    train, test = chronological_split(frame)
    inner_train, validation = chronological_split(train)
    candidates: list[tuple[float, float, float, tuple[int, int, float, float]]] = []
    for depth, estimators, rate, regularization in CONFIGS:
        model = XGBRegressor(
            n_estimators=estimators,
            max_depth=depth,
            learning_rate=rate,
            reg_lambda=regularization,
            subsample=0.9,
            colsample_bytree=0.9,
            objective="reg:squarederror",
            tree_method="hist",
            random_state=SEED,
            n_jobs=4,
        )
        model.fit(matrix(inner_train, features), inner_train[target].astype(float).to_numpy())
        prediction = model.predict(matrix(validation, features))
        truth = validation[target].astype(float).to_numpy()
        mae = float(np.mean(np.abs(truth - prediction)))
        rmse = float(np.sqrt(np.mean((truth - prediction) ** 2)))
        candidates.append((mae + 0.25 * rmse, mae, rmse, (depth, estimators, rate, regularization)))

    _, validation_mae, validation_rmse, selected = min(candidates)
    depth, estimators, rate, regularization = selected
    model = XGBRegressor(
        n_estimators=estimators,
        max_depth=depth,
        learning_rate=rate,
        reg_lambda=regularization,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="reg:squarederror",
        tree_method="hist",
        random_state=SEED,
        n_jobs=4,
    )
    model.fit(matrix(train, features), train[target].astype(float).to_numpy())
    prediction = model.predict(matrix(test, features))
    truth = test[target].astype(float).to_numpy()
    mae = float(np.mean(np.abs(truth - prediction)))
    rmse = float(np.sqrt(np.mean((truth - prediction) ** 2)))
    denominator = float(np.sum((truth - truth.mean()) ** 2))
    r2 = float(1 - np.sum((truth - prediction) ** 2) / denominator)
    return {
        "selected": {
            "max_depth": depth,
            "n_estimators": estimators,
            "learning_rate": rate,
            "reg_lambda": regularization,
        },
        "selection_validation_mae": validation_mae,
        "selection_validation_rmse": validation_rmse,
        "mae": mae,
        "rmse": rmse,
        "r2": r2,
        "train_rows": len(train),
        "test_rows": len(test),
    }


def main() -> None:
    artifact = json.loads((PROJECT_ROOT / "src" / "data" / "trained-model.json").read_text())
    tasks = {
        "pace": ("pace", PACE_FEATURES, "finish_pct", True),
        "qualifying": ("qualifying", QUALIFY_FEATURES, "qualifying_pct", False),
        "tyre": ("tyre", TYRE_FEATURES, "pace_residual", False),
    }
    results: dict[str, object] = {
        "seed": SEED,
        "selection": "inner chronological MAE + 0.25 * RMSE",
        "test": "untouched newest-session chronological holdout",
        "tasks": {},
    }
    for name, (table_name, features, target, classified_only) in tasks.items():
        frame = pd.read_csv(ROOT / "data" / "processed" / f"{table_name}.csv")
        if classified_only:
            frame = frame[frame["dnf"] < 0.5].copy()
        xgboost = score(frame, features, target)
        trek = artifact["evaluation"][name]
        results["tasks"][name] = {
            "t_rek": {key: trek[key] for key in ["mae", "rmse", "r2", "train_rows", "test_rows"]},
            "xgboost": xgboost,
            "t_rek_mae_improvement_vs_xgboost": 1 - trek["mae"] / xgboost["mae"],
        }
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
