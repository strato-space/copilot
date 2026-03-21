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
        self.assertIn("entity coding_agent,", text)
        self.assertIn("entity task_family,", text)
        self.assertIn("entity executor_role,", text)
        self.assertIn("entity executor_routing,", text)
        self.assertIn("entity task_execution_run,", text)

    def test_generated_schema_contains_object_bound_bridge_relations(self) -> None:
        _, text = build.build_outputs()
        self.assertIn("relation as_is_project_maps_to_project_context_card,", text)
        self.assertIn("relation as_is_voice_session_maps_to_mode_segment,", text)
        self.assertIn("relation as_is_voice_message_maps_to_object_event,", text)
        self.assertIn("relation as_is_summary_maps_to_object_conclusion,", text)
        self.assertIn("relation voice_message_has_transcription,", text)
        self.assertIn("relation voice_session_has_participant_person,", text)
        self.assertIn("relation drive_project_file_indexes_drive_node,", text)
        self.assertIn("relation target_task_view_classified_as_task_family,", text)
        self.assertIn("relation executor_routing_targets_target_task_view,", text)
        self.assertIn("relation executor_routing_launches_task_execution_run,", text)
        self.assertIn("relation task_execution_run_executes_target_task_view,", text)
        self.assertIn("relation task_execution_run_produces_artifact_record,", text)

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

    def test_to_be_status_owner_constraints_use_values_annotations(self) -> None:
        _, text = build.build_outputs()
        self.assertIn('owns status @values("Draft", "Ready", "Progress 10", "Review / Ready", "Done", "Archive", "unknown"),', text)
        self.assertIn('owns priority @values("P1", "P2", "P3", "P4", "P5", "P6", "P7", "UNKNOWN"),', text)
        self.assertIn('owns status @values("DRAFT_10", "READY_10", "PROGRESS_10", "REVIEW_10", "DONE_10", "ARCHIVE", "UNKNOWN"),', text)
        self.assertIn('owns status @values("enabled", "disabled", "degraded", "retired"),', text)
        self.assertIn('owns status @values("draft", "active", "satisfied", "superseded", "cancelled"),', text)
        self.assertIn('owns status @values("proposed", "accepted", "rejected", "superseded"),', text)
        self.assertIn('owns status @values("pending", "approved", "rejected", "executed", "superseded"),', text)
        self.assertIn('owns status @values("queued", "running", "succeeded", "failed", "cancelled"),', text)


if __name__ == "__main__":
    unittest.main()
