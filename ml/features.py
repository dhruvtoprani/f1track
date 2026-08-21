"""Build leakage-aware historical training tables from cached OpenF1 data."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

PACE_FEATURES = [
    "grid_pct", "driver_form", "team_form", "track_lap_norm", "speed_norm",
    "track_temp_norm", "rainfall", "race_laps_norm",
]
QUALIFY_FEATURES = [
    "driver_form", "team_form", "driver_quali_form", "team_quali_form",
    "driver_quali_recent", "team_quali_recent", "driver_quali_trend", "team_quali_trend",
    "driver_experience", "team_experience", "track_lap_norm", "speed_norm",
    "track_temp_norm", "rainfall", "race_laps_norm", "driver_team", "form_gap",
    "quali_team", "quali_gap", "rain_driver", "rain_quali",
]
TYRE_FEATURES = [
    "age_norm", "age_sq", "race_progress", "soft", "medium", "hard",
    "intermediate", "wet", "track_temp_norm", "rainfall", "speed_norm", "track_lap_norm",
    "progress_sq", "age_temp", "age_rain",
]
PIT_FEATURES = [
    "age_norm", "race_progress", "soft", "medium", "hard", "intermediate", "wet",
    "track_temp_norm", "rainfall", "speed_norm", "track_lap_norm", "grid_pct",
]
START_FEATURES = [
    "grid_pct", "driver_form", "team_form", "track_lap_norm", "speed_norm",
    "track_temp_norm", "rainfall", "race_laps_norm",
]
OVERTAKE_FEATURES = [
    "track_lap_norm", "speed_norm", "track_temp_norm", "rainfall", "race_laps_norm",
]
COMPOUNDS = ["S", "M", "H", "I", "W"]


def load(path: Path) -> Any:
    if not path.exists():
        return []
    return json.loads(path.read_text())


def number(value: Any, default: float = np.nan) -> float:
    try:
        result = float(value)
        return result if np.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def normalize_team(name: str) -> str:
    aliases = {
        "McLaren": "McLaren", "Mercedes": "Mercedes", "Ferrari": "Ferrari",
        "Red Bull Racing": "Red Bull Racing", "Alpine": "Alpine", "Williams": "Williams",
        "Haas F1 Team": "Haas F1 Team", "Haas": "Haas F1 Team",
        "Aston Martin": "Aston Martin", "Racing Bulls": "Racing Bulls", "RB": "Racing Bulls",
        "AlphaTauri": "Racing Bulls", "Kick Sauber": "Audi", "Sauber": "Audi", "Audi": "Audi",
        "Cadillac": "Cadillac",
    }
    return aliases.get(name, name)


def compound_code(value: Any) -> str | None:
    text = str(value or "").upper()
    mapping = {"SOFT": "S", "MEDIUM": "M", "HARD": "H", "INTERMEDIATE": "I", "WET": "W"}
    return mapping.get(text)


def compound_features(compound: str) -> dict[str, float]:
    return {
        "soft": float(compound == "S"), "medium": float(compound == "M"),
        "hard": float(compound == "H"), "intermediate": float(compound == "I"),
        "wet": float(compound == "W"),
    }


def mean_or(values: list[float], default: float) -> float:
    clean = [value for value in values if np.isfinite(value)]
    return float(np.mean(clean)) if clean else default


def recent_mean(values: list[float], horizon: int, default: float = 0.5) -> float:
    """Leakage-safe rolling mean using observations available before this race."""
    return mean_or(values[-horizon:], default)


def form_trend(values: list[float], recent_horizon: int, long_horizon: int) -> float:
    if not values:
        return 0.0
    return recent_mean(values, recent_horizon) - recent_mean(values, long_horizon)


def build() -> dict[str, Any]:
    manifest = load(RAW / "manifest.json")
    if not manifest:
        raise RuntimeError("No raw manifest. Run python3 ml/openf1.py first.")
    PROCESSED.mkdir(parents=True, exist_ok=True)
    bundles = sorted(manifest["races"], key=lambda item: item["date_start"])
    driver_history: dict[str, list[float]] = defaultdict(list)
    team_history: dict[str, list[float]] = defaultdict(list)
    driver_quali_history: dict[str, list[float]] = defaultdict(list)
    team_quali_history: dict[str, list[float]] = defaultdict(list)
    driver_racecraft_history: dict[str, list[float]] = defaultdict(list)
    team_racecraft_history: dict[str, list[float]] = defaultdict(list)
    pace_rows: list[dict[str, Any]] = []
    qualify_rows: list[dict[str, Any]] = []
    tyre_rows: list[dict[str, Any]] = []
    pit_rows: list[dict[str, Any]] = []
    start_rows: list[dict[str, Any]] = []
    next_compound_rows: list[dict[str, Any]] = []
    stats_rows: list[dict[str, Any]] = []
    circuit_rows: list[dict[str, Any]] = []

    for bundle in bundles:
        folder = RAW / str(bundle["year"]) / str(bundle["race_session_key"])
        results = load(folder / "session_result.json")
        qualifying = load(folder / "qualifying_result.json")
        driver_records = load(folder / "drivers.json")
        laps = load(folder / "laps.json")
        stints = load(folder / "stints.json")
        pits = load(folder / "pit.json")
        weather = load(folder / "weather.json")
        overtakes = load(folder / "overtakes.json")
        if not results or not driver_records or not laps:
            continue
        identity: dict[int, dict[str, str]] = {}
        for record in driver_records:
            driver_number = int(record.get("driver_number", -1))
            identity[driver_number] = {
                "code": str(record.get("name_acronym") or driver_number),
                "name": str(record.get("full_name") or record.get("broadcast_name") or driver_number),
                "team": normalize_team(str(record.get("team_name") or "Unknown")),
            }
        result_by_driver = {int(row["driver_number"]): row for row in results if row.get("driver_number") is not None}
        quali_by_driver = {int(row["driver_number"]): row for row in qualifying if row.get("driver_number") is not None}
        race_laps = int(max([number(row.get("number_of_laps"), 0) for row in results] or [0]))
        field_size = max(1, len(result_by_driver))
        weather_df = pd.DataFrame(weather)
        track_temp = number(weather_df.get("track_temperature", pd.Series(dtype=float)).mean(), 32.0)
        rainfall = float(weather_df.get("rainfall", pd.Series(dtype=float)).fillna(0).astype(bool).mean()) if not weather_df.empty else 0.0

        lap_df = pd.DataFrame(laps)
        for column in ["driver_number", "lap_number", "lap_duration", "st_speed", "i1_speed", "i2_speed"]:
            if column in lap_df:
                lap_df[column] = pd.to_numeric(lap_df[column], errors="coerce")
        lap_df = lap_df[(lap_df["lap_duration"] > 55) & (lap_df["lap_duration"] < 220) & (~lap_df["is_pit_out_lap"].fillna(False).astype(bool))]
        if lap_df.empty:
            continue
        driver_pace = lap_df.groupby("driver_number")["lap_duration"].quantile(0.2).to_dict()
        session_fastest = float(min(driver_pace.values()))
        track_lap = float(np.median(list(driver_pace.values())))
        speed_columns = [column for column in ["st_speed", "i1_speed", "i2_speed"] if column in lap_df]
        speeds = pd.concat([lap_df[column] for column in speed_columns], ignore_index=True).dropna() if speed_columns else pd.Series(dtype=float)
        top_speed = float(speeds.quantile(0.8)) if not speeds.empty else 300.0
        overtake_rate = len(overtakes) / max(1, race_laps)
        circuit_rows.append({
            "session_date": bundle["date_start"], "year": bundle["year"], "session_key": bundle["race_session_key"],
            "circuit_key": bundle["circuit_key"], "circuit_name": bundle["circuit_name"],
            "track_lap": track_lap, "top_speed": top_speed, "track_temp": track_temp,
            "rainfall": rainfall, "race_laps": race_laps, "overtakes_per_lap": overtake_rate,
            "track_lap_norm": track_lap / 100.0, "speed_norm": top_speed / 320.0,
            "track_temp_norm": track_temp / 40.0, "race_laps_norm": race_laps / 70.0,
        })

        stint_by_driver: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for stint in stints:
            code = compound_code(stint.get("compound"))
            if code and stint.get("driver_number") is not None:
                enriched = dict(stint)
                enriched["compound_code"] = code
                stint_by_driver[int(stint["driver_number"])].append(enriched)
        pit_by_driver: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for pit in pits:
            if pit.get("driver_number") is not None:
                pit_by_driver[int(pit["driver_number"])].append(pit)

        history_updates: list[tuple[str, str, float, float, float]] = []
        for driver_number, result in result_by_driver.items():
            if driver_number not in identity:
                continue
            info = identity[driver_number]
            code, team = info["code"], info["team"]
            finish = int(number(result.get("position"), field_size))
            finish_pct = (finish - 1) / max(1, field_size - 1)
            quali_position = int(number(quali_by_driver.get(driver_number, {}).get("position"), finish))
            grid_pct = (quali_position - 1) / max(1, field_size - 1)
            prior_driver_form = recent_mean(driver_history[code], 8)
            prior_team_form = recent_mean(team_history[team], 16)
            driver_recent_form = recent_mean(driver_history[code], 3, prior_driver_form)
            team_recent_form = recent_mean(team_history[team], 6, prior_team_form)
            driver_quali_form = recent_mean(driver_quali_history[code], 8)
            team_quali_form = recent_mean(team_quali_history[team], 16)
            driver_quali_recent = recent_mean(driver_quali_history[code], 3, driver_quali_form)
            team_quali_recent = recent_mean(team_quali_history[team], 6, team_quali_form)
            driver_racecraft = recent_mean(driver_racecraft_history[code], 8, 0.0)
            team_racecraft = recent_mean(team_racecraft_history[team], 16, 0.0)
            driver_experience = min(1.0, len(driver_history[code]) / 20.0)
            team_experience = min(1.0, len(team_history[team]) / 40.0)
            base = {
                "session_date": bundle["date_start"], "year": bundle["year"], "session_key": bundle["race_session_key"],
                "circuit_name": bundle["circuit_name"], "driver_code": code, "driver_name": info["name"], "team_name": team,
                "grid_pct": grid_pct, "driver_form": prior_driver_form, "team_form": prior_team_form,
                "driver_recent_form": driver_recent_form, "team_recent_form": team_recent_form,
                "driver_quali_form": driver_quali_form, "team_quali_form": team_quali_form,
                "driver_quali_recent": driver_quali_recent, "team_quali_recent": team_quali_recent,
                "driver_quali_trend": form_trend(driver_quali_history[code], 3, 8),
                "team_quali_trend": form_trend(team_quali_history[team], 6, 16),
                "driver_racecraft": driver_racecraft, "team_racecraft": team_racecraft,
                "driver_experience": driver_experience, "team_experience": team_experience,
                "grid_driver_gap": grid_pct - prior_driver_form,
                "grid_team_gap": grid_pct - prior_team_form,
                "driver_team": prior_driver_form * prior_team_form,
                "form_gap": prior_driver_form - prior_team_form,
                "quali_team": driver_quali_form * team_quali_form,
                "quali_gap": driver_quali_form - team_quali_form,
                "rain_driver": rainfall * prior_driver_form,
                "rain_quali": rainfall * driver_quali_form,
                "track_lap_norm": track_lap / 100.0, "speed_norm": top_speed / 320.0,
                "track_temp_norm": track_temp / 40.0, "rainfall": rainfall, "race_laps_norm": race_laps / 70.0,
            }
            pace_rows.append({**base, "finish_pct": finish_pct, "dnf": int(bool(result.get("dnf")))})
            qualify_rows.append({**base, "qualifying_pct": grid_pct})
            ordered_stints = sorted(stint_by_driver.get(driver_number, []), key=lambda row: number(row.get("stint_number"), 99))
            if ordered_stints:
                start_rows.append({**base, "compound": ordered_stints[0]["compound_code"]})

            driver_laps = lap_df[lap_df["driver_number"] == driver_number].copy()
            p20 = number(driver_pace.get(driver_number), track_lap)
            pace_delta = (p20 / session_fastest - 1) * 100
            lap_cv = float(driver_laps["lap_duration"].std() / max(1, driver_laps["lap_duration"].mean())) if len(driver_laps) > 2 else 0.08
            tyre_slopes: list[float] = []
            driver_threshold = float(driver_laps["lap_duration"].quantile(0.72))
            for _, lap in driver_laps.iterrows():
                lap_number = int(lap["lap_number"])
                matching = next((stint for stint in stint_by_driver.get(driver_number, []) if number(stint.get("lap_start"), 999) <= lap_number <= number(stint.get("lap_end"), -1)), None)
                if not matching or lap["lap_duration"] > driver_threshold + 3:
                    continue
                age = max(0.0, lap_number - number(matching.get("lap_start"), lap_number) + number(matching.get("tyre_age_at_start"), 0))
                progress = lap_number / max(1, race_laps)
                residual = float(np.clip(lap["lap_duration"] - p20 - 3.5 * (1 - progress), -2.5, 8.0))
                compound = matching["compound_code"]
                tyre_rows.append({
                    "session_date": bundle["date_start"], "driver_code": code, "team_name": team,
                    "age_norm": age / 40.0, "age_sq": (age / 40.0) ** 2, "race_progress": progress,
                    "progress_sq": progress ** 2,
                    "age_temp": (age / 40.0) * (track_temp / 40.0),
                    "age_rain": (age / 40.0) * rainfall,
                    **compound_features(compound), "track_temp_norm": track_temp / 40.0, "rainfall": rainfall,
                    "speed_norm": top_speed / 320.0, "track_lap_norm": track_lap / 100.0, "pace_residual": residual,
                })
                if age > 2:
                    tyre_slopes.append(residual / age)

            for stint in stint_by_driver.get(driver_number, []):
                start_lap = int(number(stint.get("lap_start"), 1))
                end_lap = int(number(stint.get("lap_end"), start_lap))
                starting_age = number(stint.get("tyre_age_at_start"), 0)
                stint_length = max(1, end_lap - start_lap + 1)
                compound = stint["compound_code"]
                for fraction, label in [(0.25, 0), (0.55, 0), (1.0, int(end_lap < race_laps - 1))]:
                    sampled_lap = start_lap + int((stint_length - 1) * fraction)
                    age = starting_age + sampled_lap - start_lap
                    pit_rows.append({
                        "session_date": bundle["date_start"], "driver_code": code, "team_name": team,
                        "age_norm": age / 40.0, "race_progress": sampled_lap / max(1, race_laps),
                        **compound_features(compound), "track_temp_norm": track_temp / 40.0, "rainfall": rainfall,
                        "speed_norm": top_speed / 320.0, "track_lap_norm": track_lap / 100.0,
                        "grid_pct": grid_pct, "pit_next": label,
                    })

            for current_stint, following_stint in zip(ordered_stints, ordered_stints[1:]):
                end_lap = int(number(current_stint.get("lap_end"), 1))
                start_lap = int(number(current_stint.get("lap_start"), 1))
                age = number(current_stint.get("tyre_age_at_start"), 0) + max(0, end_lap - start_lap)
                next_compound_rows.append({
                    "session_date": bundle["date_start"], "driver_code": code, "team_name": team,
                    "age_norm": age / 40.0, "race_progress": end_lap / max(1, race_laps),
                    **compound_features(current_stint["compound_code"]),
                    "track_temp_norm": track_temp / 40.0, "rainfall": rainfall,
                    "speed_norm": top_speed / 320.0, "track_lap_norm": track_lap / 100.0,
                    "grid_pct": grid_pct, "compound": following_stint["compound_code"],
                })

            stop_durations = [number(pit.get("stop_duration")) for pit in pit_by_driver.get(driver_number, [])]
            stop_durations = [duration for duration in stop_durations if np.isfinite(duration) and 1.5 < duration < 20]
            stats_rows.append({
                "session_date": bundle["date_start"], "session_key": bundle["race_session_key"], "year": bundle["year"], "driver_code": code,
                "driver_name": info["name"], "team_name": team, "qualifying_pct": grid_pct,
                "finish_pct": finish_pct, "racecraft_delta": grid_pct - finish_pct, "pace_delta_pct": pace_delta,
                "lap_cv": lap_cv, "tyre_slope": mean_or(tyre_slopes, 0.05), "rainfall": rainfall,
                "dnf": int(bool(result.get("dnf"))), "pit_duration": mean_or(stop_durations, 2.8),
                "pit_count": len(pit_by_driver.get(driver_number, [])),
            })
            history_updates.append((code, team, finish_pct, grid_pct, grid_pct - finish_pct))

        # Update form only after the complete race has been featurized so the
        # second-listed team-mate cannot see the first-listed team-mate's result.
        for code, team, finish_pct, grid_pct, racecraft_delta in history_updates:
            driver_history[code].append(finish_pct)
            team_history[team].append(finish_pct)
            driver_quali_history[code].append(grid_pct)
            team_quali_history[team].append(grid_pct)
            driver_racecraft_history[code].append(racecraft_delta)
            team_racecraft_history[team].append(racecraft_delta)

    tables = {
        "pace": pd.DataFrame(pace_rows), "qualifying": pd.DataFrame(qualify_rows),
        "tyre": pd.DataFrame(tyre_rows), "pit": pd.DataFrame(pit_rows),
        "start": pd.DataFrame(start_rows), "next_compound": pd.DataFrame(next_compound_rows),
        "stats": pd.DataFrame(stats_rows), "circuits": pd.DataFrame(circuit_rows),
    }
    for name, table in tables.items():
        table.to_csv(PROCESSED / f"{name}.csv", index=False)
    processed_manifest = {
        "source_sha256": manifest["source_sha256"], "source_as_of": manifest["as_of"], "races": int(len(tables["circuits"])),
        "pace_rows": int(len(tables["pace"])), "tyre_rows": int(len(tables["tyre"])),
        "qualifying_rows": int(len(tables["qualifying"])), "pit_rows": int(len(tables["pit"])),
        "start_rows": int(len(tables["start"])), "next_compound_rows": int(len(tables["next_compound"])),
        "driver_session_rows": int(len(tables["stats"])),
        "features": {
            "pace": PACE_FEATURES, "qualifying": QUALIFY_FEATURES, "tyre": TYRE_FEATURES,
            "pit": PIT_FEATURES, "start": START_FEATURES, "next_compound": PIT_FEATURES,
            "incident": PACE_FEATURES, "overtake": OVERTAKE_FEATURES,
        },
    }
    (PROCESSED / "manifest.json").write_text(json.dumps(processed_manifest, indent=2))
    return processed_manifest


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
