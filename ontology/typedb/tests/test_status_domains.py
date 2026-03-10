from __future__ import annotations

from pathlib import Path
import unittest
import yaml


ROOT = Path(__file__).resolve().parents[1]
MAPPING_PATH = ROOT / "mappings" / "mongodb_to_typedb_v1.yaml"
KERNEL_ATTRS_PATH = ROOT / "schema" / "fragments" / "00-kernel" / "10-attributes-and-ids.tql"
CORE_SCHEMA = ROOT / "schema" / "fragments" / "10-as-is" / "10-entities-core.tql"
VOICE_SCHEMA = ROOT / "schema" / "fragments" / "10-as-is" / "30-entities-voice-operops.tql"
FINOPS_SCHEMA = ROOT / "schema" / "fragments" / "10-as-is" / "20-entities-finops.tql"


class StatusDomainsTest(unittest.TestCase):
    def test_mapping_splits_status_domains_by_object_family(self) -> None:
        mapping = yaml.safe_load(MAPPING_PATH.read_text(encoding="utf-8"))
        by_collection = {item["collection"]: item for item in mapping["collections"]}

        self.assertEqual(by_collection["automation_customers"]["attributes"]["activity_state"], "is_active")
        self.assertEqual(by_collection["automation_clients"]["attributes"]["activity_state"], "is_active")
        self.assertEqual(by_collection["automation_projects"]["attributes"]["activity_state"], "is_active")
        self.assertEqual(by_collection["automation_project_groups"]["attributes"]["activity_state"], "is_active")
        self.assertEqual(by_collection["automation_tasks"]["attributes"]["status"], "task_status")
        self.assertEqual(by_collection["automation_voice_bot_sessions"]["attributes"]["activity_state"], "is_active")
        self.assertNotIn("status", by_collection["automation_voice_bot_messages"]["attributes"])
        self.assertEqual(by_collection["automation_voice_bot_session_log"]["attributes"]["event_status"], "status")
        self.assertEqual(by_collection["finops_expense_categories"]["attributes"]["activity_state"], "is_active")
        self.assertEqual(by_collection["finops_expense_operations"]["attributes"]["deletion_state"], "is_deleted")

    def test_schema_uses_family_specific_status_attributes(self) -> None:
        core = CORE_SCHEMA.read_text(encoding="utf-8")
        voice = VOICE_SCHEMA.read_text(encoding="utf-8")
        finops = FINOPS_SCHEMA.read_text(encoding="utf-8")

        self.assertIn("entity client,", core)
        self.assertIn("owns activity_state,", core)
        self.assertIn("entity project,", core)
        self.assertIn("owns activity_state,", core)
        self.assertIn("entity person,", core)
        self.assertNotIn("entity person,\n  owns person_id @key,\n  owns name,\n  owns status,", core)

        self.assertIn("entity voice_session,", voice)
        self.assertIn("owns activity_state,", voice)
        self.assertIn("entity history_step,", voice)
        self.assertIn("owns event_status,", voice)
        self.assertNotIn("entity voice_message,\n  owns voice_message_id @key,\n  owns session_id,\n  owns source_type,\n  owns status,", voice)

        self.assertIn("entity cost_category,", finops)
        self.assertIn("owns activity_state,", finops)
        self.assertIn("entity cost_expense,", finops)
        self.assertIn("owns deletion_state,", finops)

    def test_kernel_marks_inventory_fields_inline(self) -> None:
        text = KERNEL_ATTRS_PATH.read_text(encoding="utf-8")
        self.assertIn("# @toon inventory=inspect domain=dictionary max_values=50\nattribute status, value string;", text)
        self.assertIn("# @toon inventory=inspect domain=state max_values=10\nattribute activity_state, value string;", text)
        self.assertIn("# @toon inventory=inspect domain=state max_values=10\nattribute event_status, value string;", text)
        self.assertIn("# @toon inventory=inspect domain=state max_values=10\nattribute deletion_state, value string;", text)
        self.assertIn("# @toon inventory=inspect domain=dictionary max_values=20\nattribute role_name, value string;", text)
        self.assertIn("# @toon inventory=inspect domain=dictionary max_values=50\nattribute task_type_name, value string;", text)


if __name__ == "__main__":
    unittest.main()
