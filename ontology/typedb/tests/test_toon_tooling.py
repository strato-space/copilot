from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HELPER_PATH = ROOT / "scripts" / "typedb_ontology_toon.py"

spec = importlib.util.spec_from_file_location("typedb_ontology_toon_test_module", HELPER_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load module from {HELPER_PATH}")
tool = importlib.util.module_from_spec(spec)
sys.modules["typedb_ontology_toon_test_module"] = tool
spec.loader.exec_module(tool)


class ToonToolingTest(unittest.TestCase):
    def test_parse_legacy_tql_fragment_extracts_attribute_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "10-attributes-and-ids.tql"
            path.write_text(
                '# @toon inventory=inspect domain=dictionary max_values=50\n'
                'attribute status, value string;\n',
                encoding="utf-8",
            )
            payload = tool.parse_legacy_tql_fragment(path)
            self.assertEqual(payload["cards"][0]["id"], "status")
            self.assertEqual(payload["cards"][0]["target"], "attribute")
            self.assertEqual(payload["cards"][0]["inventory"]["domain"], "dictionary")

    def test_validate_toon_fragment_requires_cards_and_tql(self) -> None:
        payload = {"version": 1, "layer": "20-to-be", "fragment": "x", "cards": [{"id": "a", "target": "entity"}]}
        errors = tool.validate_toon_fragment(payload, Path("dummy.toon.yaml"))
        self.assertTrue(any("missing 'tql'" in error or "missing 'tql'" in error.lower() or "missing" in error for error in errors))

    def test_build_yaml_aggregate_preserves_sections(self) -> None:
        text = tool.build_yaml_aggregate(
            [
                {"name": "kernel", "fragments": [{"version": 1, "layer": "00-kernel", "fragment": "x", "cards": []}]},
                {"name": "to_be", "fragments": [{"version": 1, "layer": "20-to-be", "fragment": "y", "cards": []}]},
            ]
        )
        self.assertIn("sections:", text)
        self.assertIn("name: kernel", text)
        self.assertIn("name: to_be", text)


if __name__ == "__main__":
    unittest.main()
