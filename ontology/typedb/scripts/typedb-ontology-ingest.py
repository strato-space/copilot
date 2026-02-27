#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.database import Database
from typedb.driver import Credentials, DriverOptions, TransactionType, TypeDB
import yaml

SUPPORTED_COLLECTIONS = [
    "automation_customers",
    "automation_clients",
    "automation_projects",
    "automation_project_groups",
    "automation_task_types",
    "automation_task_types_tree",
    "automation_epic_tasks",
    "automation_performers",
    "automation_persons",
    "automation_tasks",
    "automation_work_hours",
    "automation_voice_bot_sessions",
    "automation_voice_bot_messages",
    "automation_voice_bot_topics",
    "automation_voice_bot_session_log",
    "automation_tg_voice_sessions",
    "automation_google_drive_projects_files",
    "automation_google_drive_events_channels",
    "automation_google_drive_structure",
    "automation_object_locator",
    "automation_finances_expenses",
    "automation_finances_income",
    "automation_finances_income_types",
    "forecasts_project_month",
    "finops_expense_categories",
    "finops_expense_operations",
    "finops_expense_operations_log",
    "finops_fx_rates",
]

TYPEDB_SAFE_STRING_BYTES = 60_000
VOICE_TRANSCRIPT_MAX_BYTES = 1_048_576
VOICE_TRANSCRIPT_CHUNK_BYTES = 60_000
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
TYPEDB_ROOT_DIR = SCRIPT_DIR.parent
DEFAULT_SCHEMA_PATH = TYPEDB_ROOT_DIR / "schema" / "str_opsportal_v1.tql"
DEFAULT_MAPPING_PATH = TYPEDB_ROOT_DIR / "mappings" / "mongodb_to_typedb_v1.yaml"
DEFAULT_DEADLETTER_PATH = TYPEDB_ROOT_DIR / "logs" / "typedb-ontology-ingest-deadletter.ndjson"


@dataclass
class CliOptions:
    apply: bool
    init_schema: bool
    limit: Optional[int]
    collections: list[str]
    deadletter_path: pathlib.Path
    typedb_addresses: list[str]
    typedb_primary_address: str
    typedb_username: str
    typedb_password: str
    typedb_tls_enabled: bool
    typedb_database: str
    schema_path: pathlib.Path
    mapping_path: pathlib.Path


@dataclass
class CollectionStats:
    collection: str
    scanned: int = 0
    inserted: int = 0
    failed: int = 0
    skipped: int = 0
    relations_inserted: int = 0
    relation_failed: int = 0
    relations_skipped: int = 0


@dataclass
class IngestContext:
    db: Database
    typedb_driver: Any
    options: CliOptions
    deadletter: "DeadletterWriter"
    mapping_by_collection: dict[str, dict[str, Any]]
    schema_attr_types: dict[str, str]
    entity_owned_attrs: dict[str, set[str]]
    relation_roles: dict[str, list[str]]
    entity_relation_roles: dict[tuple[str, str], set[str]]


class DeadletterWriter:
    def __init__(self, path: pathlib.Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = path
        self._fp = path.open("a", encoding="utf-8")

    @property
    def path(self) -> pathlib.Path:
        return self._path

    def write(self, entry: dict[str, Any]) -> None:
        payload = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **entry}
        self._fp.write(json.dumps(payload, ensure_ascii=False) + "\n")
        self._fp.flush()

    def close(self) -> None:
        if not self._fp.closed:
            self._fp.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest MongoDB data into TypeDB ontology")
    parser.add_argument("--apply", action="store_true", help="Apply writes to TypeDB (default is dry-run)")
    parser.add_argument("--init-schema", action="store_true", help="Load schema before ingestion")
    parser.add_argument("--limit", type=int, default=None, help="Limit documents per collection")
    parser.add_argument(
        "--collections",
        type=str,
        default=None,
        help="Comma-separated list of collections to ingest",
    )
    parser.add_argument(
        "--deadletter",
        type=str,
        default=str(DEFAULT_DEADLETTER_PATH),
        help="Path to deadletter NDJSON",
    )
    parser.add_argument("--typedb-addresses", type=str, default=None)
    parser.add_argument("--typedb-username", type=str, default=None)
    parser.add_argument("--typedb-password", type=str, default=None)
    parser.add_argument("--typedb-database", type=str, default=None)
    parser.add_argument("--typedb-tls-enabled", type=str, default=None)
    parser.add_argument(
        "--schema",
        type=str,
        default=str(DEFAULT_SCHEMA_PATH),
        help="Path to TypeQL schema",
    )
    parser.add_argument(
        "--mapping",
        type=str,
        default=str(DEFAULT_MAPPING_PATH),
        help="Path to MongoDB->TypeDB mapping YAML",
    )
    return parser.parse_args()


def parse_bool(raw: Optional[str], default: bool = False) -> bool:
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


def parse_typedb_addresses(raw: str) -> list[str]:
    values = []
    for item in raw.split(","):
        entry = item.strip()
        if not entry:
            continue
        if "://" in entry:
            entry = entry.split("://", 1)[1]
        entry = entry.rstrip("/")
        if entry:
            values.append(entry)
    deduped = list(dict.fromkeys(values))
    if not deduped:
        raise ValueError("TypeDB addresses are empty. Use --typedb-addresses or TYPEDB_ADDRESSES.")
    return deduped


def resolve_mongo_uri() -> str:
    value = os.getenv("MONGODB_CONNECTION_STRING")
    if not value:
        raise ValueError("MONGODB_CONNECTION_STRING is not set")
    return value


def resolve_db_name() -> str:
    value = os.getenv("DB_NAME")
    if not value:
        raise ValueError("DB_NAME is not set")
    return value


