"""Train auditable NumPy baselines and export a TypeScript-compatible artifact."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from features import (
    COMPOUNDS, OVERTAKE_FEATURES, PACE_FEATURES, PIT_FEATURES,
    QUALIFY_FEATURES, START_FEATURES, TYRE_FEATURES,
)

ROOT = Path(__file__).resolve().parent
PROCESSED = ROOT / "data" / "processed"
ARTIFACT = ROOT.parent / "src" / "data" / "trained-model.json"
MODEL_CARD = ROOT / "MODEL_CARD.md"
SEED = 20260820


def clamp(value: float, low: float, high: float) -> float:
    return float(max(low, min(high, value)))


def chronological_split(frame: pd.DataFrame, ratio: float = 0.8) -> tuple[pd.DataFrame, pd.DataFrame]:
    ordered = frame.sort_values("session_date").reset_index(drop=True)
    unique_dates = sorted(ordered["session_date"].unique())
    boundary = unique_dates[max(1, int(len(unique_dates) * ratio)) - 1]
    train = ordered[ordered["session_date"] <= boundary]
    test = ordered[ordered["session_date"] > boundary]
    if test.empty:
        cut = max(1, int(len(ordered) * ratio))
        return ordered.iloc[:cut], ordered.iloc[cut:]
    return train, test


def matrix(frame: pd.DataFrame, features: list[str]) -> np.ndarray:
    return frame[features].astype(float).replace([np.inf, -np.inf], np.nan).fillna(0).to_numpy()


def standardize_fit(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mean = values.mean(axis=0)
    std = values.std(axis=0)
    std[std < 1e-8] = 1.0
    return (values - mean) / std, mean, std


def session_recency_weights(frame: pd.DataFrame, half_life: float) -> np.ndarray:
    """Give recent sessions more influence without allowing future leakage."""
    if half_life >= 999:
        return np.ones(len(frame))
    dates = sorted(frame["session_date"].unique())
    date_index = {date: index for index, date in enumerate(dates)}
    latest = len(dates) - 1
    return np.array([2 ** (-(latest - date_index[date]) / half_life) for date in frame["session_date"]])


def spectral_parameters(feature_count: int, dimensions: int, gamma: float) -> tuple[np.ndarray, np.ndarray]:
    if dimensions == 0:
        return np.empty((feature_count, 0)), np.empty(0)
    rng = np.random.default_rng(SEED + dimensions + int(gamma * 100))
    projection = rng.normal(0, gamma, size=(feature_count, dimensions))
    phase = rng.uniform(0, 2 * np.pi, size=dimensions)
    return projection, phase


def spectral_design(values: np.ndarray, projection: np.ndarray, phase: np.ndarray) -> np.ndarray:
    if not len(phase):
        return values
    spectral = np.sqrt(2 / len(phase)) * np.cos(values @ projection + phase)
    return np.column_stack((values, spectral))


def fit_temporal_huber(
    values: np.ndarray,
    target: np.ndarray,
    alpha: float,
    delta: float,
    recency_weights: np.ndarray,
    iterations: int = 12,
) -> tuple[np.ndarray, float]:
    """IRLS solution for time-weighted Huber loss plus ridge regularization."""
    design = np.column_stack((np.ones(len(values)), values))
    regularizer = np.eye(design.shape[1]) * alpha
    regularizer[0, 0] = 1e-8
    weighted_design = design * recency_weights[:, None]
    coefficients = np.linalg.solve(
        weighted_design.T @ design + regularizer,
        weighted_design.T @ target,
    )
    for _ in range(iterations):
        residual = target - design @ coefficients
        robust_weights = np.minimum(1.0, delta / np.maximum(np.abs(residual), 1e-8))
        weights = recency_weights * robust_weights
        weighted_design = design * weights[:, None]
        updated = np.linalg.solve(
            weighted_design.T @ design + regularizer,
            weighted_design.T @ target,
        )
        if np.max(np.abs(updated - coefficients)) < 1e-7:
            coefficients = updated
            break
        coefficients = updated
    return coefficients[1:], float(coefficients[0])


def temporal_prediction(
    frame: pd.DataFrame,
    features: list[str],
    mean: np.ndarray,
    std: np.ndarray,
    projection: np.ndarray,
    phase: np.ndarray,
    coefficients: np.ndarray,
    intercept: float,
) -> np.ndarray:
    standardized = (matrix(frame, features) - mean) / std
    return intercept + spectral_design(standardized, projection, phase) @ coefficients


def temporal_kernel_model(
    frame: pd.DataFrame,
    features: list[str],
    target: str,
    dimensions: list[int],
    gammas: list[float],
    alphas: list[float],
    deltas: list[float],
    half_lives: list[float],
) -> tuple[dict[str, Any], dict[str, float]]:
    """Nested-time selection for the APEX temporal robust equilibrium kernel."""
    train, test = chronological_split(frame)
    inner_train, validation = chronological_split(train)
    inner_values, inner_mean, inner_std = standardize_fit(matrix(inner_train, features))
    validation_values = (matrix(validation, features) - inner_mean) / inner_std
    inner_target = inner_train[target].astype(float).to_numpy()
    validation_target = validation[target].astype(float).to_numpy()
    scored: list[tuple[float, float, float, int, float, float, float, float]] = []
    for dimension in dimensions:
        dimension_gammas = [0.0] if dimension == 0 else gammas
        for gamma in dimension_gammas:
            projection, phase = spectral_parameters(len(features), dimension, gamma)
            inner_design = spectral_design(inner_values, projection, phase)
            validation_design = spectral_design(validation_values, projection, phase)
            for alpha in alphas:
                for delta in deltas:
                    for half_life in half_lives:
                        coefficients, intercept = fit_temporal_huber(
                            inner_design, inner_target, alpha, delta,
                            session_recency_weights(inner_train, half_life),
                        )
                        prediction = intercept + validation_design @ coefficients
                        mae = float(np.mean(np.abs(validation_target - prediction)))
                        rmse = float(np.sqrt(np.mean((validation_target - prediction) ** 2)))
                        # The proper squared-error term prevents an MAE-only model
                        # from buying small median gains with unstable tail errors.
                        scored.append((mae + 0.25 * rmse, mae, rmse, dimension, gamma, alpha, delta, half_life))
    selection_score, selection_mae, selection_rmse, dimension, gamma, alpha, delta, half_life = min(scored)

    train_values, train_mean, train_std = standardize_fit(matrix(train, features))
    projection, phase = spectral_parameters(len(features), dimension, gamma)
    train_design = spectral_design(train_values, projection, phase)
    coefficients, intercept = fit_temporal_huber(
        train_design, train[target].astype(float).to_numpy(), alpha, delta,
        session_recency_weights(train, half_life),
    )
    predictions = temporal_prediction(
        test, features, train_mean, train_std, projection, phase, coefficients, intercept,
    )
    y_test = test[target].astype(float).to_numpy()
    mae = float(np.mean(np.abs(y_test - predictions))) if len(test) else 0.0
    rmse = float(np.sqrt(np.mean((y_test - predictions) ** 2))) if len(test) else 0.0
    denominator = float(np.sum((y_test - y_test.mean()) ** 2)) if len(test) else 0.0
    r2 = float(1 - np.sum((y_test - predictions) ** 2) / denominator) if denominator > 1e-12 else 0.0

    full_values, full_mean, full_std = standardize_fit(matrix(frame, features))
    full_projection, full_phase = spectral_parameters(len(features), dimension, gamma)
    full_design = spectral_design(full_values, full_projection, full_phase)
    full_coefficients, full_intercept = fit_temporal_huber(
        full_design, frame[target].astype(float).to_numpy(), alpha, delta,
        session_recency_weights(frame, half_life),
    )
    model = {
        "type": "temporal_huber_kernel", "features": features,
        "mean": full_mean.tolist(), "std": full_std.tolist(),
        "projection": full_projection.tolist(), "phase": full_phase.tolist(),
        "coefficients": full_coefficients.tolist(), "intercept": full_intercept,
        "spectral_dimensions": dimension, "gamma": gamma, "alpha": alpha,
        "huber_delta": delta, "session_half_life": half_life,
    }
    return model, {
        "mae": mae, "rmse": rmse, "r2": r2,
        "selection_score": selection_score, "selection_validation_mae": selection_mae,
        "selection_validation_rmse": selection_rmse, "selected_dimensions": dimension,
        "selected_gamma": gamma, "selected_alpha": alpha, "selected_huber_delta": delta,
        "selected_session_half_life": half_life,
        "train_rows": len(train), "test_rows": len(test),
    }


def leave_one_circuit_out_kernel_mae(
    frame: pd.DataFrame,
    features: list[str],
    target: str,
    model: dict[str, Any],
) -> tuple[float, int]:
    errors: list[float] = []
    circuits = sorted(frame["circuit_name"].dropna().unique())
    for circuit in circuits:
        training = frame[frame["circuit_name"] != circuit]
        holdout = frame[frame["circuit_name"] == circuit]
        if training.empty or holdout.empty:
            continue
        values, mean, std = standardize_fit(matrix(training, features))
        projection, phase = spectral_parameters(
            len(features), int(model["spectral_dimensions"]), float(model["gamma"]),
        )
        design = spectral_design(values, projection, phase)
        coefficients, intercept = fit_temporal_huber(
            design, training[target].astype(float).to_numpy(), float(model["alpha"]),
            float(model["huber_delta"]),
            session_recency_weights(training, float(model["session_half_life"])),
        )
        predictions = temporal_prediction(
            holdout, features, mean, std, projection, phase, coefficients, intercept,
        )
        errors.extend(np.abs(holdout[target].astype(float).to_numpy() - predictions).tolist())
    return (float(np.mean(errors)) if errors else 0.0, len(circuits))


def leave_one_circuit_out_mae(frame: pd.DataFrame, features: list[str], target: str, alpha: float) -> tuple[float, int]:
    errors: list[float] = []
    circuits = sorted(frame["circuit_name"].dropna().unique())
    for circuit in circuits:
        training = frame[frame["circuit_name"] != circuit]
        holdout = frame[frame["circuit_name"] == circuit]
        if training.empty or holdout.empty:
            continue
        x_train, mean, std = standardize_fit(matrix(training, features))
        y_train = training[target].astype(float).to_numpy()
        intercept = float(y_train.mean())
        coefficients = np.linalg.solve(
            x_train.T @ x_train + np.eye(len(features)) * alpha,
            x_train.T @ (y_train - intercept),
        )
        predictions = intercept + ((matrix(holdout, features) - mean) / std) @ coefficients
        errors.extend(np.abs(holdout[target].astype(float).to_numpy() - predictions).tolist())
    return (float(np.mean(errors)) if errors else 0.0, len(circuits))


def select_ridge_alpha(
    training: pd.DataFrame,
    features: list[str],
    target: str,
    candidates: list[float],
) -> tuple[float, float]:
    """Select regularization on an inner chronological split only."""
    inner_train, validation = chronological_split(training)
    x_train, mean, std = standardize_fit(matrix(inner_train, features))
    y_train = inner_train[target].astype(float).to_numpy()
    intercept = float(y_train.mean())
    x_validation = (matrix(validation, features) - mean) / std
    y_validation = validation[target].astype(float).to_numpy()
    scored: list[tuple[float, float]] = []
    for alpha in candidates:
        coefficients = np.linalg.solve(
            x_train.T @ x_train + np.eye(len(features)) * alpha,
            x_train.T @ (y_train - intercept),
        )
        predictions = intercept + x_validation @ coefficients
        scored.append((float(np.mean(np.abs(y_validation - predictions))), alpha))
    validation_mae, selected_alpha = min(scored)
    return selected_alpha, validation_mae


def regression_model(frame: pd.DataFrame, features: list[str], target: str, alpha: float) -> tuple[dict[str, Any], dict[str, float]]:
    train, test = chronological_split(frame)
    candidates = sorted({0.1, 0.5, 1.0, alpha, alpha * 3, alpha * 10, alpha * 25})
    selected_alpha, selection_mae = select_ridge_alpha(train, features, target, candidates)
    x_train, mean, std = standardize_fit(matrix(train, features))
    y_train = train[target].astype(float).to_numpy()
    y_mean = float(y_train.mean())
    centered = y_train - y_mean
    regularizer = np.eye(len(features)) * selected_alpha
    coefficients = np.linalg.solve(x_train.T @ x_train + regularizer, x_train.T @ centered)
    x_test = (matrix(test, features) - mean) / std
    y_test = test[target].astype(float).to_numpy()
    predictions = y_mean + x_test @ coefficients
    mae = float(np.mean(np.abs(y_test - predictions))) if len(test) else 0.0
    rmse = float(np.sqrt(np.mean((y_test - predictions) ** 2))) if len(test) else 0.0
    denominator = float(np.sum((y_test - y_test.mean()) ** 2)) if len(test) else 0.0
    r2 = float(1 - np.sum((y_test - predictions) ** 2) / denominator) if denominator > 1e-12 else 0.0
    # Refit the deployable coefficients on all available rows after measuring
    # the untouched chronological holdout above.
    x_full, full_mean, full_std = standardize_fit(matrix(frame, features))
    y_full = frame[target].astype(float).to_numpy()
    full_intercept = float(y_full.mean())
    full_coefficients = np.linalg.solve(
        x_full.T @ x_full + regularizer,
        x_full.T @ (y_full - full_intercept),
    )
    model = {
        "type": "ridge_regression", "features": features, "mean": full_mean.tolist(), "std": full_std.tolist(),
        "coefficients": full_coefficients.tolist(), "intercept": full_intercept, "alpha": selected_alpha,
    }
    return model, {
        "mae": mae, "rmse": rmse, "r2": r2,
        "selected_alpha": selected_alpha, "selection_validation_mae": selection_mae,
        "train_rows": len(train), "test_rows": len(test),
    }


def fit_logistic(x_values: np.ndarray, y_values: np.ndarray, iterations: int, balanced: bool) -> tuple[np.ndarray, float]:
    weights = np.zeros(x_values.shape[1])
    intercept = 0.0
    positives = max(1.0, y_values.sum())
    negatives = max(1.0, len(y_values) - positives)
    sample_weights = np.where(y_values > 0.5, len(y_values) / (2 * positives), len(y_values) / (2 * negatives)) if balanced else np.ones(len(y_values))
    for iteration in range(iterations):
        logits = np.clip(intercept + x_values @ weights, -25, 25)
        probabilities = 1 / (1 + np.exp(-logits))
        error = (probabilities - y_values) * sample_weights
        rate = 0.16 / (1 + iteration / 450)
        weights -= rate * (x_values.T @ error / len(y_values) + 0.002 * weights)
        intercept -= rate * float(error.mean())
    if balanced:
        intercept += float(np.log(positives / negatives))
    return weights, intercept


def logistic_model(frame: pd.DataFrame, features: list[str], target: str, iterations: int = 1200, balanced: bool = True) -> tuple[dict[str, Any], dict[str, float]]:
    train, test = chronological_split(frame)
    x_train, mean, std = standardize_fit(matrix(train, features))
    y_train = train[target].astype(float).to_numpy()
    weights, intercept = fit_logistic(x_train, y_train, iterations, balanced)
    x_test = (matrix(test, features) - mean) / std
    y_test = test[target].astype(float).to_numpy()
    probability = 1 / (1 + np.exp(-np.clip(intercept + x_test @ weights, -25, 25)))
    epsilon = 1e-8
    log_loss = float(-np.mean(y_test * np.log(probability + epsilon) + (1 - y_test) * np.log(1 - probability + epsilon))) if len(test) else 0.0
    accuracy = float(np.mean((probability >= 0.5) == y_test)) if len(test) else 0.0
    predictions = probability >= 0.5
    true_positive = float(np.sum(predictions & (y_test > 0.5)))
    false_positive = float(np.sum(predictions & (y_test <= 0.5)))
    false_negative = float(np.sum((~predictions) & (y_test > 0.5)))
    precision = true_positive / max(1.0, true_positive + false_positive)
    recall = true_positive / max(1.0, true_positive + false_negative)
    f1 = 2 * precision * recall / max(1e-8, precision + recall)
    brier = float(np.mean((probability - y_test) ** 2)) if len(test) else 0.0
    x_full, full_mean, full_std = standardize_fit(matrix(frame, features))
    y_full = frame[target].astype(float).to_numpy()
    full_weights, full_intercept = fit_logistic(x_full, y_full, iterations, balanced)
    model = {
        "type": "logistic_regression", "features": features, "mean": full_mean.tolist(), "std": full_std.tolist(),
        "coefficients": full_weights.tolist(), "intercept": full_intercept, "iterations": iterations, "class_balanced": balanced,
    }
    return model, {
        "log_loss": log_loss, "brier": brier, "accuracy": accuracy,
        "precision": precision, "recall": recall, "f1": f1,
        "positive_rate": float(y_train.mean()), "train_rows": len(train), "test_rows": len(test),
    }


def fit_softmax(
    x_values: np.ndarray,
    y_index: np.ndarray,
    class_count: int,
    iterations: int,
    class_power: float,
    l2: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    y_one_hot = np.eye(class_count)[y_index]
    weights = np.zeros((x_values.shape[1], class_count))
    counts = np.bincount(y_index, minlength=class_count).astype(float)
    intercept = np.log(counts + 1.0)
    intercept -= intercept.mean()
    class_weights = (len(y_index) / np.maximum(1.0, class_count * counts)) ** class_power
    sample_weights = class_weights[y_index]
    for iteration in range(iterations):
        logits = x_values @ weights + intercept
        logits -= logits.max(axis=1, keepdims=True)
        exp = np.exp(np.clip(logits, -25, 25))
        probabilities = exp / exp.sum(axis=1, keepdims=True)
        error = (probabilities - y_one_hot) * sample_weights[:, None]
        rate = 0.11 / (1 + iteration / 500)
        weights -= rate * (x_values.T @ error / len(x_values) + l2 * weights)
        intercept -= rate * error.mean(axis=0)
    return weights, intercept, counts


def softmax_model(frame: pd.DataFrame, features: list[str], target: str, classes: list[str], iterations: int = 1500) -> tuple[dict[str, Any], dict[str, float]]:
    train, test = chronological_split(frame)
    inner_train, validation = chronological_split(train)
    class_index = {label: index for index, label in enumerate(classes)}
    inner_values, inner_mean, inner_std = standardize_fit(matrix(inner_train, features))
    inner_index = np.array([class_index[value] for value in inner_train[target]])
    validation_values = (matrix(validation, features) - inner_mean) / inner_std
    validation_index = np.array([class_index[value] for value in validation[target]])
    settings: list[tuple[float, float, float, float]] = []
    for class_power in [0.0, 0.25, 0.5, 0.75, 1.0]:
        for l2 in [0.0005, 0.002, 0.01, 0.05]:
            candidate_weights, candidate_intercept, _ = fit_softmax(
                inner_values, inner_index, len(classes), iterations, class_power, l2,
            )
            logits = validation_values @ candidate_weights + candidate_intercept
            logits -= logits.max(axis=1, keepdims=True)
            exp = np.exp(np.clip(logits, -25, 25))
            probability = exp / exp.sum(axis=1, keepdims=True)
            log_loss = float(-np.mean(np.log(probability[np.arange(len(validation_index)), validation_index] + 1e-8)))
            accuracy = float(np.mean(probability.argmax(axis=1) == validation_index))
            settings.append((log_loss, -accuracy, class_power, l2))
    selection_log_loss, negative_selection_accuracy, class_power, l2 = min(settings)
    x_train, mean, std = standardize_fit(matrix(train, features))
    y_index = np.array([class_index[value] for value in train[target]])
    weights, intercept, counts = fit_softmax(x_train, y_index, len(classes), iterations, class_power, l2)
    x_test = (matrix(test, features) - mean) / std
    logits = x_test @ weights + intercept
    logits -= logits.max(axis=1, keepdims=True)
    exp = np.exp(np.clip(logits, -25, 25))
    probability = exp / exp.sum(axis=1, keepdims=True)
    predictions = probability.argmax(axis=1)
    truth = np.array([class_index[value] for value in test[target]])
    accuracy = float(np.mean(predictions == truth)) if len(test) else 0.0
    log_loss = float(-np.mean(np.log(probability[np.arange(len(truth)), truth] + 1e-8))) if len(test) else 0.0
    x_full, full_mean, full_std = standardize_fit(matrix(frame, features))
    full_index = np.array([class_index[value] for value in frame[target]])
    full_weights, full_intercept, _ = fit_softmax(x_full, full_index, len(classes), iterations, class_power, l2)
    model = {
        "type": "softmax_regression", "features": features, "classes": classes, "mean": full_mean.tolist(),
        "std": full_std.tolist(), "coefficients": full_weights.tolist(), "intercept": full_intercept.tolist(),
        "iterations": iterations, "class_weight_power": class_power, "l2": l2,
    }
    return model, {
        "accuracy": accuracy, "log_loss": log_loss,
        "selection_validation_accuracy": -negative_selection_accuracy,
        "selection_validation_log_loss": selection_log_loss,
        "selected_class_weight_power": class_power, "selected_l2": l2,
        "class_counts": {label: int(counts[index]) for index, label in enumerate(classes)},
        "train_rows": len(train), "test_rows": len(test),
    }


def shrink(value: float, global_value: float, samples: int, prior: float = 6.0) -> float:
    weight = samples / (samples + prior)
    return float(value * weight + global_value * (1 - weight))


def make_priors(stats: pd.DataFrame, circuits: pd.DataFrame) -> tuple[dict[str, Any], dict[str, Any]]:
    joined = stats.merge(circuits[["session_key", "top_speed"]], on="session_key", how="left")
    global_values = {column: float(joined[column].median()) for column in ["qualifying_pct", "finish_pct", "racecraft_delta", "pace_delta_pct", "lap_cv", "tyre_slope", "dnf", "pit_duration"]}
    driver_priors: dict[str, Any] = {}
    for code, group in joined.groupby("driver_code"):
        group = group.sort_values("session_date")
        n = len(group)
        qualify = shrink(float(group["qualifying_pct"].mean()), global_values["qualifying_pct"], n)
        finish = shrink(float(group["finish_pct"].mean()), global_values["finish_pct"], n)
        pace_delta = shrink(float(group["pace_delta_pct"].median()), global_values["pace_delta_pct"], n)
        racecraft = shrink(float(group["racecraft_delta"].mean()), global_values["racecraft_delta"], n)
        lap_cv = shrink(float(group["lap_cv"].median()), global_values["lap_cv"], n)
        tyre_slope = shrink(float(group["tyre_slope"].median()), global_values["tyre_slope"], n)
        wet = group[group["rainfall"] > 0.05]
        wet_finish = shrink(float(wet["finish_pct"].mean()) if len(wet) else finish, finish, len(wet), 4)
        recent_finish = float(group["finish_pct"].tail(8).mean())
        recent_qualifying = float(group["qualifying_pct"].tail(8).mean())
        short_qualifying = float(group["qualifying_pct"].tail(3).mean())
        racecraft_delta = shrink(float(group["racecraft_delta"].tail(8).mean()), 0.0, min(n, 8), 3)
        driver_priors[str(code)] = {
            "samples": n,
            "pace": clamp(98 - pace_delta * 4.2, 72, 99),
            "qualifying": clamp(100 - qualify * 23, 74, 99),
            "racecraft": clamp(90 + racecraft * 24, 76, 99),
            "tyre_management": clamp(96 - max(0, tyre_slope) * 45, 75, 99),
            "wet": clamp(100 - wet_finish * 24, 74, 99),
            "consistency": clamp(100 - lap_cv * 75, 76, 99),
            "risk": clamp(48 + float(group["dnf"].mean()) * 170, 45, 82),
            "historical_finish_percentile": finish,
            "historical_qualifying_percentile": qualify,
            "recent_finish_percentile": recent_finish,
            "recent_qualifying_percentile": recent_qualifying,
            "qualifying_trend": short_qualifying - recent_qualifying,
            "racecraft_delta": racecraft_delta,
        }
    team_priors: dict[str, Any] = {}
    for team, group in joined.groupby("team_name"):
        group = group.sort_values("session_date")
        n = len(group)
        finish = shrink(float(group["finish_pct"].mean()), global_values["finish_pct"], n, 10)
        fast = group[group["top_speed"] >= joined["top_speed"].median()]
        slow = group[group["top_speed"] < joined["top_speed"].median()]
        fast_finish = shrink(float(fast["finish_pct"].mean()) if len(fast) else finish, finish, len(fast), 5)
        slow_finish = shrink(float(slow["finish_pct"].mean()) if len(slow) else finish, finish, len(slow), 5)
        tyre_slope = shrink(float(group["tyre_slope"].median()), global_values["tyre_slope"], n, 10)
        dnf_rate = shrink(float(group["dnf"].mean()), global_values["dnf"], n, 12)
        pit_duration = shrink(float(group["pit_duration"].median()), global_values["pit_duration"], n, 12)
        baseline = clamp(100 - finish * 31, 70, 99)
        qualifying = shrink(float(group["qualifying_pct"].mean()), global_values["qualifying_pct"], n, 10)
        recent_finish = float(group["finish_pct"].tail(16).mean())
        recent_qualifying = float(group["qualifying_pct"].tail(16).mean())
        short_qualifying = float(group["qualifying_pct"].tail(6).mean())
        racecraft_delta = shrink(float(group["racecraft_delta"].tail(16).mean()), 0.0, min(n, 16), 5)
        team_priors[str(team)] = {
            "samples": n, "baseline": baseline,
            "high_speed": clamp(100 - fast_finish * 31, 70, 99),
            "low_speed": clamp(100 - slow_finish * 31, 70, 99),
            "power": clamp(100 - fast_finish * 30, 70, 99),
            "traction": clamp(100 - slow_finish * 30, 70, 99),
            "tyre_life": clamp(96 - max(0, tyre_slope) * 50, 72, 99),
            "reliability": clamp(100 - dnf_rate * 75, 76, 99),
            "strategy": clamp(97 - max(0, pit_duration - 2.3) * 4.5, 74, 98),
            "historical_finish_percentile": finish,
            "historical_qualifying_percentile": qualifying,
            "recent_finish_percentile": recent_finish,
            "recent_qualifying_percentile": recent_qualifying,
            "qualifying_trend": short_qualifying - recent_qualifying,
            "racecraft_delta": racecraft_delta,
        }
    return driver_priors, team_priors


def rounded(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (float, np.floating)):
        return round(float(value), 8)
    if isinstance(value, (int, np.integer)):
        return int(value)
    return value


def train() -> dict[str, Any]:
    manifest = json.loads((PROCESSED / "manifest.json").read_text())
    pace = pd.read_csv(PROCESSED / "pace.csv")
    qualifying = pd.read_csv(PROCESSED / "qualifying.csv")
    tyre = pd.read_csv(PROCESSED / "tyre.csv")
    pit = pd.read_csv(PROCESSED / "pit.csv")
    start = pd.read_csv(PROCESSED / "start.csv")
    next_compound = pd.read_csv(PROCESSED / "next_compound.csv")
    stats = pd.read_csv(PROCESSED / "stats.csv")
    circuits = pd.read_csv(PROCESSED / "circuits.csv")
    # Final position is a competing-risk outcome: pace describes classified
    # finishers, while the separate incident model owns DNF probability.
    pace_survivors = pace[pace["dnf"] < 0.5].copy()
    _, pace_baseline = regression_model(pace_survivors, PACE_FEATURES, "finish_pct", alpha=3.0)
    pace_model, pace_metrics = temporal_kernel_model(
        pace_survivors, PACE_FEATURES, "finish_pct",
        dimensions=[0, 32, 64], gammas=[0.25, 0.5, 1.0],
        alphas=[0.05, 0.2, 1.0, 5.0, 20.0], deltas=[0.04, 0.08, 0.12, 0.2],
        half_lives=[999.0, 40.0, 20.0, 10.0],
    )
    _, qualifying_baseline = regression_model(qualifying, QUALIFY_FEATURES, "qualifying_pct", alpha=3.0)
    qualifying_model, qualifying_metrics = temporal_kernel_model(
        qualifying, QUALIFY_FEATURES, "qualifying_pct",
        dimensions=[0, 32, 64], gammas=[0.25, 0.5, 1.0],
        alphas=[0.05, 0.2, 1.0, 5.0, 20.0], deltas=[0.04, 0.08, 0.12, 0.2],
        half_lives=[999.0, 40.0, 20.0, 10.0],
    )
    pace_metrics.update({
        "ridge_baseline_mae": pace_baseline["mae"],
        "mae_improvement_vs_ridge": 1 - pace_metrics["mae"] / pace_baseline["mae"],
        "conditional_on_classified_finish": True,
        "excluded_dnf_rows": len(pace) - len(pace_survivors),
    })
    qualifying_metrics.update({
        "ridge_baseline_mae": qualifying_baseline["mae"],
        "mae_improvement_vs_ridge": 1 - qualifying_metrics["mae"] / qualifying_baseline["mae"],
    })
    pace_loco_mae, pace_loco_circuits = leave_one_circuit_out_kernel_mae(
        pace_survivors, PACE_FEATURES, "finish_pct", pace_model,
    )
    qualifying_loco_mae, qualifying_loco_circuits = leave_one_circuit_out_kernel_mae(
        qualifying, QUALIFY_FEATURES, "qualifying_pct", qualifying_model,
    )
    pace_metrics.update({"track_holdout_mae": pace_loco_mae, "track_holdout_circuits": pace_loco_circuits})
    qualifying_metrics.update({"track_holdout_mae": qualifying_loco_mae, "track_holdout_circuits": qualifying_loco_circuits})
    _, tyre_baseline = regression_model(tyre, TYRE_FEATURES, "pace_residual", alpha=8.0)
    tyre_model, tyre_metrics = temporal_kernel_model(
        tyre, TYRE_FEATURES, "pace_residual",
        dimensions=[0], gammas=[0.0], alphas=[10.0, 50.0, 100.0, 200.0, 500.0],
        deltas=[0.2, 0.4, 0.6, 1.0, 2.0], half_lives=[999.0, 40.0, 20.0, 10.0],
    )
    tyre_metrics.update({
        "ridge_baseline_mae": tyre_baseline["mae"],
        "mae_improvement_vs_ridge": 1 - tyre_metrics["mae"] / tyre_baseline["mae"],
    })
    pit_model, pit_metrics = logistic_model(pit, PIT_FEATURES, "pit_next")
    start_model, start_metrics = softmax_model(start[start["compound"].isin(COMPOUNDS)], START_FEATURES, "compound", COMPOUNDS)
    next_compound_model, next_compound_metrics = softmax_model(next_compound[next_compound["compound"].isin(COMPOUNDS)], PIT_FEATURES, "compound", COMPOUNDS)
    incident_model, incident_metrics = logistic_model(pace, PACE_FEATURES, "dnf", balanced=False)
    overtake_model, overtake_metrics = regression_model(circuits, OVERTAKE_FEATURES, "overtakes_per_lap", alpha=2.0)
    driver_priors, team_priors = make_priors(stats, circuits)
    pipeline_digest = hashlib.sha256(
        (ROOT / "features.py").read_bytes() + (ROOT / "train.py").read_bytes() + (ROOT / "requirements.txt").read_bytes()
    ).hexdigest()
    training_hash = hashlib.sha256((
        manifest["source_sha256"] + pipeline_digest
        + json.dumps({"seed": SEED, "features": manifest["features"]}, sort_keys=True)
    ).encode()).hexdigest()
    artifact = rounded({
        "schema_version": 2,
        "model_version": f"APEX-ML-{training_hash[:10]}",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "seed": SEED,
        "method": {
            "name": "APEX Temporal Robust Equilibrium Kernel",
            "short_name": "T-REK",
            "feature_map": "[standardized context; deterministic random Fourier features]",
            "objective": "time-weighted Huber loss plus L2 regularization",
            "recency_weight": "2^(-session_age / selected_half_life)",
            "outcome_decomposition": "classified finishing order plus independent DNF hazard",
            "selection": "nested chronological validation with untouched newest-session test",
        },
        "data": {
            "source": "OpenF1", "source_url": "https://api.openf1.org/v1", "seasons": [2023, 2024, 2025, 2026],
            "pipeline_sha256": pipeline_digest,
            **{key: manifest[key] for key in ["source_sha256", "source_as_of", "races", "pace_rows", "qualifying_rows", "tyre_rows", "pit_rows", "start_rows", "next_compound_rows", "driver_session_rows"]},
        },
        "evaluation": {
            "pace": pace_metrics, "qualifying": qualifying_metrics, "tyre": tyre_metrics,
            "pit": pit_metrics, "starting_compound": start_metrics,
            "next_compound": next_compound_metrics, "incident": incident_metrics,
            "overtake_rate": overtake_metrics,
        },
        "models": {
            "pace": pace_model, "qualifying": qualifying_model, "tyre": tyre_model,
            "pit_hazard": pit_model, "starting_compound": start_model,
            "next_compound": next_compound_model, "incident": incident_model,
            "overtake_rate": overtake_model,
        },
        "driver_priors": driver_priors, "team_priors": team_priors,
        "limitations": [
            "Public timing data do not expose setup, fuel mass, tyre temperature, aero maps, or energy deployment.",
            "Track timing and speed signatures proxy geometry in the historical tabular models; fictional geometry is supplied by the local geometry engine.",
            "T-REK is a project-specific synthesis of established robust regression, random-feature kernel approximation, time decay, and competing-risk decomposition; it is not claimed as a new general theorem.",
            "The overtake-rate regressor has low positive holdout R2, so runtime inference still shrinks it toward the empirical mean.",
            "The incident model is useful for probability calibration but not threshold classification; runtime blends it with explicit reliability and driving-risk hazards.",
            "Predictions are calibrated counterfactuals, not official Formula 1 or team forecasts.",
        ],
    })
    ARTIFACT.write_text(json.dumps(artifact, indent=2) + "\n")
    card = f"""# APEX ML model card

