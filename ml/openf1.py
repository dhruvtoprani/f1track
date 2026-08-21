"""Download and cache reproducible OpenF1 training data."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import certifi

API_BASE = "https://api.openf1.org/v1"
ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
USER_AGENT = "ApexRaceForecastLab/1.0 research-pipeline"
MIN_REQUEST_INTERVAL = float(os.environ.get("OPENF1_MIN_INTERVAL", "0.45"))
_rate_lock = threading.Lock()
_next_request_at = 0.0


@dataclass(frozen=True)
class RaceBundle:
    year: int
    meeting_key: int
    race_session_key: int
    qualifying_session_key: int | None
    circuit_key: int
    circuit_name: str
    date_start: str


def _context() -> ssl.SSLContext:
    return ssl.create_default_context(cafile=certifi.where())


def _wait_for_request_slot() -> None:
    """Apply one process-wide rate limit across all download workers."""
    global _next_request_at
    with _rate_lock:
        now = time.monotonic()
        delay = max(0.0, _next_request_at - now)
        _next_request_at = max(now, _next_request_at) + MIN_REQUEST_INTERVAL
    if delay:
        time.sleep(delay)


def fetch_json(endpoint: str, params: dict[str, Any] | list[tuple[str, Any]], cache_path: Path, force: bool = False) -> Any:
    if cache_path.exists() and not force:
        return json.loads(cache_path.read_text())
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    query = urlencode(params)
    url = f"{API_BASE}/{endpoint}{'?' + query if query else ''}"
    last_error: Exception | None = None
    for attempt in range(8):
        try:
            _wait_for_request_slot()
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(request, timeout=60, context=_context()) as response:
                payload = json.loads(response.read().decode("utf-8"))
            cache_path.write_text(json.dumps(payload, separators=(",", ":")))
            return payload
        except HTTPError as error:
            last_error = error
            if error.code == 404:
                # OpenF1 returns 404 (rather than an empty list) for a handful of
                # unavailable early-session endpoint combinations.
                cache_path.write_text("[]")
                return []
            retry_after = error.headers.get("Retry-After")
            if error.code == 429:
                time.sleep(float(retry_after) if retry_after else min(45.0, 4.0 * (attempt + 1)))
            else:
                time.sleep(min(20.0, 1.5 * (attempt + 1)))
        except Exception as error:  # network retry boundary
            last_error = error
            time.sleep(min(20.0, 1.5 * (attempt + 1)))
    raise RuntimeError(f"OpenF1 request failed after retries: {url}: {last_error}")


def discover_bundles(years: list[int], force: bool = False, as_of: datetime | None = None) -> list[RaceBundle]:
    cutoff = as_of or datetime.now(timezone.utc)
    bundles: list[RaceBundle] = []
    for year in years:
        sessions = fetch_json("sessions", {"year": year}, RAW / f"sessions-{year}.json", force)
        by_meeting: dict[int, list[dict[str, Any]]] = {}
        for session in sessions:
            by_meeting.setdefault(int(session["meeting_key"]), []).append(session)
        for meeting_key, items in by_meeting.items():
            races = [item for item in items if item.get("session_name") == "Race" and not item.get("is_cancelled")]
            if not races:
                continue
            race = races[0]
            race_start = datetime.fromisoformat(str(race.get("date_start", "")).replace("Z", "+00:00"))
            if race_start > cutoff:
                continue
            qualifying = [item for item in items if item.get("session_name") == "Qualifying" and not item.get("is_cancelled")]
            bundles.append(RaceBundle(
                year=year,
                meeting_key=meeting_key,
                race_session_key=int(race["session_key"]),
                qualifying_session_key=int(qualifying[0]["session_key"]) if qualifying else None,
                circuit_key=int(race.get("circuit_key", -1)),
                circuit_name=str(race.get("circuit_short_name", race.get("location", "Unknown"))),
                date_start=race_start.isoformat(),
            ))
    return sorted(bundles, key=lambda bundle: bundle.date_start)


def download_bundle(bundle: RaceBundle, force: bool = False) -> dict[str, Any]:
    folder = RAW / str(bundle.year) / str(bundle.race_session_key)
    metadata = {
        "year": bundle.year,
        "meeting_key": bundle.meeting_key,
        "race_session_key": bundle.race_session_key,
        "qualifying_session_key": bundle.qualifying_session_key,
        "circuit_key": bundle.circuit_key,
        "circuit_name": bundle.circuit_name,
        "date_start": bundle.date_start,
    }
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "metadata.json").write_text(json.dumps(metadata, indent=2))
    endpoints = ["session_result", "drivers", "laps", "stints", "pit", "weather", "overtakes"]
    counts: dict[str, int] = {}
    for endpoint in endpoints:
        data = fetch_json(endpoint, {"session_key": bundle.race_session_key}, folder / f"{endpoint}.json", force)
        counts[endpoint] = len(data) if isinstance(data, list) else 0
    if bundle.qualifying_session_key:
        data = fetch_json("session_result", {"session_key": bundle.qualifying_session_key}, folder / "qualifying_result.json", force)
        counts["qualifying_result"] = len(data) if isinstance(data, list) else 0
    return {**metadata, "counts": counts}


def bundle_folder(bundle: RaceBundle) -> Path:
    return RAW / str(bundle.year) / str(bundle.race_session_key)


def write_bundle_metadata(bundle: RaceBundle) -> None:
    folder = bundle_folder(bundle)
    folder.mkdir(parents=True, exist_ok=True)
    metadata = {
        "year": bundle.year, "meeting_key": bundle.meeting_key,
        "race_session_key": bundle.race_session_key,
        "qualifying_session_key": bundle.qualifying_session_key,
        "circuit_key": bundle.circuit_key, "circuit_name": bundle.circuit_name,
        "date_start": bundle.date_start,
    }
    (folder / "metadata.json").write_text(json.dumps(metadata, indent=2))


def batched(values: list[RaceBundle], size: int) -> list[list[RaceBundle]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def download_endpoint_batches(
    endpoint: str,
    filename: str,
    bundles: list[RaceBundle],
    session_key: str,
    force: bool,
    batch_size: int,
) -> None:
    selected = [
        bundle for bundle in bundles
        if getattr(bundle, session_key) is not None
        and (force or not (bundle_folder(bundle) / filename).exists())
    ]
    for index, group in enumerate(batched(selected, batch_size), start=1):
        keys = [int(getattr(bundle, session_key)) for bundle in group]
        signature = hashlib.sha256(f"{endpoint}:{','.join(map(str, keys))}".encode()).hexdigest()[:16]
        batch_path = RAW / "_batches" / f"{endpoint}-{signature}.json"
        payload = fetch_json(endpoint, [("session_key", key) for key in keys], batch_path, force)
        by_session: dict[int, list[dict[str, Any]]] = {key: [] for key in keys}
        if isinstance(payload, list):
            for record in payload:
                key = record.get("session_key")
                if key is not None and int(key) in by_session:
                    by_session[int(key)].append(record)
        for bundle in group:
            key = int(getattr(bundle, session_key))
            (bundle_folder(bundle) / filename).write_text(json.dumps(by_session[key], separators=(",", ":")))
        print(f"{endpoint}: batch {index}/{len(batched(selected, batch_size))} ({len(group)} sessions)", flush=True)


def source_digest(files: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(path.relative_to(RAW).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def run(years: list[int], workers: int = 4, force: bool = False, max_races: int | None = None) -> dict[str, Any]:
    RAW.mkdir(parents=True, exist_ok=True)
    as_of = datetime.now(timezone.utc)
    bundles = discover_bundles(years, force, as_of)
    if max_races:
        bundles = bundles[-max_races:]
    for bundle in bundles:
        write_bundle_metadata(bundle)
    endpoints = ["session_result", "drivers", "laps", "stints", "pit", "weather", "overtakes"]
    for endpoint in endpoints:
        download_endpoint_batches(
            endpoint, f"{endpoint}.json", bundles, "race_session_key", force,
            batch_size=4 if endpoint == "laps" else 10,
        )
    qualifying_bundles = [bundle for bundle in bundles if bundle.qualifying_session_key is not None]
    download_endpoint_batches(
        "session_result", "qualifying_result.json", qualifying_bundles,
        "qualifying_session_key", force, batch_size=10,
    )
    completed: list[dict[str, Any]] = []
    for bundle in bundles:
        folder = bundle_folder(bundle)
        counts = {
            endpoint: len(json.loads((folder / f"{endpoint}.json").read_text()))
            for endpoint in endpoints
        }
        if bundle.qualifying_session_key is not None:
            counts["qualifying_result"] = len(json.loads((folder / "qualifying_result.json").read_text()))
        completed.append({
            "year": bundle.year, "meeting_key": bundle.meeting_key,
            "race_session_key": bundle.race_session_key,
            "qualifying_session_key": bundle.qualifying_session_key,
            "circuit_key": bundle.circuit_key, "circuit_name": bundle.circuit_name,
            "date_start": bundle.date_start, "counts": counts,
        })
    files = [RAW / f"sessions-{year}.json" for year in years if (RAW / f"sessions-{year}.json").exists()]
    for item in completed:
        folder = RAW / str(item["year"]) / str(item["race_session_key"])
        files.extend(path for path in folder.glob("*.json") if path.name != "race_control.json")
    manifest = {
        "source": "OpenF1",
        "api_base": API_BASE,
        "as_of": as_of.isoformat(),
        "years": years,
        "race_count": len(completed),
        "races": sorted(completed, key=lambda item: item["date_start"]),
        "source_sha256": source_digest(files),
    }
    (RAW / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", nargs="+", type=int, default=[2023, 2024, 2025, 2026])
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--max-races", type=int)
    args = parser.parse_args()
    result = run(args.years, args.workers, args.force, args.max_races)
    print(json.dumps({"race_count": result["race_count"], "source_sha256": result["source_sha256"]}, indent=2))