def parse_options(args: argparse.Namespace) -> CliOptions:
    if args.limit is not None and args.limit <= 0:
        raise ValueError(f"Invalid --limit value: {args.limit}")

    if args.collections:
        collections = [part.strip() for part in args.collections.split(",") if part.strip()]
        if not collections:
            raise ValueError("Empty --collections value")
        unknown = [item for item in collections if item not in SUPPORTED_COLLECTIONS]
        if unknown:
            raise ValueError(f"Unsupported collections: {', '.join(unknown)}")
    else:
        collections = list(SUPPORTED_COLLECTIONS)

    addresses = parse_typedb_addresses(
        args.typedb_addresses or os.getenv("TYPEDB_ADDRESSES") or "127.0.0.1:1729"
    )
    if len(addresses) > 1:
        print(
            f"[typedb-ontology-ingest] warning: Python gRPC driver uses a single address. "
            f"Using first address: {addresses[0]}",
            file=sys.stderr,
        )

    return CliOptions(
        apply=bool(args.apply),
        init_schema=bool(args.init_schema),
        limit=args.limit,
        collections=collections,
        deadletter_path=pathlib.Path(args.deadletter).resolve(),
        typedb_addresses=addresses,
        typedb_primary_address=addresses[0],
        typedb_username=args.typedb_username or os.getenv("TYPEDB_USERNAME") or "admin",
        typedb_password=args.typedb_password or os.getenv("TYPEDB_PASSWORD") or "password",
        typedb_tls_enabled=parse_bool(args.typedb_tls_enabled or os.getenv("TYPEDB_TLS_ENABLED"), default=False),
        typedb_database=args.typedb_database or os.getenv("TYPEDB_DATABASE") or "str_opsportal_v1",
        schema_path=pathlib.Path(args.schema).resolve(),
        mapping_path=pathlib.Path(args.mapping).resolve(),
    )


def normalize_id(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, str):
        value = value.strip()
        return value if value else None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return str(value)
    return None