- Model version: `{artifact['model_version']}`
- Trained: {artifact['trained_at']}
- Source: OpenF1 historical API, seasons 2023-2026
- Races: {manifest['races']}
- Pace rows: {manifest['pace_rows']}
- Qualifying rows: {manifest['qualifying_rows']}
- Tyre laps: {manifest['tyre_rows']}
- Pit-decision rows: {manifest['pit_rows']}
- Starting-compound rows: {manifest['start_rows']}
- Next-compound rows: {manifest['next_compound_rows']}
- Source SHA-256: `{manifest['source_sha256']}`
- Pipeline SHA-256: `{pipeline_digest}`

## Mathematical foundation — T-REK

APEX T-REK is the project-specific **Temporal Robust Equilibrium Kernel**. For standardized context `x`, it forms an explicit nonlinear map `phi(x) = [x; sqrt(2/D) cos(Wx + b)]`, weights observation `i` by `2^(-session_age_i / h)`, and minimizes `sum_i weight_i * Huber_delta(y_i - beta·phi(x_i)) + alpha * ||beta||²`. `D`, kernel scale, `h`, `delta`, and `alpha` are chosen only on an inner time split. Race order is modeled conditional on a classified finish while a separate calibrated hazard owns DNF risk, preventing reliability from being counted twice.

