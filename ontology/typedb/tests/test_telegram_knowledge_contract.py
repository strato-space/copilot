from __future__ import annotations

from pathlib import Path
import unittest
import yaml


ROOT = Path(__file__).resolve().parents[1]
MAPPING_PATH = ROOT / "mappings" / "mongodb_to_typedb_v1.yaml"
SCHEMA_PATH = ROOT / "schema" / "str-ontology.tql"


class TelegramKnowledgeContractTest(unittest.TestCase):
    def test_mapping_covers_telegram_entities_and_links(self) -> None:
        mapping = yaml.safe_load(MAPPING_PATH.read_text(encoding="utf-8"))
        by_collection = {item["collection"]: item for item in mapping["collections"]}

        self.assertEqual(by_collection["automation_telegram_chats"]["target_entity"], "telegram_chat")
        self.assertEqual(by_collection["automation_telegram_users"]["target_entity"], "telegram_user")
        self.assertEqual(by_collection["automation_project_performer_links"]["target_entity"], "project_performer_link")
        self.assertEqual(
            by_collection["automation_telegram_users"]["relations"][1]["relation"],
            "telegram_user_maps_to_performer_profile",
        )
        self.assertEqual(
            by_collection["automation_project_performer_links"]["relations"][1]["relation"],
            "project_performer_link_binds_performer_profile",
        )

    def test_schema_contains_telegram_entities_and_relations(self) -> None:
        text = SCHEMA_PATH.read_text(encoding="utf-8")

        self.assertIn("entity telegram_chat,", text)
        self.assertIn("entity telegram_user,", text)
        self.assertIn("entity project_performer_link,", text)
        self.assertIn("relation telegram_chat_has_member,", text)
        self.assertIn("relation telegram_user_maps_to_person,", text)
        self.assertIn("relation telegram_user_maps_to_performer_profile,", text)
        self.assertIn("relation project_has_telegram_chat_source,", text)
        self.assertIn("relation project_performer_link_binds_project,", text)
        self.assertIn("relation project_performer_link_binds_performer_profile,", text)


if __name__ == "__main__":
    unittest.main()
