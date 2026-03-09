from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOON_HELPER_PATH = ROOT / "scripts" / "typedb_ontology_toon.py"
VALIDATOR_PATH = ROOT / "scripts" / "typedb-ontology-toon-validate.py"


helper_spec = importlib.util.spec_from_file_location("typedb_ontology_toon_test_module", TOON_HELPER_PATH)
if helper_spec is None or helper_spec.loader is None:
    raise RuntimeError(f"Cannot load module from {TOON_HELPER_PATH}")
helper = importlib.util.module_from_spec(helper_spec)
sys.modules["typedb_ontology_toon_test_module"] = helper
helper_spec.loader.exec_module(helper)

validator_spec = importlib.util.spec_from_file_location("typedb_ontology_toon_validate_test_module", VALIDATOR_PATH)
if validator_spec is None or validator_spec.loader is None:
    raise RuntimeError(f"Cannot load module from {VALIDATOR_PATH}")
validator = importlib.util.module_from_spec(validator_spec)
sys.modules["typedb_ontology_toon_validate_test_module"] = validator
validator_spec.loader.exec_module(validator)


class ToonValidationTest(unittest.TestCase):
    def test_kernel_fragment_cards_are_normalized_with_causes(self) -> None:
        fragment = helper.load_toon_fragment(ROOT / "schema" / "fragments" / "00-kernel" / "10-attributes-and-ids.toon.yaml")
        first = fragment["cards"][0]
        self.assertIn("kind", first)
        self.assertIn("scope", first)
        self.assertIn("fpf_basis", first)
        self.assertIn("causes", first)
        self.assertIn("formal_what", first["causes"])

    def test_toon_validator_accepts_current_fragments(self) -> None:
        errors: list[str] = []
        for path in helper.find_toon_fragments():
            payload = helper.load_toon_fragment(path)
            errors.extend(helper.validate_toon_fragment(payload, path))
        self.assertEqual(errors, [])

    def test_finops_fragment_uses_block_scalar_tql(self) -> None:
        text = (ROOT / "schema" / "fragments" / "10-as-is" / "20-entities-finops.toon.yaml").read_text(encoding="utf-8")
        self.assertIn("tql: |-","".join([line if i==0 else line for i,line in enumerate(text.splitlines(True))]))
        self.assertNotIn('tql: "entity project_rate,', text)


if __name__ == "__main__":
    unittest.main()