This is a unique synthesis for this simulator, built from auditable established methods rather than a claim of a new universal theorem. Every projection, phase, coefficient, scaler, and selected hyperparameter is exported for identical TypeScript inference.

## Holdout evaluation

All component metrics use the newest sessions as a chronological holdout. Kernel, robustness, recency, regularization, and class-weight settings are selected on a separate inner chronological validation split; newest-session test rows do not participate in fitting or selection. Race-performance and qualifying models also use leave-one-circuit-out evaluation.

| Model | Metric | Result |
|---|---:|---:|
| Classified-finish pace | MAE | {pace_metrics['mae']:.4f} finish percentile |
| Race performance | R2 | {pace_metrics['r2']:.4f} |
| Race performance | Improvement vs same-feature ridge | {pace_metrics['mae_improvement_vs_ridge'] * 100:.1f}% |
| Race performance | Selected spectral dimensions | {pace_metrics['selected_dimensions']} |
| Race performance | Leave-one-circuit-out MAE | {pace_metrics['track_holdout_mae']:.4f} |
| Qualifying percentile | MAE | {qualifying_metrics['mae']:.4f} |
| Qualifying percentile | Improvement vs same-feature ridge | {qualifying_metrics['mae_improvement_vs_ridge'] * 100:.1f}% |
| Qualifying percentile | Selected spectral dimensions | {qualifying_metrics['selected_dimensions']} |
| Qualifying percentile | Leave-one-circuit-out MAE | {qualifying_metrics['track_holdout_mae']:.4f} |
| Tyre degradation | MAE | {tyre_metrics['mae']:.4f} seconds |
| Tyre degradation | R2 | {tyre_metrics['r2']:.4f} |
| Tyre degradation | Improvement vs same-feature ridge | {tyre_metrics['mae_improvement_vs_ridge'] * 100:.1f}% |
| Pit hazard | Log loss | {pit_metrics['log_loss']:.4f} |
| Pit hazard | Accuracy | {pit_metrics['accuracy']:.4f} |
| Starting compound | Accuracy | {start_metrics['accuracy']:.4f} |
| Starting compound | Log loss | {start_metrics['log_loss']:.4f} |
| Next compound | Accuracy | {next_compound_metrics['accuracy']:.4f} |
| Next compound | Log loss | {next_compound_metrics['log_loss']:.4f} |
| Incident / DNF | Log loss | {incident_metrics['log_loss']:.4f} |
| Overtakes per lap | MAE | {overtake_metrics['mae']:.4f} |
| Overtakes per lap | R2 | {overtake_metrics['r2']:.4f} |

## Runtime use

The TypeScript runtime imports `src/data/trained-model.json`, blends learned driver/team priors with current-season identity, and executes the exported coefficients directly for qualifying, race performance, tyres, pit hazard, starting and next compounds, incident probability, and overtaking environment. Weak holdout components are blended conservatively with the structured simulator priors rather than trusted blindly.

## Limitations

""" + "\n".join(f"- {item}" for item in artifact["limitations"]) + "\n"
    MODEL_CARD.write_text(card)
    return artifact


if __name__ == "__main__":
    result = train()
    print(json.dumps({"model_version": result["model_version"], "data": result["data"], "evaluation": result["evaluation"]}, indent=2))
