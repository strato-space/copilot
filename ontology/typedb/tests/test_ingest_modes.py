from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INGEST_PATH = ROOT / "scripts" / "typedb-ontology-ingest.py"
GENERATED_SCHEMA_PATH = ROOT / "schema" / "str-ontology.tql"

spec = importlib.util.spec_from_file_location("typedb_ontology_ingest_test_module", INGEST_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load module from {INGEST_PATH}")
ingest = importlib.util.module_from_spec(spec)
sys.modules["typedb_ontology_ingest_test_module"] = ingest
spec.loader.exec_module(ingest)


class DummyOptions:
    def __init__(self, sync_mode: str) -> None:
        self.sync_mode = sync_mode


class DummyCtx:
    def __init__(self, sync_mode: str, state: dict) -> None:
        self.options = DummyOptions(sync_mode)
        self.sync_state = state


class IngestHelpersTest(unittest.TestCase):
    def test_resolve_doc_path_supports_nested_fields(self) -> None:
        doc = {"transcription": {"provider": "openai", "model": "whisper-1"}}
        self.assertEqual(ingest.resolve_doc_path(doc, "transcription.provider"), "openai")
        self.assertEqual(ingest.resolve_doc_path(doc, "transcription.model"), "whisper-1")
        self.assertIsNone(ingest.resolve_doc_path(doc, "transcription.schema_version"))

    def test_canonical_voice_ref_to_session_id_from_url(self) -> None:
        session_id = "69aaa05793c933669ebfa51d"
        url = f"https://copilot.stratospace.fun/voice/session/{session_id}"
        self.assertEqual(ingest.canonical_voice_ref_to_session_id(url), session_id)

    def test_build_collection_query_incremental_uses_watermarks(self) -> None:
        state = {
            "collections": {
                "automation_tasks": {
                    "last_seen_updated_at": "2026-03-07T12:00:00+00:00",
                    "last_seen_created_at": "2026-03-07T10:00:00+00:00",
                    "last_seen_object_id": "69aaa05793c933669ebfa51d",
                }
            }
        }
        ctx = DummyCtx("incremental", state)
        query = ingest.build_collection_query(ctx, "automation_tasks")
        self.assertIn("$or", query)
        self.assertEqual(len(query["$or"]), 3)

    def test_build_collection_query_full_mode_is_empty(self) -> None:
        ctx = DummyCtx("full", {"collections": {}})
        self.assertEqual(ingest.build_collection_query(ctx, "automation_tasks"), {})

    def test_incremental_collections_include_projects_and_tasks(self) -> None:
        self.assertIn("automation_projects", ingest.INCREMENTAL_COLLECTIONS)
        self.assertIn("automation_tasks", ingest.INCREMENTAL_COLLECTIONS)
        self.assertIn("automation_voice_bot_sessions", ingest.INCREMENTAL_COLLECTIONS)
        self.assertIn("automation_voice_bot_messages", ingest.INCREMENTAL_COLLECTIONS)

    def test_tombstoned_doc_detected_for_supported_collections(self) -> None:
        self.assertTrue(ingest.is_tombstoned_doc("automation_tasks", {"is_deleted": True}))
        self.assertTrue(ingest.is_tombstoned_doc("automation_voice_bot_sessions", {"is_deleted": True}))
        self.assertTrue(ingest.is_tombstoned_doc("automation_voice_bot_messages", {"is_deleted": True}))
        self.assertFalse(ingest.is_tombstoned_doc("automation_projects", {"is_deleted": True}))

    def test_update_sync_state_tracks_latest_timestamps(self) -> None:
        ctx = DummyCtx("incremental", {"collections": {}})
        ingest.update_sync_state_for_doc(
            ctx,
            "automation_tasks",
            {
                "_id": "69aaa05793c933669ebfa51d",
                "created_at": datetime(2026, 3, 7, 10, 0, 0, tzinfo=timezone.utc),
                "updated_at": datetime(2026, 3, 7, 12, 0, 0, tzinfo=timezone.utc),
            },
        )
        state = ctx.sync_state["collections"]["automation_tasks"]
        self.assertEqual(state["last_seen_object_id"], "69aaa05793c933669ebfa51d")
        self.assertEqual(state["last_seen_created_at"], "2026-03-07T10:00:00")
        self.assertEqual(state["last_seen_updated_at"], "2026-03-07T12:00:00")

    def test_load_and_save_sync_state_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            payload = {"collections": {"automation_tasks": {"last_seen_object_id": "abc"}}}
            ingest.save_sync_state(path, payload)
            loaded = ingest.load_sync_state(path)
            self.assertEqual(loaded, payload)

    def test_datetime_normalization_drops_tzinfo_consistently(self) -> None:
        aware = ingest.as_datetime("2026-03-08T01:02:03+00:00")
        parsed = ingest.parse_iso_datetime("2026-03-08T01:02:03+00:00")
        self.assertIsNotNone(aware)
        self.assertIsNotNone(parsed)
        self.assertIsNone(aware.tzinfo)
        self.assertIsNone(parsed.tzinfo)

    def test_generated_schema_contains_real_to_be_and_bridge_layers(self) -> None:
        text = GENERATED_SCHEMA_PATH.read_text(encoding="utf-8")
        self.assertIn("entity project_context_card,", text)
        self.assertIn("entity context_bundle,", text)
        self.assertIn("entity mode_definition,", text)
        self.assertIn("relation as_is_project_maps_to_project_context_card,", text)
        self.assertIn("relation as_is_voice_session_maps_to_mode_segment,", text)


if __name__ == "__main__":
    unittest.main()
