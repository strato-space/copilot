from __future__ import annotations

from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
MAPPING_PATH = ROOT / "mappings" / "mongodb_to_typedb_v1.yaml"
INGEST_PATH = ROOT / "scripts" / "typedb-ontology-ingest.py"
SCHEMA_PATH = ROOT / "schema" / "str-ontology.tql"


class TaskOnlyCutoverTest(unittest.TestCase):
    def test_mapping_includes_reasoning_and_visual_observation_contracts(self) -> None:
        mapping = yaml.safe_load(MAPPING_PATH.read_text(encoding="utf-8"))
        by_collection = {item["collection"]: item for item in mapping["collections"]}

        visual = by_collection["automation_visual_observations"]
        self.assertEqual(visual["target_entity"], "visual_observation")
        self.assertEqual(visual["key"]["attribute"], "evidence_observation_id")
        visual_relations = {rel["relation"] for rel in visual.get("relations", [])}
        self.assertIn("visual_observation_cites_evidence_link", visual_relations)
        self.assertIn("visual_observation_about_object_locator", visual_relations)
        visual_relation_lookup = {rel["relation"]: rel for rel in visual.get("relations", [])}
        self.assertEqual(visual_relation_lookup["visual_observation_cites_evidence_link"]["owner_lookup"]["by"], "evidence_link_id")
        self.assertEqual(visual_relation_lookup["visual_observation_cites_evidence_link"]["owner_lookup"]["from"], "evidence_link_id")

        reasoning = by_collection["automation_reasoning_items"]
        self.assertEqual(reasoning["target_entity"], "reasoning_item")
        self.assertEqual(reasoning["key"]["attribute"], "reasoning_item_id")
        self.assertEqual(reasoning["attributes"]["reasoning_kind"], "kind")

    def test_ingest_and_generated_schema_remove_target_task_view_surface(self) -> None:
        ingest = INGEST_PATH.read_text(encoding="utf-8")
        schema = SCHEMA_PATH.read_text(encoding="utf-8")

        self.assertNotIn("target_task_view", ingest)
        self.assertNotIn("as_is_task_maps_to_target_task_view", schema)
        self.assertNotIn("entity target_task_view,", schema)
        self.assertNotIn("owns visual_observation_id @key,", schema)
        self.assertNotIn("owns assumption_id @key,", schema)
        self.assertNotIn("owns open_question_id @key,", schema)
        self.assertIn("def ingest_reasoning_items", ingest)
        self.assertIn("def ingest_visual_observations", ingest)
        self.assertIn("relation task_classified_as_task_family,", schema)
        self.assertIn('owns reasoning_kind @values("assumption", "open_question", "unknown"),', schema)

    def test_incremental_sync_policy_includes_new_first_class_collections(self) -> None:
        ingest = INGEST_PATH.read_text(encoding="utf-8")
        self.assertIn('"automation_reasoning_items"', ingest)
        self.assertIn('"automation_visual_observations"', ingest)


if __name__ == "__main__":
    unittest.main()
