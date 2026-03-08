from __future__ import annotations

from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
MAPPING_PATH = ROOT / "mappings" / "mongodb_to_typedb_v1.yaml"
CORE_SCHEMA = ROOT / "schema" / "fragments" / "10-as-is" / "10-entities-core.tql"
FINOPS_SCHEMA = ROOT / "schema" / "fragments" / "10-as-is" / "20-entities-finops.tql"
REL_SCHEMA = ROOT / "schema" / "fragments" / "10-as-is" / "40-relations.tql"


class EntityAuditRegressionTest(unittest.TestCase):
    def test_finance_income_lookups_match_live_id_semantics(self) -> None:
        mapping = yaml.safe_load(MAPPING_PATH.read_text(encoding="utf-8"))
        by_collection = {item["collection"]: item for item in mapping["collections"]}
        income = by_collection["automation_finances_income"]
        self.assertEqual(income["attributes"]["performer_id"], "performer")
        self.assertEqual(income["attributes"]["legacy_finance_income_type_ref"], "task_type")

        rels = {rel["relation"]: rel for rel in income.get("relations", [])}
        self.assertEqual(rels["project_has_legacy_finance_income"]["owner_lookup"]["by"], "name")
        self.assertEqual(rels["legacy_finance_income_has_type"]["owner_lookup"]["by"], "legacy_finance_income_type_id")
        self.assertEqual(rels["performer_profile_has_legacy_finance_income"]["owner_lookup"]["entity"], "performer_profile")
        self.assertEqual(rels["performer_profile_has_legacy_finance_income"]["owner_lookup"]["by"], "performer_profile_id")

    def test_person_payload_fields_are_not_misnamed_as_notifications_or_access(self) -> None:
        mapping = yaml.safe_load(MAPPING_PATH.read_text(encoding="utf-8"))
        by_collection = {item["collection"]: item for item in mapping["collections"]}
        person = by_collection["automation_persons"]
        self.assertEqual(person["attributes"]["contacts_payload"], "contacts")
        self.assertEqual(person["attributes"]["project_participations"], "projects")
        self.assertNotIn("notifications", person["attributes"])
        self.assertNotIn("projects_access", person["attributes"])

    def test_schema_exposes_new_object_shapes(self) -> None:
        core = CORE_SCHEMA.read_text(encoding="utf-8")
        finops = FINOPS_SCHEMA.read_text(encoding="utf-8")
        rels = REL_SCHEMA.read_text(encoding="utf-8")
        self.assertIn("owns contacts_payload,", core)
        self.assertIn("owns project_participations,", core)
        self.assertIn("owns performer_id,", finops)
        self.assertIn("owns legacy_finance_income_type_ref,", finops)
        self.assertIn("relation performer_profile_has_legacy_finance_income,", rels)


if __name__ == "__main__":
    unittest.main()