def as_string(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value else None


def as_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return float(value)
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        try:
            return float(value)
        except ValueError:
            return None
    return None


def as_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered == "true":
            return True
        if lowered == "false":
            return False
    return None


def normalize_status_from_bool(value: Any) -> str:
    bool_value = as_bool(value)
    if bool_value is None:
        return "unknown"
    return "active" if bool_value else "inactive"


def utf8_byte_length(value: str) -> int:
    return len(value.encode("utf-8"))


def truncate_utf8_to_bytes(value: str, max_bytes: int) -> str:
    if max_bytes <= 0:
        return ""
    encoded = value.encode("utf-8")
    if len(encoded) <= max_bytes:
        return value

    out_chars: list[str] = []
    consumed = 0
    for char in value:
        char_bytes = len(char.encode("utf-8"))
        if consumed + char_bytes > max_bytes:
            break
        out_chars.append(char)
        consumed += char_bytes
    return "".join(out_chars)


def split_utf8_by_bytes(value: str, max_bytes: int) -> list[str]:
    if max_bytes <= 0 or not value:
        return []

    parts: list[str] = []
    current_chars: list[str] = []
    current_bytes = 0

    for char in value:
        char_bytes = len(char.encode("utf-8"))
        if char_bytes > max_bytes:
            continue
        if current_bytes + char_bytes > max_bytes:
            if current_chars:
                parts.append("".join(current_chars))
            current_chars = [char]
            current_bytes = char_bytes
            continue

        current_chars.append(char)
        current_bytes += char_bytes

    if current_chars:
        parts.append("".join(current_chars))

    return parts


def escaped(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


def lit_string(value: str) -> str:
    return f'"{escaped(value)}"'


def lit_number(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return str(value)


def lit_bool(value: bool) -> str:
    return "true" if value else "false"


def lit_datetime(value: datetime) -> str:
    normalized = value
    if normalized.tzinfo is not None and normalized.utcoffset() is not None:
        normalized = normalized.astimezone(timezone.utc).replace(tzinfo=None)
    return normalized.isoformat()


def append_string_attr(parts: list[str], attr: str, value: Optional[str]) -> None:
    if value is None:
        return
    parts.append(f"has {attr} {lit_string(value)}")


def append_number_attr(parts: list[str], attr: str, value: Optional[float]) -> None:
    if value is None:
        return
    parts.append(f"has {attr} {lit_number(value)}")


def append_bool_attr(parts: list[str], attr: str, value: Optional[bool]) -> None:
    if value is None:
        return
    parts.append(f"has {attr} {lit_bool(value)}")


def append_datetime_attr(parts: list[str], attr: str, value: Optional[datetime]) -> None:
    if value is None:
        return
    parts.append(f"has {attr} {lit_datetime(value)}")


def as_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        normalized = text.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return None
    return None


def to_stringish(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return None
        return str(value)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    if isinstance(value, (list, dict)):
        try:
            return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
        except Exception:
            return None
    return None


def mapping_key_component(value: Any) -> Optional[str]:
    return normalize_id(value) or to_stringish(value)


def print_stats(stats: list[CollectionStats]) -> None:
    print("")
    print("[typedb-ontology-ingest] summary")
    for item in stats:
        print(
            f"  - {item.collection}: scanned={item.scanned} inserted={item.inserted} "
            f"failed={item.failed} skipped={item.skipped} rel_inserted={item.relations_inserted} "
            f"rel_failed={item.relation_failed} rel_skipped={item.relations_skipped}"
        )


def execute_query_in_transaction(driver: Any, database: str, tx_type: TransactionType, query: str) -> None:
    tx = driver.transaction(database, tx_type)
    try:
        tx.query(query).resolve()
        tx.commit()
    except Exception:
        try:
            tx.rollback()
        except Exception as rollback_error:
            print(f"[typedb-ontology-ingest] rollback warning: {rollback_error}", file=sys.stderr)
        raise
    finally:
        try:
            tx.close()
        except Exception as close_error:
            print(f"[typedb-ontology-ingest] closeTransaction warning: {close_error}", file=sys.stderr)


def query_has_rows(driver: Any, database: str, query: str) -> bool:
    tx = driver.transaction(database, TransactionType.READ)
    try:
        answer = tx.query(query).resolve()
        if not answer.is_concept_rows():
            return False
        iterator = answer.as_concept_rows().iterator
        try:
            next(iterator)
            return True
        except StopIteration:
            return False
    finally:
        try:
            tx.close()
        except Exception as close_error:
            print(f"[typedb-ontology-ingest] closeTransaction warning: {close_error}", file=sys.stderr)


def insert_query(
    ctx: IngestContext,
    stats: CollectionStats,
    collection: str,
    source_id: Optional[str],
    query: str,
    payload: Any,
    *,
    entity: Optional[str] = None,
    key_attr: Optional[str] = None,
    key_value: Optional[str] = None,
) -> bool:
    if not ctx.options.apply or ctx.typedb_driver is None:
        stats.inserted += 1
        return True

    if entity and key_attr and key_value:
        exists_query = (
            f"match $x isa {entity}, has {key_attr} {lit_string(key_value)}; "
            "limit 1;"
        )
        if query_has_rows(ctx.typedb_driver, ctx.options.typedb_database, exists_query):
            stats.skipped += 1
            return False

    try:
        execute_query_in_transaction(ctx.typedb_driver, ctx.options.typedb_database, TransactionType.WRITE, query)
        stats.inserted += 1
        return True
    except Exception as error:
        if "[CNT9]" in str(error):
            stats.skipped += 1
            return False
        stats.failed += 1
        ctx.deadletter.write(
            {
                "collection": collection,
                "source_id": source_id,
                "reason": "insert_failed",
                "error": str(error),
                "query": query,
                "payload": payload,
            }
        )
        return False


def insert_relation_query(
    ctx: IngestContext,
    stats: CollectionStats,
    collection: str,
    source_id: Optional[str],
    query: str,
    payload: Any,
    *,
    exists_query: Optional[str] = None,
) -> bool:
    if not ctx.options.apply or ctx.typedb_driver is None:
        stats.relations_inserted += 1
        return True

    if exists_query is not None:
        if query_has_rows(ctx.typedb_driver, ctx.options.typedb_database, exists_query):
            stats.relations_skipped += 1
            return False

    try:
        execute_query_in_transaction(ctx.typedb_driver, ctx.options.typedb_database, TransactionType.WRITE, query)
        stats.relations_inserted += 1
        return True
    except Exception as error:
        if "[CNT9]" in str(error):
            stats.relations_skipped += 1
            return False
        stats.relation_failed += 1
        ctx.deadletter.write(
            {
                "collection": collection,
                "source_id": source_id,
                "reason": "relation_insert_failed",
                "error": str(error),
                "query": query,
                "payload": payload,
            }
        )
        return False


def for_each_doc(
    ctx: IngestContext,
    collection: str,
    handler: Callable[[dict[str, Any], CollectionStats], None],
) -> CollectionStats:
    stats = CollectionStats(collection=collection)

    cursor = ctx.db[collection].find({})
    if ctx.options.limit is not None:
        cursor = cursor.limit(ctx.options.limit)

    for raw_doc in cursor:
        doc = dict(raw_doc)
        stats.scanned += 1
        handler(doc, stats)

        if stats.scanned % 500 == 0:
            print(
                f"[typedb-ontology-ingest] {collection}: scanned={stats.scanned} "
                f"inserted={stats.inserted} failed={stats.failed}"
            )

    return stats


def ingest_customers(ctx: IngestContext) -> CollectionStats:
    def handler(doc: dict[str, Any], stats: CollectionStats) -> None:
        doc_id = normalize_id(doc.get("_id"))
        if not doc_id:
            stats.skipped += 1
            ctx.deadletter.write(
                {
                    "collection": "automation_customers",
                    "source_id": None,
                    "reason": "missing_id",
                    "payload": doc,
                }
            )
            return

        fields = ["insert $c isa client", f"has client_id {lit_string(doc_id)}"]
        append_string_attr(fields, "name", as_string(doc.get("name")))
        append_string_attr(fields, "status", normalize_status_from_bool(doc.get("is_active")))
        query = f"{', '.join(fields)};"
        insert_query(
            ctx,
            stats,
            "automation_customers",
            doc_id,
            query,
            {"_id": doc_id},
            entity="client",
            key_attr="client_id",
            key_value=doc_id,
        )

    return for_each_doc(ctx, "automation_customers", handler)


def ingest_projects(ctx: IngestContext) -> CollectionStats:
    def handler(doc: dict[str, Any], stats: CollectionStats) -> None:
        doc_id = normalize_id(doc.get("_id"))
        if not doc_id:
            stats.skipped += 1
            ctx.deadletter.write(
                {
                    "collection": "automation_projects",
                    "source_id": None,
                    "reason": "missing_id",
                    "payload": doc,
                }
            )
            return

        fields = ["insert $p isa project", f"has project_id {lit_string(doc_id)}"]
        append_string_attr(fields, "name", as_string(doc.get("name")))
        append_string_attr(fields, "status", normalize_status_from_bool(doc.get("is_active")))
        append_string_attr(fields, "runtime_tag", as_string(doc.get("runtime_tag")))
        query = f"{', '.join(fields)};"
        insert_query(
            ctx,
            stats,
            "automation_projects",
            doc_id,
            query,
            {"_id": doc_id},
            entity="project",
            key_attr="project_id",
            key_value=doc_id,
        )

    return for_each_doc(ctx, "automation_projects", handler)


def ingest_tasks(ctx: IngestContext) -> CollectionStats:
    def handler(doc: dict[str, Any], stats: CollectionStats) -> None:
        doc_id = normalize_id(doc.get("_id"))
        if not doc_id:
            stats.skipped += 1
            ctx.deadletter.write(
                {
                    "collection": "automation_tasks",
                    "source_id": None,
                    "reason": "missing_id",
                    "payload": doc,
                }
            )
            return

        status = as_string(doc.get("task_status")) or as_string(doc.get("status")) or "unknown"
        fields = ["insert $t isa oper_task", f"has task_id {lit_string(doc_id)}"]
        append_string_attr(fields, "title", as_string(doc.get("name")))
        append_string_attr(fields, "description", as_string(doc.get("description")))
        append_string_attr(fields, "status", status)
        append_number_attr(fields, "priority_rank", as_number(doc.get("priority")))
        append_string_attr(fields, "project_id", normalize_id(doc.get("project_id")))
        query = f"{', '.join(fields)};"
        insert_query(
            ctx,
            stats,
            "automation_tasks",
            doc_id,
            query,
            {"_id": doc_id},
            entity="oper_task",
            key_attr="task_id",
            key_value=doc_id,
        )

        project_id = normalize_id(doc.get("project_id"))
        if not project_id:
            return

        relation_query = (
            f"match $p isa project, has project_id {lit_string(project_id)}; "
            f"$t isa oper_task, has task_id {lit_string(doc_id)}; "
            "insert (owner_project: $p, oper_task: $t) isa project_has_oper_task;"
        )
        insert_relation_query(
            ctx,
            stats,
            "automation_tasks",
            doc_id,
            relation_query,
            {"task_id": doc_id, "project_id": project_id},
            exists_query=(
                f"match $p isa project, has project_id {lit_string(project_id)}; "
                f"$t isa oper_task, has task_id {lit_string(doc_id)}; "
                "(owner_project: $p, oper_task: $t) isa project_has_oper_task; limit 1;"
            ),
        )

    return for_each_doc(ctx, "automation_tasks", handler)


def ingest_voice_sessions(ctx: IngestContext) -> CollectionStats:
    def handler(doc: dict[str, Any], stats: CollectionStats) -> None:
        doc_id = normalize_id(doc.get("_id"))
        if not doc_id:
            stats.skipped += 1
            ctx.deadletter.write(
                {
                    "collection": "automation_voice_bot_sessions",
                    "source_id": None,
                    "reason": "missing_id",
                    "payload": doc,
                }
            )
            return

        status = as_string(doc.get("status")) or normalize_status_from_bool(doc.get("is_active"))
        fields = ["insert $s isa voice_session", f"has voice_session_id {lit_string(doc_id)}"]
        append_string_attr(fields, "status", status)
        append_string_attr(fields, "source_type", as_string(doc.get("session_source")))
        append_string_attr(fields, "project_id", normalize_id(doc.get("project_id")))
        append_string_attr(fields, "runtime_tag", as_string(doc.get("runtime_tag")))
        query = f"{', '.join(fields)};"
        insert_query(
            ctx,
            stats,
            "automation_voice_bot_sessions",
            doc_id,
            query,
            {"_id": doc_id},
            entity="voice_session",
            key_attr="voice_session_id",
            key_value=doc_id,
        )

        project_id = normalize_id(doc.get("project_id"))
        if not project_id:
            return

        relation_query = (
            f"match $p isa project, has project_id {lit_string(project_id)}; "
            f"$s isa voice_session, has voice_session_id {lit_string(doc_id)}; "
            "insert (owner_project: $p, voice_session: $s) isa project_has_voice_session;"
        )
        insert_relation_query(
            ctx,
            stats,
            "automation_voice_bot_sessions",
            doc_id,
            relation_query,
            {"voice_session_id": doc_id, "project_id": project_id},
            exists_query=(
                f"match $p isa project, has project_id {lit_string(project_id)}; "
                f"$s isa voice_session, has voice_session_id {lit_string(doc_id)}; "
                "(owner_project: $p, voice_session: $s) isa project_has_voice_session; limit 1;"
            ),
        )

    return for_each_doc(ctx, "automation_voice_bot_sessions", handler)


def ingest_voice_messages(ctx: IngestContext) -> CollectionStats:
    def handler(doc: dict[str, Any], stats: CollectionStats) -> None:
        doc_id = normalize_id(doc.get("_id"))
        if not doc_id:
            stats.skipped += 1
            ctx.deadletter.write(
                {
                    "collection": "automation_voice_bot_messages",
                    "source_id": None,
                    "reason": "missing_id",
                    "payload": doc,
                }
            )
            return

        raw_transcript = as_string(doc.get("transcription_text"))
        capped_transcript = (
            truncate_utf8_to_bytes(raw_transcript, VOICE_TRANSCRIPT_MAX_BYTES)
            if raw_transcript is not None
            else None
        )
        summary_text = (
            truncate_utf8_to_bytes(capped_transcript, TYPEDB_SAFE_STRING_BYTES)
            if capped_transcript is not None
            else None
        )

        fields = ["insert $m isa voice_message", f"has voice_message_id {lit_string(doc_id)}"]
        append_string_attr(fields, "source_type", as_string(doc.get("source_type")))
        append_string_attr(fields, "summary", summary_text)
        append_string_attr(fields, "status", normalize_status_from_bool(doc.get("is_finalized")))
        query = f"{', '.join(fields)};"
        insert_query(
            ctx,
            stats,
            "automation_voice_bot_messages",
            doc_id,
            query,
            {"_id": doc_id},
            entity="voice_message",
            key_attr="voice_message_id",
            key_value=doc_id,
        )

        if raw_transcript is not None and capped_transcript is not None and raw_transcript != capped_transcript:
            ctx.deadletter.write(
                {
                    "collection": "automation_voice_bot_messages",
                    "source_id": doc_id,
                    "reason": "transcript_capped_to_1mb",
                    "payload": {
                        "original_bytes": utf8_byte_length(raw_transcript),
                        "capped_bytes": utf8_byte_length(capped_transcript),
                    },
                }
            )

        if capped_transcript is not None and utf8_byte_length(capped_transcript) > TYPEDB_SAFE_STRING_BYTES:
            chunks = split_utf8_by_bytes(capped_transcript, VOICE_TRANSCRIPT_CHUNK_BYTES)
            for index, chunk in enumerate(chunks, start=1):
                chunk_id = f"{doc_id}:chunk:{index:05d}"
                chunk_entity_query = (
                    f"insert $c isa transcript_chunk, has transcript_chunk_id {lit_string(chunk_id)}, "
                    f"has summary {lit_string(chunk)};"
                )
                insert_relation_query(
                    ctx,
                    stats,
                    "automation_voice_bot_messages",
                    doc_id,
                    chunk_entity_query,
                    {
                        "voice_message_id": doc_id,
                        "transcript_chunk_id": chunk_id,
                        "chunk_index": index,
                    },
                    exists_query=(
                        f"match $c isa transcript_chunk, has transcript_chunk_id {lit_string(chunk_id)}; "
                        "limit 1;"
                    ),
                )

                chunk_relation_query = (
                    f"match $m isa voice_message, has voice_message_id {lit_string(doc_id)}; "
                    f"$c isa transcript_chunk, has transcript_chunk_id {lit_string(chunk_id)}; "
                    "insert (voice_message: $m, transcript_chunk: $c) isa voice_message_chunked_as_transcript_chunk;"
                )
                insert_relation_query(
                    ctx,
                    stats,
                    "automation_voice_bot_messages",
                    doc_id,
                    chunk_relation_query,
                    {
                        "voice_message_id": doc_id,
                        "transcript_chunk_id": chunk_id,
                        "chunk_index": index,
                    },
                    exists_query=(
                        f"match $m isa voice_message, has voice_message_id {lit_string(doc_id)}; "
                        f"$c isa transcript_chunk, has transcript_chunk_id {lit_string(chunk_id)}; "
                        "(voice_message: $m, transcript_chunk: $c) isa voice_message_chunked_as_transcript_chunk; limit 1;"
                    ),
                )

        session_id = normalize_id(doc.get("session_id"))
        if not session_id:
            return

        relation_query = (
            f"match $s isa voice_session, has voice_session_id {lit_string(session_id)}; "
            f"$m isa voice_message, has voice_message_id {lit_string(doc_id)}; "
            "insert (voice_session: $s, voice_message: $m) isa voice_session_has_message;"
        )
        insert_relation_query(
            ctx,
            stats,
            "automation_voice_bot_messages",
            doc_id,
            relation_query,
            {"voice_message_id": doc_id, "voice_session_id": session_id},
            exists_query=(
                f"match $s isa voice_session, has voice_session_id {lit_string(session_id)}; "
                f"$m isa voice_message, has voice_message_id {lit_string(doc_id)}; "
                "(voice_session: $s, voice_message: $m) isa voice_session_has_message; limit 1;"
            ),
        )

    return for_each_doc(ctx, "automation_voice_bot_messages", handler)


def ingest_forecasts(ctx: IngestContext) -> CollectionStats:
    def handler(doc: dict[str, Any], stats: CollectionStats) -> None:
        project_id = normalize_id(doc.get("project_id"))
        month = as_string(doc.get("month"))
        forecast_version = normalize_id(doc.get("forecast_version_id")) or "unknown"

        if not project_id or not month:
            stats.skipped += 1
            ctx.deadletter.write(
                {
                    "collection": "forecasts_project_month",
                    "source_id": None,
                    "reason": "missing_project_or_month",
                    "payload": doc,
                }
            )
            return

        synthetic_id = f"{forecast_version}:{project_id}:{month}"
        fields = [
            "insert $f isa forecast_project_month",
            f"has forecast_project_month_id {lit_string(synthetic_id)}",
            f"has forecast_version_id {lit_string(forecast_version)}",
            f"has project_id {lit_string(project_id)}",
            f"has month_key {lit_string(month)}",
        ]

        append_string_attr(fields, "currency", as_string(doc.get("forecast_currency")))
        append_number_attr(fields, "amount_original", as_number(doc.get("forecast_amount_original")))
        append_number_attr(fields, "amount_rub", as_number(doc.get("forecast_amount_rub")))
        append_number_attr(fields, "row_version", as_number(doc.get("row_version")))

        query = f"{', '.join(fields)};"
        insert_query(
            ctx,
            stats,
            "forecasts_project_month",
            synthetic_id,
            query,
            {"project_id": project_id, "month": month, "forecast_version_id": forecast_version},
            entity="forecast_project_month",
            key_attr="forecast_project_month_id",
            key_value=synthetic_id,
        )

        relation_query = (
            f"match $p isa project, has project_id {lit_string(project_id)}; "
            f"$f isa forecast_project_month, has forecast_project_month_id {lit_string(synthetic_id)}; "
            "insert (owner_project: $p, forecast_project_month: $f) isa project_has_forecast_month;"
        )
        insert_relation_query(
            ctx,
            stats,
            "forecasts_project_month",
            synthetic_id,
            relation_query,
            {"project_id": project_id, "forecast_project_month_id": synthetic_id},
            exists_query=(
                f"match $p isa project, has project_id {lit_string(project_id)}; "
                f"$f isa forecast_project_month, has forecast_project_month_id {lit_string(synthetic_id)}; "
                "(owner_project: $p, forecast_project_month: $f) isa project_has_forecast_month; limit 1;"
            ),
        )

    return for_each_doc(ctx, "forecasts_project_month", handler)


def ingest_expense_categories(ctx: IngestContext) -> CollectionStats:
    def handler(doc: dict[str, Any], stats: CollectionStats) -> None:
        doc_id = normalize_id(doc.get("category_id")) or normalize_id(doc.get("_id"))
        if not doc_id:
            stats.skipped += 1
            ctx.deadletter.write(
                {
                    "collection": "finops_expense_categories",
                    "source_id": None,
                    "reason": "missing_id",
                    "payload": doc,
                }
            )
            return

        fields = ["insert $c isa cost_category", f"has cost_category_id {lit_string(doc_id)}"]
        append_string_attr(fields, "name", as_string(doc.get("name")))
        append_string_attr(fields, "status", normalize_status_from_bool(doc.get("is_active")))
        query = f"{', '.join(fields)};"
        insert_query(
            ctx,
            stats,
            "finops_expense_categories",
            doc_id,
            query,
            {"category_id": doc_id},
            entity="cost_category",
            key_attr="cost_category_id",
            key_value=doc_id,
        )

    return for_each_doc(ctx, "finops_expense_categories", handler)


def ingest_expense_operations(ctx: IngestContext) -> CollectionStats:
    def handler(doc: dict[str, Any], stats: CollectionStats) -> None:
        doc_id = normalize_id(doc.get("operation_id")) or normalize_id(doc.get("_id"))
        if not doc_id:
            stats.skipped += 1
            ctx.deadletter.write(
                {
                    "collection": "finops_expense_operations",
                    "source_id": None,
                    "reason": "missing_id",
                    "payload": doc,
                }
            )
            return

        fields = ["insert $e isa cost_expense", f"has cost_expense_id {lit_string(doc_id)}"]
        append_string_attr(fields, "project_id", normalize_id(doc.get("project_id")))
        append_string_attr(fields, "month_key", as_string(doc.get("month")))
        append_string_attr(fields, "currency", as_string(doc.get("currency")))
        append_number_attr(fields, "amount_original", as_number(doc.get("amount")))
        append_number_attr(fields, "amount_rub", as_number(doc.get("amount")))
        append_string_attr(fields, "status", normalize_status_from_bool(doc.get("is_deleted")))
        append_string_attr(fields, "runtime_tag", as_string(doc.get("runtime_tag")))
        query = f"{', '.join(fields)};"
        insert_query(
            ctx,
            stats,
            "finops_expense_operations",
            doc_id,
            query,
            {"operation_id": doc_id},
            entity="cost_expense",
            key_attr="cost_expense_id",
            key_value=doc_id,
        )

        category_id = normalize_id(doc.get("category_id"))
        if category_id:
            rel_category_query = (
                f"match $c isa cost_category, has cost_category_id {lit_string(category_id)}; "
                f"$e isa cost_expense, has cost_expense_id {lit_string(doc_id)}; "
                "insert (cost_category: $c, cost_expense: $e) isa cost_category_classifies_expense;"
            )
            insert_relation_query(
                ctx,
                stats,
                "finops_expense_operations",
                doc_id,
                rel_category_query,
                {"cost_expense_id": doc_id, "category_id": category_id},
                exists_query=(
                    f"match $c isa cost_category, has cost_category_id {lit_string(category_id)}; "
                    f"$e isa cost_expense, has cost_expense_id {lit_string(doc_id)}; "
                    "(cost_category: $c, cost_expense: $e) isa cost_category_classifies_expense; limit 1;"
                ),
            )

        project_id = normalize_id(doc.get("project_id"))
        if project_id:
            rel_project_query = (
                f"match $p isa project, has project_id {lit_string(project_id)}; "
                f"$e isa cost_expense, has cost_expense_id {lit_string(doc_id)}; "
                "insert (owner_project: $p, cost_expense: $e) isa project_has_cost_expense;"
            )
            insert_relation_query(
                ctx,
                stats,
                "finops_expense_operations",
                doc_id,
                rel_project_query,
                {"cost_expense_id": doc_id, "project_id": project_id},
                exists_query=(
                    f"match $p isa project, has project_id {lit_string(project_id)}; "
                    f"$e isa cost_expense, has cost_expense_id {lit_string(doc_id)}; "
                    "(owner_project: $p, cost_expense: $e) isa project_has_cost_expense; limit 1;"
                ),
            )

    return for_each_doc(ctx, "finops_expense_operations", handler)


def ingest_fx_rates(ctx: IngestContext) -> CollectionStats:
    def handler(doc: dict[str, Any], stats: CollectionStats) -> None:
        month = as_string(doc.get("month"))
        pair = as_string(doc.get("pair"))
        if not month or not pair:
            stats.skipped += 1
            ctx.deadletter.write(
                {
                    "collection": "finops_fx_rates",
                    "source_id": None,
                    "reason": "missing_month_or_pair",
                    "payload": doc,
                }
            )
            return

        synthetic_id = f"{month}:{pair}"
        fields = [
            "insert $fx isa fx_monthly",
            f"has fx_monthly_id {lit_string(synthetic_id)}",
            f"has month_key {lit_string(month)}",
            f"has currency {lit_string(pair)}",
        ]
        append_number_attr(fields, "value_number", as_number(doc.get("rate")))
        query = f"{', '.join(fields)};"
        insert_query(
            ctx,
            stats,
            "finops_fx_rates",
            synthetic_id,
            query,
            {"month": month, "pair": pair},
            entity="fx_monthly",
            key_attr="fx_monthly_id",
            key_value=synthetic_id,
        )

    return for_each_doc(ctx, "finops_fx_rates", handler)


def load_mapping_by_collection(path: pathlib.Path) -> dict[str, dict[str, Any]]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    collections = payload.get("collections") or []
    by_collection: dict[str, dict[str, Any]] = {}
    for item in collections:
        name = item.get("collection")
        if isinstance(name, str) and name:
            by_collection[name] = item
    return by_collection


def parse_schema_metadata(
    schema_path: pathlib.Path,
) -> tuple[
    dict[str, str],
    dict[str, set[str]],
    dict[str, list[str]],
    dict[tuple[str, str], set[str]],
]:
    text = schema_path.read_text(encoding="utf-8")

    attr_types: dict[str, str] = {}
    for match in re.finditer(r"^attribute\s+([a-zA-Z0-9_]+),\s+value\s+([a-zA-Z0-9_]+);", text, flags=re.M):
        attr_types[match.group(1)] = match.group(2)

    relation_roles: dict[str, list[str]] = {}
    current_relation: Optional[str] = None
    current_roles: list[str] = []

    entity_owned_attrs: dict[str, set[str]] = {}
    entity_relation_roles: dict[tuple[str, str], set[str]] = {}
    current_entity: Optional[str] = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("entity "):
            current_entity = line.split()[1].rstrip(",")
            continue

        if current_entity is not None and line.startswith("plays "):
            match = re.match(r"plays\s+([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)", line)
            if match:
                relation_name, role_name = match.group(1), match.group(2)
                entity_relation_roles.setdefault((current_entity, relation_name), set()).add(role_name)
        if current_entity is not None and line.startswith("owns "):
            attr_name = line.split()[1].rstrip(",;")
            if attr_name:
                entity_owned_attrs.setdefault(current_entity, set()).add(attr_name)
        if current_entity is not None and line.endswith(";"):
            current_entity = None

        if line.startswith("relation "):
            current_relation = line.split()[1].rstrip(",")
            current_roles = []
            continue
        if current_relation is not None and line.startswith("relates "):
            current_roles.append(line.split()[1].rstrip(",;"))
            if line.endswith(";"):
                relation_roles[current_relation] = list(current_roles)
                current_relation = None
                current_roles = []

    return attr_types, entity_owned_attrs, relation_roles, entity_relation_roles


def build_key_from_mapping(doc: dict[str, Any], key_cfg: dict[str, Any]) -> Optional[str]:
    from_field = key_cfg.get("from")
    if isinstance(from_field, str) and from_field:
        return mapping_key_component(doc.get(from_field))

    compose_fields = key_cfg.get("compose")
    if isinstance(compose_fields, list) and compose_fields:
        parts: list[str] = []
        for field in compose_fields:
            if not isinstance(field, str) or not field:
                return None
            part = mapping_key_component(doc.get(field))
            if part is None:
                return None
            parts.append(part)
        return ":".join(parts)

    return None


def append_mapped_attr(
    parts: list[str],
    attr: str,
    attr_type: str,
    raw_value: Any,
) -> None:
    if attr_type == "string":
        append_string_attr(parts, attr, to_stringish(raw_value))
        return
    if attr_type == "double":
        append_number_attr(parts, attr, as_number(raw_value))
        return
    if attr_type == "integer":
        numeric = as_number(raw_value)
        append_number_attr(parts, attr, int(numeric) if numeric is not None else None)
        return
    if attr_type == "boolean":
        append_bool_attr(parts, attr, as_bool(raw_value))
        return
    if attr_type == "datetime":
        append_datetime_attr(parts, attr, as_datetime(raw_value))
        return


def resolve_relation_roles_for_entities(
    ctx: IngestContext,
    relation_name: str,
    source_entity: str,
    owner_entity: str,
    owner_role_hint: Optional[str],
) -> Optional[tuple[str, str]]:
    source_roles = set(ctx.entity_relation_roles.get((source_entity, relation_name), set()))
    owner_roles = set(ctx.entity_relation_roles.get((owner_entity, relation_name), set()))
    declared_roles = list(ctx.relation_roles.get(relation_name, []))

    if len(source_roles) == 1 and len(owner_roles) == 1:
        return next(iter(source_roles)), next(iter(owner_roles))

    if len(source_roles) == 1 and declared_roles:
        source_role = next(iter(source_roles))
        owner_role = next((role for role in declared_roles if role != source_role), None)
        if owner_role:
            return source_role, owner_role

    if len(owner_roles) == 1 and declared_roles:
        owner_role = next(iter(owner_roles))
        source_role = next((role for role in declared_roles if role != owner_role), None)
        if source_role:
            return source_role, owner_role

    if owner_role_hint and len(declared_roles) == 2 and owner_role_hint in declared_roles:
        source_role = next((role for role in declared_roles if role != owner_role_hint), None)
        if source_role:
            return source_role, owner_role_hint

    if len(declared_roles) == 2:
        return declared_roles[0], declared_roles[1]

    return None


def ingest_collection_from_mapping(ctx: IngestContext, collection: str) -> CollectionStats:
    mapping_cfg = ctx.mapping_by_collection.get(collection)
    if mapping_cfg is None:
        raise ValueError(f"Collection is not defined in mapping: {collection}")

    target_entity = mapping_cfg.get("target_entity")
    key_cfg = mapping_cfg.get("key") or {}
    attributes_cfg = mapping_cfg.get("attributes") or {}
    relations_cfg = mapping_cfg.get("relations") or []

    if not isinstance(target_entity, str) or not target_entity:
        raise ValueError(f"Mapping for {collection} has no target_entity")
    if not isinstance(key_cfg, dict):
        raise ValueError(f"Mapping for {collection} has invalid key config")

    key_attr = key_cfg.get("attribute")
    if not isinstance(key_attr, str) or not key_attr:
        raise ValueError(f"Mapping for {collection} has invalid key attribute")

    def handler(doc: dict[str, Any], stats: CollectionStats) -> None:
        source_id = build_key_from_mapping(doc, key_cfg)
        if source_id is None:
            stats.skipped += 1
            ctx.deadletter.write(
                {
                    "collection": collection,
                    "source_id": None,
                    "reason": "missing_key",
                    "payload": doc,
                }
            )
            return

        fields = [f"insert $e isa {target_entity}", f"has {key_attr} {lit_string(source_id)}"]
        owned_attrs = ctx.entity_owned_attrs.get(target_entity, set())
        if isinstance(attributes_cfg, dict):
            for attr, source_field in attributes_cfg.items():
                if not isinstance(attr, str) or not isinstance(source_field, str):
                    continue
                if attr not in owned_attrs:
                    continue
                attr_type = ctx.schema_attr_types.get(attr)
                if not attr_type:
                    continue
                append_mapped_attr(fields, attr, attr_type, doc.get(source_field))

        query = f"{', '.join(fields)};"
        insert_query(
            ctx,
            stats,
            collection,
            source_id,
            query,
            {"_id": source_id},
            entity=target_entity,
            key_attr=key_attr,
            key_value=source_id,
        )

        if not isinstance(relations_cfg, list):
            return

        for rel_cfg in relations_cfg:
            if not isinstance(rel_cfg, dict):
                continue
            relation_name = rel_cfg.get("relation")
            owner_lookup = rel_cfg.get("owner_lookup") or {}
            owner_role_hint = rel_cfg.get("owner_role")
            if not isinstance(relation_name, str) or not relation_name:
                continue
            if not isinstance(owner_lookup, dict):
                continue

            owner_entity = owner_lookup.get("entity")
            owner_by = owner_lookup.get("by")
            owner_from = owner_lookup.get("from")
            if not isinstance(owner_entity, str) or not owner_entity:
                continue
            if not isinstance(owner_by, str) or not owner_by:
                continue
            if not isinstance(owner_from, str) or not owner_from:
                continue

            owner_value = mapping_key_component(doc.get(owner_from))
            if owner_value is None:
                continue

            roles = resolve_relation_roles_for_entities(
                ctx=ctx,
                relation_name=relation_name,
                source_entity=target_entity,
                owner_entity=owner_entity,
                owner_role_hint=owner_role_hint if isinstance(owner_role_hint, str) else None,
            )
            if roles is None:
                stats.relation_failed += 1
                ctx.deadletter.write(
                    {
                        "collection": collection,
                        "source_id": source_id,
                        "reason": "relation_roles_unresolved",
                        "payload": {
                            "relation": relation_name,
                            "source_entity": target_entity,
                            "owner_entity": owner_entity,
                            "owner_role_hint": owner_role_hint,
                        },
                    }
                )
                continue

            source_role, owner_role = roles

            relation_query = (
                f"match $e isa {target_entity}, has {key_attr} {lit_string(source_id)}; "
                f"$o isa {owner_entity}, has {owner_by} {lit_string(owner_value)}; "
                f"insert ({source_role}: $e, {owner_role}: $o) isa {relation_name};"
            )
            exists_query = (
                f"match $e isa {target_entity}, has {key_attr} {lit_string(source_id)}; "
                f"$o isa {owner_entity}, has {owner_by} {lit_string(owner_value)}; "
                f"({source_role}: $e, {owner_role}: $o) isa {relation_name}; limit 1;"
            )
            insert_relation_query(
                ctx,
                stats,
                collection,
                source_id,
                relation_query,
                {
                    "source_id": source_id,
                    "relation": relation_name,
                    "owner_entity": owner_entity,
                    "owner_by": owner_by,
                    "owner_value": owner_value,
                },
                exists_query=exists_query,
            )

    return for_each_doc(ctx, collection, handler)


def init_typedb(options: CliOptions) -> Any:
    driver = TypeDB.driver(
        options.typedb_primary_address,
        Credentials(options.typedb_username, options.typedb_password),
        DriverOptions(is_tls_enabled=options.typedb_tls_enabled),
    )

    exists = driver.databases.contains(options.typedb_database)
    if not exists:
        driver.databases.create(options.typedb_database)
        print(f"[typedb-ontology-ingest] created database: {options.typedb_database}")

    if not exists or options.init_schema:
        schema = options.schema_path.read_text(encoding="utf-8")
        execute_query_in_transaction(driver, options.typedb_database, TransactionType.SCHEMA, schema)
        print(f"[typedb-ontology-ingest] schema loaded from {options.schema_path}")

    return driver


INGESTERS: dict[str, Callable[[IngestContext], CollectionStats]] = {
    "automation_customers": ingest_customers,
    "automation_projects": ingest_projects,
    "automation_tasks": ingest_tasks,
    "automation_voice_bot_sessions": ingest_voice_sessions,
    "automation_voice_bot_messages": ingest_voice_messages,
    "forecasts_project_month": ingest_forecasts,
    "finops_expense_categories": ingest_expense_categories,
    "finops_expense_operations": ingest_expense_operations,
    "finops_fx_rates": ingest_fx_rates,
}


def main() -> int:
    load_dotenv()
    options = parse_options(parse_args())
    mapping_by_collection = load_mapping_by_collection(options.mapping_path)
    missing_from_mapping = [collection for collection in options.collections if collection not in mapping_by_collection]
    if missing_from_mapping:
        print(
            f"[typedb-ontology-ingest] failed: missing collections in mapping "
            f"{', '.join(missing_from_mapping)}",
            file=sys.stderr,
        )
        return 1
    (
        schema_attr_types,
        entity_owned_attrs,
        relation_roles,
        entity_relation_roles,
    ) = parse_schema_metadata(options.schema_path)

    print(
        f"[typedb-ontology-ingest] mode={'apply' if options.apply else 'dry-run'} "
        f"addresses={','.join(options.typedb_addresses)} db={options.typedb_database} "
        f"limit={options.limit if options.limit is not None else 'none'} "
        f"collections={','.join(options.collections)}"
    )

    deadletter = DeadletterWriter(options.deadletter_path)
    mongo_client = MongoClient(resolve_mongo_uri())
    typedb_driver = None

    try:
        db = mongo_client[resolve_db_name()]

        if options.apply:
            typedb_driver = init_typedb(options)

        ctx = IngestContext(
            db=db,
            typedb_driver=typedb_driver,
            options=options,
            deadletter=deadletter,
            mapping_by_collection=mapping_by_collection,
            schema_attr_types=schema_attr_types,
            entity_owned_attrs=entity_owned_attrs,
            relation_roles=relation_roles,
            entity_relation_roles=entity_relation_roles,
        )
        stats: list[CollectionStats] = []

        for collection in options.collections:
            start = time.time()
            ingester = INGESTERS.get(collection)
            if ingester is not None:
                result = ingester(ctx)
            else:
                result = ingest_collection_from_mapping(ctx, collection)
            duration_ms = int((time.time() - start) * 1000)
            print(
                f"[typedb-ontology-ingest] done {collection}: scanned={result.scanned} "
                f"inserted={result.inserted} failed={result.failed} "
                f"rel_inserted={result.relations_inserted} rel_failed={result.relation_failed} "
                f"rel_skipped={result.relations_skipped} "
                f"duration_ms={duration_ms}"
            )
            stats.append(result)

        print_stats(stats)
        print(f"[typedb-ontology-ingest] deadletter={deadletter.path}")
        return 0
    except Exception as error:
        print(f"[typedb-ontology-ingest] failed: {error}", file=sys.stderr)
        return 1
    finally:
        try:
            mongo_client.close()
        except Exception:
            pass
        if typedb_driver is not None:
            try:
                typedb_driver.close()
            except Exception:
                pass
        deadletter.close()


if __name__ == "__main__":
    raise SystemExit(main())
