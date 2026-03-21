from __future__ import annotations

from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
MAPPING_PATH = ROOT / "mappings" / "mongodb_to_typedb_v1.yaml"
CORE_SCHEMA = ROOT / "schema" / "fragments" / "10-as-is" / "10-entities-core.tql"
FINOPS_SCHEMA = ROOT / "schema" / "fragments" / "10-as-is" / "20-entities-finops.tql"
REL_SCHEMA = ROOT / "schema" / "fragments" / "10-as-is" / "40-relations.tql"


class PersonPerformerSplitTest(unittest.TestCase):
    def test_mapping_splits_person_and_performer_profile(self) -> None:
        mapping = yaml.safe_load(MAPPING_PATH.read_text(encoding="utf-8"))
        by_collection = {item["collection"]: item for item in mapping["collections"]}

        self.assertEqual(by_collection["automation_performers"]["target_entity"], "performer_profile")
        self.assertEqual(by_collection["automation_performers"]["key"]["attribute"], "performer_profile_id")
        self.assertEqual(by_collection["automation_persons"]["target_entity"], "person")
        self.assertEqual(by_collection["automation_persons"]["key"]["attribute"], "person_id")

        person_relations = {rel["relation"]: rel for rel in by_collection["automation_persons"].get("relations", [])}
        self.assertIn("person_has_performer_profile", person_relations)
        self.assertEqual(person_relations["person_has_performer_profile"]["owner_lookup"]["entity"], "performer_profile")
        self.assertEqual(person_relations["person_has_performer_profile"]["owner_lookup"]["by"], "performer_profile_id")

        task_relations = {rel["relation"]: rel for rel in by_collection["automation_tasks"].get("relations", [])}
        self.assertIn("task_assigned_to_performer_profile", task_relations)
        self.assertEqual(task_relations["task_assigned_to_performer_profile"]["owner_lookup"]["entity"], "performer_profile")

        work_relations = {rel["relation"]: rel for rel in by_collection["automation_work_hours"].get("relations", [])}
        self.assertIn("performer_profile_creates_work_log", work_relations)
        self.assertEqual(work_relations["performer_profile_creates_work_log"]["owner_lookup"]["by"], "external_id")

        exp_relations = {rel["relation"]: rel for rel in by_collection["automation_finances_expenses"].get("relations", [])}
        self.assertIn("performer_profile_has_legacy_finance_expense", exp_relations)
        self.assertEqual(exp_relations["performer_profile_has_legacy_finance_expense"]["owner_lookup"]["entity"], "performer_profile")

    def test_schema_defines_performer_profile_and_retargeted_relations(self) -> None:
        core = CORE_SCHEMA.read_text(encoding="utf-8")
        finops = FINOPS_SCHEMA.read_text(encoding="utf-8")
        rels = REL_SCHEMA.read_text(encoding="utf-8")

        self.assertIn('entity performer_profile,', core)
        self.assertIn('owns performer_profile_id @key,', core)
        self.assertIn('relation person_has_performer_profile,', rels)
        self.assertIn('relation task_assigned_to_performer_profile,', rels)
        self.assertIn('relation performer_profile_creates_work_log,', rels)
        self.assertIn('relation performer_profile_maps_to_employee,', rels)
        self.assertIn('relation performer_profile_has_legacy_finance_expense,', rels)

        self.assertIn('plays task_assigned_to_performer_profile:assignee_performer_profile,', core)
        self.assertIn('plays person_has_performer_profile:person,', core)
        self.assertIn('plays performer_profile_maps_to_employee:target_employee,', finops)


if __name__ == "__main__":
    unittest.main()
