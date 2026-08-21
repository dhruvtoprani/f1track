"""One-command data ingestion, feature generation, training, and evaluation."""

from __future__ import annotations

import argparse
import json

from features import build
from openf1 import run
from train import train


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", nargs="+", type=int, default=[2023, 2024, 2025, 2026])
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--max-races", type=int)
    args = parser.parse_args()
    source = run(args.years, args.workers, args.force, args.max_races)
    processed = build()
    artifact = train()
    print(json.dumps({
        "downloaded_races": source["race_count"], "processed": processed,
        "model_version": artifact["model_version"], "evaluation": artifact["evaluation"],
    }, indent=2))
