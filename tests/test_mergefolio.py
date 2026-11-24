"""Deterministic state and source-shape tests using an explicit offline adapter."""
import json
from pathlib import Path
import runpy
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


class MergefolioTests(unittest.TestCase):
    def setUp(self):
        sdk = ModuleType("genlayer")
        sdk.u256 = int
        sdk.TreeMap = dict
        self.status = 200
        self.disagree = False
        self.source = {
            "id": 40, "number": 1, "state": "closed", "merged": True,
            "user": {"id": 11, "login": "Author"},
            "merged_by": {"id": 99}, "merged_at": "2026-11-24T00:00:00Z",
            "base": {"repo": {"id": 3, "full_name": "org/library", "owner": {"id": 12}}},
        }
        sdk.gl = SimpleNamespace(
            Contract=object, UserError=ValueError,
            public=SimpleNamespace(view=lambda f: f, write=lambda f: f),
            message=SimpleNamespace(sender_address="test-wallet"),
            eq_principle=SimpleNamespace(strict_eq=self.consensus),
            nondet=SimpleNamespace(web=SimpleNamespace(get=self.fetch)),
        )
        with patch.dict(sys.modules, {"genlayer": sdk}):
            module = runpy.run_path(str(Path(__file__).parents[1] / "contracts/mergefolio.py"))
        self.app = module["Mergefolio"]()
        for field in ("records", "latest", "profiles", "credited_owners", "profile_records"):
            setattr(self.app, field, {})

    def fetch(self, url):
        self.assertTrue(url.startswith("https://api.github.com/repos/"))
        return SimpleNamespace(status=self.status, body=json.dumps(self.source))

    def consensus(self, callback):
        leader = callback()
        verifier = callback()
        if self.disagree or leader != verifier:
            raise ValueError("Disagreement")
        return leader

    def test_attribution_owner_breadth_and_alias_deduplication(self):
        self.app.nominate("org", "library", 1)
        self.assertEqual(json.loads(self.app.get_record(1))["nominator"], "test-wallet")
        self.assertEqual(json.loads(self.app.get_profile(11)), {
            "proofs": 1, "owners": 1, "author": "author", "level": "MERGE_VERIFIED",
        })
        with self.assertRaisesRegex(ValueError, "already recorded"):
            self.app.nominate("org", "renamed-library", 1)
        self.source["id"] = 41
        self.app.nominate("org", "library", 1)
        self.assertEqual(json.loads(self.app.get_profile(11))["owners"], 1)
        self.source["id"] = 42
        self.source["base"]["repo"]["owner"]["id"] = 13
        self.app.nominate("another", "library", 1)
        self.assertEqual(json.loads(self.app.get_profile(11))["level"], "MULTI_OWNER")
        self.assertEqual(self.app.get_profile_record(11, 3), 3)

    def test_self_merge_open_then_merged(self):
        self.source["merged_by"]["id"] = 11
        self.app.nominate("org", "library", 1)
        self.assertEqual(json.loads(self.app.get_record(1))["result"], "SELF_MERGE")
        self.assertEqual(self.app.get_profile(11), "")
        self.source.update(id=43, state="open", merged=False)
        self.app.nominate("org", "library", 1)
        self.assertEqual(json.loads(self.app.get_record(2))["result"], "OPEN")
        self.source.update(state="closed", merged=True, merged_by={"id": 99})
        self.app.nominate("org", "library", 1)
        self.assertEqual(self.app.get_profile_record(11, 1), 3)

    def test_api_failure_missing_data_and_disagreement_leave_empty_state(self):
        self.status = 503
        with self.assertRaisesRegex(ValueError, "unavailable"):
            self.app.nominate("org", "library", 1)
        self.status = 200
        self.disagree = True
        with self.assertRaisesRegex(ValueError, "Disagreement"):
            self.app.nominate("org", "library", 1)
        self.disagree = False
        self.source["user"]["id"] = 0
        with self.assertRaisesRegex(ValueError, "invalid attribution"):
            self.app.nominate("org", "library", 1)
        with self.assertRaisesRegex(ValueError, "public GitHub"):
            self.app.nominate("org/other", "library", 1)
        self.assertEqual(self.app.record_count(), 0)
        self.assertEqual(self.app.get_profile(11), "")


if __name__ == "__main__":
    unittest.main()
