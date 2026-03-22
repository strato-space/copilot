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
    def __init__(self, sync_mode: str, apply: bool = False) -> None:
        self.sync_mode = sync_mode
        self.apply = apply
        self.projection_scope = "full"
        self.typedb_database = "test"
        self.skip_session_derived_projections = False
        self.skip_sync_state_write = False
        self.assume_empty_db = False


class DummyCtx:
    def __init__(self, sync_mode: str, state: dict, apply: bool = False) -> None:
        self.options = DummyOptions(sync_mode, apply=apply)
        self.sync_state = state
        self.typedb_driver = object() if apply else None
        self.entity_updated_at_cache = {}
        self.ensured_entity_keys = set()
        self.deadletter = type("Deadletter", (), {"write": lambda *args, **kwargs: None})()


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

    def test_normalize_task_status_key_maps_labels_to_canonical_keys(self) -> None:
        self.assertEqual(ingest.normalize_task_status_key("Draft"), "DRAFT_10")
        self.assertEqual(ingest.normalize_task_status_key("Ready"), "READY_10")
        self.assertEqual(ingest.normalize_task_status_key("Progress 10"), "PROGRESS_10")
        self.assertEqual(ingest.normalize_task_status_key("Review / Ready"), "REVIEW_10")
        self.assertEqual(ingest.normalize_task_status_key("Done"), "DONE_10")
        self.assertEqual(ingest.normalize_task_status_key("Archive"), "ARCHIVE")
        self.assertEqual(ingest.normalize_task_status_key("DRAFT_10"), "DRAFT_10")
        self.assertEqual(ingest.normalize_task_status_key("weird"), "UNKNOWN")
        self.assertEqual(ingest.normalize_task_status_key(None), "UNKNOWN")

    def test_normalize_task_priority_maps_raw_labels_to_canonical_values(self) -> None:
        self.assertEqual(ingest.normalize_task_priority("🔥 P1 "), "P1")
        self.assertEqual(ingest.normalize_task_priority("🔥 P1"), "P1")
        self.assertEqual(ingest.normalize_task_priority("P2"), "P2")
        self.assertEqual(ingest.normalize_task_priority("P7"), "P7")
        self.assertEqual(ingest.normalize_task_priority("weird"), "UNKNOWN")
        self.assertEqual(ingest.normalize_task_priority(None), "UNKNOWN")

    def test_transcript_segment_ids_are_namespaced_by_transcription(self) -> None:
        transcription_id = "msg-1:transcription"
        raw_segment_id = "ch_699ed31533bac29af6b5c54f"
        segment_id = f"{transcription_id}:segment:{raw_segment_id}"
        self.assertEqual(segment_id, "msg-1:transcription:segment:ch_699ed31533bac29af6b5c54f")

    def test_entity_has_matching_updated_at_returns_true_for_equal_timestamp(self) -> None:
        ctx = DummyCtx("full", {"collections": {}}, apply=True)
        original = ingest.load_entity_updated_at_index
        try:
            ingest.load_entity_updated_at_index = lambda *args, **kwargs: {"task-1": datetime(2026, 3, 15, 7, 0, 0)}
            matched = ingest.entity_has_matching_updated_at(
                ctx,
                entity="task",
                key_attr="task_id",
                key_value="task-1",
                attr_specs=[("updated_at", "datetime", "2026-03-15T07:00:00Z")],
            )
        finally:
            ingest.load_entity_updated_at_index = original
        self.assertTrue(matched)

    def test_entity_has_matching_updated_at_returns_false_without_updated_at_spec(self) -> None:
        ctx = DummyCtx("full", {"collections": {}}, apply=True)
        matched = ingest.entity_has_matching_updated_at(
            ctx,
            entity="task",
            key_attr="task_id",
            key_value="task-1",
            attr_specs=[("created_at", "datetime", "2026-03-15T07:00:00Z")],
        )
        self.assertFalse(matched)

    def test_insert_query_assume_empty_db_skips_exists_check(self) -> None:
        ctx = DummyCtx("full", {"collections": {}}, apply=True)
        ctx.options.assume_empty_db = True
        stats = ingest.CollectionStats(collection="automation_voice_bot_messages")
        original_execute = ingest.execute_query_in_transaction
        original_query_has_rows = ingest.query_has_rows
        executed_queries = []
        try:
            ingest.execute_query_in_transaction = lambda *args, **kwargs: executed_queries.append(args[3])
            ingest.query_has_rows = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("should not be called"))
            inserted = ingest.insert_query(
                ctx,
                stats,
                "automation_voice_bot_messages",
                "msg-1",
                'insert $m isa voice_message, has voice_message_id "msg-1";',
                {"_id": "msg-1"},
                entity="voice_message",
                key_attr="voice_message_id",
                key_value="msg-1",
            )
        finally:
            ingest.execute_query_in_transaction = original_execute
            ingest.query_has_rows = original_query_has_rows

        self.assertTrue(inserted)
        self.assertEqual(stats.inserted, 1)
        self.assertEqual(len(executed_queries), 1)

    def test_voice_session_core_scope_skips_derived_projections(self) -> None:
        ctx = DummyCtx("full", {"collections": {}}, apply=True)
        ctx.options.projection_scope = "core"
        original_match = ingest.entity_has_matching_updated_at
        original_for_each_doc = ingest.for_each_doc
        original_insert_query = ingest.insert_query
        original_insert_relation_query = ingest.insert_relation_query
        original_mode_segment = ingest.project_mode_segment
        original_summary_projection = ingest.project_object_conclusion_from_session_summary
        original_participants = ingest.project_voice_session_participants
        original_processors = ingest.project_voice_session_processors
        insert_payloads = []
        relation_payloads = []
        derived_calls = []
        try:
            ingest.entity_has_matching_updated_at = lambda *args, **kwargs: False

            def fake_for_each_doc(_ctx, collection, handler, projection=None):
                stats = ingest.CollectionStats(collection=collection, scanned=1)
                handler({"_id": "session-2", "project_id": "project-1"}, stats)
                return stats

            def fake_insert_relation_query(*args, **kwargs):
                payload = kwargs.get("payload")
                if payload is None and len(args) > 5:
                    payload = args[5]
                relation_payloads.append(payload)
                return True

            def fake_insert_query(*args, **kwargs):
                payload = kwargs.get("payload")
                if payload is None and len(args) > 5:
                    payload = args[5]
                insert_payloads.append(payload)
                return True

            ingest.for_each_doc = fake_for_each_doc
            ingest.insert_query = fake_insert_query
            ingest.insert_relation_query = fake_insert_relation_query
            ingest.project_mode_segment = lambda *args, **kwargs: derived_calls.append("mode")
            ingest.project_object_conclusion_from_session_summary = lambda *args, **kwargs: derived_calls.append("summary")
            ingest.project_voice_session_participants = lambda *args, **kwargs: derived_calls.append("participants")
            ingest.project_voice_session_processors = lambda *args, **kwargs: derived_calls.append("processors")
            result = ingest.ingest_voice_sessions(ctx)
        finally:
            ingest.entity_has_matching_updated_at = original_match
            ingest.for_each_doc = original_for_each_doc
            ingest.insert_query = original_insert_query
            ingest.insert_relation_query = original_insert_relation_query
            ingest.project_mode_segment = original_mode_segment
            ingest.project_object_conclusion_from_session_summary = original_summary_projection
            ingest.project_voice_session_participants = original_participants
            ingest.project_voice_session_processors = original_processors

        self.assertEqual(result.scanned, 1)
        self.assertEqual(derived_calls, [])
        self.assertEqual(insert_payloads, [{"_id": "session-2"}])
        self.assertEqual(relation_payloads, [{"voice_session_id": "session-2", "project_id": "project-1"}])

    def test_voice_message_core_scope_skips_derived_projections(self) -> None:
        ctx = DummyCtx("full", {"collections": {}}, apply=True)
        ctx.options.projection_scope = "core"
        original_match = ingest.entity_has_matching_updated_at
        original_for_each_doc = ingest.for_each_doc
        original_insert_query = ingest.insert_query
        original_insert_relation_query = ingest.insert_relation_query
        original_object_event = ingest.project_object_event
        original_transcription = ingest.project_voice_message_transcription
        original_categorization = ingest.project_voice_message_categorization
        original_file_support = ingest.project_voice_message_file_support
        original_processors = ingest.project_voice_message_processors
        original_artifact = ingest.project_artifact_record_from_attachment
        insert_payloads = []
        relation_payloads = []
        derived_calls = []
        try:
            ingest.entity_has_matching_updated_at = lambda *args, **kwargs: False

            def fake_for_each_doc(_ctx, collection, handler, projection=None):
                stats = ingest.CollectionStats(collection=collection, scanned=1)
                handler({"_id": "message-2", "session_id": "session-2"}, stats)
                return stats

            def fake_insert_relation_query(*args, **kwargs):
                payload = kwargs.get("payload")
                if payload is None and len(args) > 5:
                    payload = args[5]
                relation_payloads.append(payload)
                return True

            def fake_insert_query(*args, **kwargs):
                payload = kwargs.get("payload")
                if payload is None and len(args) > 5:
                    payload = args[5]
                insert_payloads.append(payload)
                return True

            ingest.for_each_doc = fake_for_each_doc
            ingest.insert_query = fake_insert_query
            ingest.insert_relation_query = fake_insert_relation_query
            ingest.project_object_event = lambda *args, **kwargs: derived_calls.append("event")
            ingest.project_voice_message_transcription = lambda *args, **kwargs: derived_calls.append("transcription")
            ingest.project_voice_message_categorization = lambda *args, **kwargs: derived_calls.append("categorization")
            ingest.project_voice_message_file_support = lambda *args, **kwargs: derived_calls.append("file")
            ingest.project_voice_message_processors = lambda *args, **kwargs: derived_calls.append("processors")
            ingest.project_artifact_record_from_attachment = lambda *args, **kwargs: derived_calls.append("artifact")
            result = ingest.ingest_voice_messages(ctx)
        finally:
            ingest.entity_has_matching_updated_at = original_match
            ingest.for_each_doc = original_for_each_doc
            ingest.insert_query = original_insert_query
            ingest.insert_relation_query = original_insert_relation_query
            ingest.project_object_event = original_object_event
            ingest.project_voice_message_transcription = original_transcription
            ingest.project_voice_message_categorization = original_categorization
            ingest.project_voice_message_file_support = original_file_support
            ingest.project_voice_message_processors = original_processors
            ingest.project_artifact_record_from_attachment = original_artifact

        self.assertEqual(result.scanned, 1)
        self.assertEqual(derived_calls, [])
        self.assertEqual(insert_payloads, [{"_id": "message-2"}])
        self.assertEqual(relation_payloads, [{"voice_message_id": "message-2", "voice_session_id": "session-2"}])

    def test_voice_message_derived_scope_rebuilds_family_without_core_insert(self) -> None:
        ctx = DummyCtx("incremental", {"collections": {}}, apply=True)
        ctx.options.projection_scope = "derived"
        original_for_each_doc = ingest.for_each_doc
        original_insert_query = ingest.insert_query
        original_delete_family = ingest.delete_voice_message_derived_family
        original_object_event = ingest.project_object_event
        original_transcription = ingest.project_voice_message_transcription
        original_categorization = ingest.project_voice_message_categorization
        original_file_support = ingest.project_voice_message_file_support
        original_processors = ingest.project_voice_message_processors
        original_artifact = ingest.project_artifact_record_from_attachment
        original_reconcile_chunks = ingest.reconcile_transcript_chunks
        delete_calls = []
        insert_payloads = []
        derived_calls = []
        try:
            def fake_for_each_doc(_ctx, collection, handler, projection=None):
                stats = ingest.CollectionStats(collection=collection, scanned=1)
                handler({"_id": "message-3", "session_id": "session-3"}, stats)
                return stats

            def fake_insert_query(*args, **kwargs):
                payload = kwargs.get("payload")
                if payload is None and len(args) > 5:
                    payload = args[5]
                insert_payloads.append(payload)
                return True

            ingest.for_each_doc = fake_for_each_doc
            ingest.insert_query = fake_insert_query
            ingest.delete_voice_message_derived_family = lambda *args, **kwargs: delete_calls.append(kwargs.get("voice_message_id"))
            ingest.project_object_event = lambda *args, **kwargs: derived_calls.append("event")
            ingest.project_voice_message_transcription = lambda *args, **kwargs: derived_calls.append("transcription")
            ingest.project_voice_message_categorization = lambda *args, **kwargs: derived_calls.append("categorization")
            ingest.project_voice_message_file_support = lambda *args, **kwargs: derived_calls.append("file")
            ingest.project_voice_message_processors = lambda *args, **kwargs: derived_calls.append("processors")
            ingest.project_artifact_record_from_attachment = lambda *args, **kwargs: derived_calls.append("artifact")
            ingest.reconcile_transcript_chunks = lambda *args, **kwargs: None
            result = ingest.ingest_voice_messages(ctx)
        finally:
            ingest.for_each_doc = original_for_each_doc
            ingest.insert_query = original_insert_query
            ingest.delete_voice_message_derived_family = original_delete_family
            ingest.project_object_event = original_object_event
            ingest.project_voice_message_transcription = original_transcription
            ingest.project_voice_message_categorization = original_categorization
            ingest.project_voice_message_file_support = original_file_support
            ingest.project_voice_message_processors = original_processors
            ingest.project_artifact_record_from_attachment = original_artifact
            ingest.reconcile_transcript_chunks = original_reconcile_chunks

        self.assertEqual(result.scanned, 1)
        self.assertEqual(insert_payloads, [])
        self.assertEqual(delete_calls, ["message-3"])
        self.assertEqual(derived_calls, ["event", "transcription", "categorization", "file", "processors", "artifact"])


if __name__ == "__main__":
    unittest.main()
