import json
import sys
import unittest
from pathlib import Path

import pandas as pd

ML_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ML_ROOT.parent
sys.path.insert(0, str(ML_ROOT))

from train import chronological_split  # noqa: E402


class ArtifactContractTests(unittest.TestCase):
    def test_chronological_split_never_leaks_future_sessions(self):
        frame = pd.DataFrame({
            "session_date": [f"2025-01-{day:02d}" for day in range(1, 11)],
            "value": list(range(10)),
        })
        train, test = chronological_split(frame)
        self.assertLess(max(train["session_date"]), min(test["session_date"]))

    def test_runtime_artifact_has_provenance_models_and_holdouts(self):
        artifact = json.loads((PROJECT_ROOT / "src" / "data" / "trained-model.json").read_text())
        self.assertEqual(artifact["data"]["source"], "OpenF1")
        self.assertGreaterEqual(artifact["data"]["races"], 50)
        self.assertRegex(artifact["data"]["source_sha256"], r"^[a-f0-9]{64}$")
        self.assertTrue({
            "pace", "qualifying", "tyre", "pit_hazard", "starting_compound",
            "next_compound", "incident", "overtake_rate",
        }.issubset(artifact["models"]))
        self.assertEqual(artifact["method"]["short_name"], "T-REK")
        self.assertEqual(artifact["models"]["pace"]["type"], "temporal_huber_kernel")
        self.assertEqual(artifact["models"]["qualifying"]["type"], "temporal_huber_kernel")
        self.assertEqual(artifact["models"]["tyre"]["type"], "temporal_huber_kernel")
        self.assertTrue(artifact["evaluation"]["pace"]["conditional_on_classified_finish"])
        for component in ["pace", "qualifying", "tyre"]:
            metrics = artifact["evaluation"][component]
            self.assertLess(metrics["mae"], metrics["ridge_baseline_mae"])
            self.assertGreater(metrics["mae_improvement_vs_ridge"], 0)
        for metrics in artifact["evaluation"].values():
            self.assertGreater(metrics["test_rows"], 0)


if __name__ == "__main__":
    unittest.main()
