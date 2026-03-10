from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_PATH = ROOT / "scripts" / "build-typedb-schema.py"

spec = importlib.util.spec_from_file_location("typedb_build_schema_test_module", BUILD_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load module from {BUILD_PATH}")
build = importlib.util.module_from_spec(spec)
sys.modules["typedb_build_schema_test_module"] = build
spec.loader.exec_module(build)


class SchemaLayersTest(unittest.TestCase):
    def test_generated_schema_contains_all_layer_markers(self) -> None:
        _, text = build.build_outputs()
        self.assertIn("# --- <kernel> ---", text)
        self.assertIn("# --- <as_is> ---", text)
        self.assertIn("# --- <to_be> ---", text)
        self.assertIn("# --- <bridges> ---", text)

    def test_generated_schema_contains_object_bound_to_be_entities(self) -> None:
        _, text = build.build_outputs()
        self.assertIn("entity project_context_card,", text)
        self.assertIn("entity mode_definition,", text)
        self.assertIn("entity object_revision,", text)
        self.assertIn("entity working_memory,", text)

    def test_generated_schema_contains_object_bound_bridge_relations(self) -> None:
        _, text = build.build_outputs()
        self.assertIn("relation as_is_project_maps_to_project_context_card,", text)
        self.assertIn("relation as_is_voice_session_maps_to_mode_segment,", text)
        self.assertIn("relation as_is_voice_message_maps_to_object_event,", text)
        self.assertIn("relation as_is_summary_maps_to_object_conclusion,", text)

    def test_generated_schema_excludes_routing_items_from_to_be_core(self) -> None:
        _, text = build.build_outputs()
        self.assertNotIn("entity routing_item_template,", text)
        self.assertNotIn("entity routing_item_instance,", text)

    def test_build_metadata_uses_tql_fragments_as_source(self) -> None:
        payload, _ = build.build_outputs()
        self.assertEqual(payload["generated_from"], "ontology/typedb/schema/fragments/*.tql")
        self.assertEqual(payload["sections"], ["kernel", "as_is", "to_be", "bridges"])

    def test_render_toon_values_for_small_domain(self) -> None:
        values = build.render_toon_values(
            "status",
            {"status": {"declared_domain": "dictionary", "max_values": 5, "values": ['"Archive"', '"Backlog"']}},
        )
        self.assertEqual(values, "# @toon values: Archive | Backlog")

    def test_render_toon_values_sorts_null_first_then_alphabetically(self) -> None:
        values = build.render_toon_values(
            "priority",
            {"priority": {"declared_domain": "dictionary", "max_values": 10, "values": ['"P3"', '"🔥 P1 "', "null", '"P2"', '"🔥 P1"']}},
        )
        self.assertEqual(values, "# @toon values: null | P2 | P3 | 🔥 P1")

    def test_generated_schema_keeps_source_lines_and_separates_generated_values_with_blank_line(self) -> None:
        _, text = build.build_outputs(
            {
                "status": {
                    "declared_domain": "dictionary",
                    "max_values": 5,
                    "values": ['"Archive"', '"Backlog"'],
                }
            }
        )
        self.assertIn(
            '# @toon inventory=inspect domain=dictionary max_values=50\n'
            'attribute status, value string;\n'
            '# @toon values: Archive | Backlog\n\n'
            '# @toon inventory=inspect domain=state max_values=10',
            text,
        )

    def test_render_toon_values_for_large_domain(self) -> None:
        values = build.render_toon_values(
            "task_type_name",
            {"task_type_name": {"declared_domain": "dictionary", "max_values": 2, "values": ['\"A\"', '\"B\"', '\"C\"']}},
        )
        self.assertEqual(values, "# @toon values: <too many values; see domain_inventory_latest.md>")

    def test_generated_tql_keeps_embedded_semantic_cards(self) -> None:
        _, text = build.build_outputs()
        self.assertIn('<semantic-card id="project_context_card">', text)
        self.assertIn('<semantic-card id="project">', text)
        self.assertIn("# kind: bounded-context-surface", text)
        self.assertIn("# kind: operational-record", text)

    def test_generated_tql_header_points_to_tql_fragments(self) -> None:
        _, text = build.build_outputs()
        self.assertIn("# Generated from ontology/typedb/schema/fragments/*.tql", text)


if __name__ == "__main__":
    unittest.main()
