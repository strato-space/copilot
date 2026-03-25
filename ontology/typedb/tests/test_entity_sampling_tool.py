from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "typedb-ontology-entity-sampling.py"

spec = importlib.util.spec_from_file_location("typedb_entity_sampling_test_module", SCRIPT_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load module from {SCRIPT_PATH}")
tool = importlib.util.module_from_spec(spec)
sys.modules["typedb_entity_sampling_test_module"] = tool
spec.loader.exec_module(tool)


class EntitySamplingToolTest(unittest.TestCase):
    def test_select_toon_fields_mapped_includes_key_attrs_and_relation_sources(self) -> None:
        cfg = {
            "key": {"from": "_id"},
            "attributes": {"title": "name", "status": "task_status"},
            "relations": [
                {"owner_lookup": {"from": "project_id"}},
                {"owner_lookup": {"from": "performer_id"}},
            ],
        }
        fields = tool.select_toon_fields(cfg, "mapped")
        self.assertEqual(fields, ["_id", "name", "task_status", "project_id", "performer_id"])

    def test_select_toon_fields_minimal_prefers_stable_llm_projection(self) -> None:
        cfg = {"key": {"from": "_id"}, "attributes": {"foo": "bar"}, "relations": []}
        fields = tool.select_toon_fields(cfg, "minimal")
        self.assertEqual(fields[:4], ["_id", "name", "title", "description"])

    def test_trim_doc_all_mode_keeps_full_document(self) -> None:
        doc = {"_id": "1", "name": "Alice", "extra": 7}
        self.assertEqual(tool.trim_doc(doc, []), doc)

    def test_trim_doc_mapped_mode_keeps_requested_fields_only(self) -> None:
        doc = {"_id": "1", "name": "Alice", "extra": 7}
        self.assertEqual(tool.trim_doc(doc, ["_id", "name"]), {"_id": "1", "name": "Alice"})

    def test_trim_doc_normalizes_priority_fields_to_canonical_text(self) -> None:
        flame = chr(0x1F525)
        doc = {"_id": "1", "priority": f"{flame} P2", "nested": {"priority": f"{flame} P4"}}
        self.assertEqual(
            tool.trim_doc(doc, []),
            {"_id": "1", "priority": "P2", "nested": {"priority": "P4"}},
        )


if __name__ == "__main__":
    unittest.main()
