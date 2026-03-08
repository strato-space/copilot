#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import re
import subprocess
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
    "automation_voice_bot_session_merge_log",
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
DEFAULT_SCHEMA_PATH = TYPEDB_ROOT_DIR / "schema" / "str-ontology.tql"
DEFAULT_MAPPING_PATH = TYPEDB_ROOT_DIR / "mappings" / "mongodb_to_typedb_v1.yaml"
DEFAULT_DEADLETTER_PATH = TYPEDB_ROOT_DIR / "logs" / "typedb-ontology-ingest-deadletter.ndjson"
DEFAULT_SYNC_STATE_PATH = TYPEDB_ROOT_DIR / "logs" / "typedb-ontology-sync-state.json"
SCHEMA_BUILD_SCRIPT = SCRIPT_DIR / "build-typedb-schema.py"
INCREMENTAL_COLLECTIONS = {
    # Stage-1 incremental scope is intentionally narrow until true
    # update/reconcile semantics are implemented for mutable collections.
    "automation_projects",
    "automation_tasks",
    "automation_voice_bot_sessions",
    "automation_voice_bot_messages",
}

TOMBSTONE_RELATIONS: dict[str, set[str]] = {
    "automation_tasks": {
        "project_has_oper_task",
        "voice_session_sources_oper_task",
        "oper_task_classified_as_task_type",
        "oper_task_assigned_to_person",
    },
    "automation_voice_bot_sessions": {
        "project_has_voice_session",
    },
    "automation_voice_bot_messages": {
        "voice_session_has_message",
        "voice_message_chunked_as_transcript_chunk",
    },
}


@dataclass
class CliOptions:
    apply: bool
    init_schema: bool
    sync_mode: str
    limit: Optional[int]
    collections: list[str]
    deadletter_path: pathlib.Path
    sync_state_path: pathlib.Path
    reset_sync_state: bool
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
    sync_state: dict[str, Any]


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
    parser.add_argument(
        "--sync-mode",
        choices=["full", "incremental"],
        default="full",
        help="Choose full scan or incremental sync mode",
    )
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
    parser.add_argument(
        "--sync-state",
        type=str,
        default=str(DEFAULT_SYNC_STATE_PATH),
        help="Path to sync state JSON for incremental mode",
    )
    parser.add_argument("--reset-sync-state", action="store_true", help="Reset stored incremental sync state")
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

    options = CliOptions(
        apply=bool(args.apply),
        init_schema=bool(args.init_schema),
        sync_mode=args.sync_mode,
        limit=args.limit,
        collections=collections,
        deadletter_path=pathlib.Path(args.deadletter).resolve(),
        sync_state_path=pathlib.Path(args.sync_state).resolve(),
        reset_sync_state=bool(args.reset_sync_state),
        typedb_addresses=addresses,
        typedb_primary_address=addresses[0],
        typedb_username=args.typedb_username or os.getenv("TYPEDB_USERNAME") or "admin",
        typedb_password=args.typedb_password or os.getenv("TYPEDB_PASSWORD") or "password",
        typedb_tls_enabled=parse_bool(args.typedb_tls_enabled or os.getenv("TYPEDB_TLS_ENABLED"), default=False),
        typedb_database=args.typedb_database or os.getenv("TYPEDB_DATABASE") or "str_opsportal_v1",
        schema_path=pathlib.Path(args.schema).resolve(),
        mapping_path=pathlib.Path(args.mapping).resolve(),
    )
    maybe_build_generated_schema(options.schema_path)
    return options


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


def normalize_deletion_state_from_bool(value: Any) -> str:
    bool_value = as_bool(value)
    if bool_value is None:
        return "unknown"
    return "deleted" if bool_value else "present"


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
        if value.tzinfo is not None and value.utcoffset() is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        normalized = text.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is not None and parsed.utcoffset() is not None:
                return parsed.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed
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


def to_capped_stringish(value: Any, max_bytes: int = TYPEDB_SAFE_STRING_BYTES) -> Optional[str]:
    text = to_stringish(value)
    if text is None:
        return None
    if utf8_byte_length(text) <= max_bytes:
        return text
    return truncate_utf8_to_bytes(text, max_bytes)


def mapping_key_component(value: Any) -> Optional[str]:
    return normalize_id(value) or to_stringish(value)


def canonical_voice_ref_to_session_id(value: Any) -> Optional[str]:
    raw = mapping_key_component(value)
    if raw is None:
        return None
    if re.fullmatch(r"[0-9a-f]{24}", raw):
        return raw
    for pattern in (
        r"/voice/session/([0-9a-f]{24})(?:[/?#].*)?$",
        r"/session/([0-9a-f]{24})(?:[/?#].*)?$",
    ):
        match = re.search(pattern, raw)
        if match:
            return match.group(1)
    return None


LOOKUP_TRANSFORMS: dict[str, Callable[[Any], Optional[str]]] = {
    "canonical_voice_ref_to_session_id": canonical_voice_ref_to_session_id,
}


def apply_lookup_transform(name: Optional[str], value: Any) -> Optional[str]:
    if not name:
        return mapping_key_component(value)
    transform = LOOKUP_TRANSFORMS.get(name)
    if transform is None:
        raise ValueError(f"Unsupported lookup transform: {name}")
    return transform(value)


def maybe_build_generated_schema(schema_path: pathlib.Path) -> None:
    if schema_path.name != "str-ontology.tql":
        return
    if not SCHEMA_BUILD_SCRIPT.exists():
        return
    subprocess.run([sys.executable, str(SCHEMA_BUILD_SCRIPT)], check=True)


def print_stats(stats: list[CollectionStats]) -> None:
    print("")
    print("[typedb-ontology-ingest] summary")
    for item in stats:
        print(
            f"  - {item.collection}: scanned={item.scanned} inserted={item.inserted} "
            f"failed={item.failed} skipped={item.skipped} rel_inserted={item.relations_inserted} "
            f"rel_failed={item.relation_failed} rel_skipped={item.relations_skipped}"
        )


def load_sync_state(path: pathlib.Path, reset: bool = False) -> dict[str, Any]:
    if reset or not path.exists():
        return {"collections": {}}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance(payload.get("collections"), dict):
            return payload
    except Exception:
        pass
    return {"collections": {}}


def save_sync_state(path: pathlib.Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is not None and parsed.utcoffset() is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        return None


def build_collection_query(ctx: IngestContext, collection: str) -> dict[str, Any]:
    if ctx.options.sync_mode != "incremental" or collection not in INCREMENTAL_COLLECTIONS:
        return {}
    collection_state = ctx.sync_state.get("collections", {}).get(collection, {})
    if not isinstance(collection_state, dict):
        return {}

    clauses: list[dict[str, Any]] = []
    last_updated_at = parse_iso_datetime(collection_state.get("last_seen_updated_at"))
    if last_updated_at is not None:
        clauses.append({"updated_at": {"$gt": last_updated_at}})

    last_created_at = parse_iso_datetime(collection_state.get("last_seen_created_at"))
    if last_created_at is not None:
        clauses.append({"created_at": {"$gt": last_created_at}})

    last_object_id = collection_state.get("last_seen_object_id")
    if isinstance(last_object_id, str):
        try:
            clauses.append({"_id": {"$gt": ObjectId(last_object_id)}})
        except Exception:
            pass

    if not clauses:
        return {}
    if len(clauses) == 1:
        return clauses[0]
    return {"$or": clauses}


def is_tombstoned_doc(collection: str, doc: dict[str, Any]) -> bool:
    if collection in TOMBSTONE_RELATIONS:
        deleted = as_bool(doc.get("is_deleted"))
        return deleted is True
    return False


def update_sync_state_for_doc(ctx: IngestContext, collection: str, doc: dict[str, Any]) -> None:
    collections = ctx.sync_state.setdefault("collections", {})
    collection_state = collections.setdefault(collection, {})

    updated_at = as_datetime(doc.get("updated_at"))
    created_at = as_datetime(doc.get("created_at"))
    object_id = normalize_id(doc.get("_id"))

    if updated_at is not None:
        previous = parse_iso_datetime(collection_state.get("last_seen_updated_at"))
        if previous is None or updated_at > previous:
            collection_state["last_seen_updated_at"] = updated_at.isoformat()

    if created_at is not None:
        previous = parse_iso_datetime(collection_state.get("last_seen_created_at"))
        if previous is None or created_at > previous:
            collection_state["last_seen_created_at"] = created_at.isoformat()

    if object_id is not None:
        collection_state["last_seen_object_id"] = object_id


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


def delete_query_if_exists(driver: Any, database: str, match_query: str, delete_query: str) -> None:
    if not query_has_rows(driver, database, match_query):
        return
    execute_query_in_transaction(driver, database, TransactionType.WRITE, delete_query)


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


def literal_for_attr_value(attr: str, attr_type: str, raw_value: Any) -> Optional[str]:
    if attr_type == "string":
        if attr == "activity_state":
            bool_status = as_bool(raw_value)
            desired_value = normalize_status_from_bool(bool_status) if bool_status is not None else to_stringish(raw_value)
        elif attr == "deletion_state":
            bool_status = as_bool(raw_value)
            desired_value = normalize_deletion_state_from_bool(bool_status) if bool_status is not None else to_stringish(raw_value)
        else:
            desired_value = to_stringish(raw_value)
        return lit_string(desired_value) if desired_value is not None else None
    if attr_type == "double":
        numeric = as_number(raw_value)
        return lit_number(numeric) if numeric is not None else None
    if attr_type == "integer":
        numeric = as_number(raw_value)
        return lit_number(int(numeric)) if numeric is not None else None
    if attr_type == "boolean":
        boolean = as_bool(raw_value)
        return lit_bool(boolean) if boolean is not None else None
    if attr_type == "datetime":
        dt = as_datetime(raw_value)
        return lit_datetime(dt) if dt is not None else None
    return None


def reconcile_owned_attribute(
    ctx: IngestContext,
    *,
    entity: str,
    key_attr: str,
    key_value: str,
    attr: str,
    desired_literal: Optional[str],
) -> None:
    if not ctx.options.apply or ctx.typedb_driver is None:
        return
    match_existing = (
        f"match $e isa {entity}, has {key_attr} {lit_string(key_value)}, has {attr} $v; limit 1;"
    )
    delete_existing = (
        f"match $e isa {entity}, has {key_attr} {lit_string(key_value)}, has {attr} $v; "
        f"delete has $v of $e;"
    )
    delete_query_if_exists(ctx.typedb_driver, ctx.options.typedb_database, match_existing, delete_existing)
    if desired_literal is None:
        return
    insert_query = (
        f"match $e isa {entity}, has {key_attr} {lit_string(key_value)}; "
        f"insert $e has {attr} {desired_literal};"
    )
    execute_query_in_transaction(ctx.typedb_driver, ctx.options.typedb_database, TransactionType.WRITE, insert_query)


def reconcile_relation(
    ctx: IngestContext,
    *,
    relation_name: str,
    source_entity: str,
    source_key_attr: str,
    source_key_value: str,
    source_role: str,
    owner_entity: str,
    owner_by: str,
    owner_role: str,
    owner_value: Optional[str],
) -> None:
    if not ctx.options.apply or ctx.typedb_driver is None:
        return

    match_existing = (
        f"match $e isa {source_entity}, has {source_key_attr} {lit_string(source_key_value)}; "
        f"$r isa {relation_name}, links ({source_role}: $e, {owner_role}: $o); limit 1;"
    )
    delete_existing = (
        f"match $e isa {source_entity}, has {source_key_attr} {lit_string(source_key_value)}; "
        f"$r isa {relation_name}, links ({source_role}: $e, {owner_role}: $o); "
        f"delete $r;"
    )
    delete_query_if_exists(ctx.typedb_driver, ctx.options.typedb_database, match_existing, delete_existing)

    if owner_value is None:
        return

    insert_relation = (
        f"match $e isa {source_entity}, has {source_key_attr} {lit_string(source_key_value)}; "
        f"$o isa {owner_entity}, has {owner_by} {lit_string(owner_value)}; "
        f"insert ({source_role}: $e, {owner_role}: $o) isa {relation_name};"
    )
    execute_query_in_transaction(ctx.typedb_driver, ctx.options.typedb_database, TransactionType.WRITE, insert_relation)


def upsert_entity(
    ctx: IngestContext,
    *,
    entity: str,
    key_attr: str,
    key_value: str,
    attr_specs: list[tuple[str, str, Any]],
) -> None:
    if not ctx.options.apply or ctx.typedb_driver is None:
        return

    exists_query = f"match $x isa {entity}, has {key_attr} {lit_string(key_value)}; limit 1;"
    if query_has_rows(ctx.typedb_driver, ctx.options.typedb_database, exists_query):
        for attr, attr_type, raw_value in attr_specs:
            reconcile_owned_attribute(
                ctx,
                entity=entity,
                key_attr=key_attr,
                key_value=key_value,
                attr=attr,
                desired_literal=literal_for_attr_value(attr, attr_type, raw_value),
            )
        return

    fields = [f"insert $e isa {entity}", f"has {key_attr} {lit_string(key_value)}"]
    for attr, attr_type, raw_value in attr_specs:
        append_mapped_attr(fields, attr, attr_type, raw_value)
    query = f"{', '.join(fields)};"
    execute_query_in_transaction(ctx.typedb_driver, ctx.options.typedb_database, TransactionType.WRITE, query)


def derive_canonical_voice_session_url(session_id: Optional[str]) -> Optional[str]:
    if not session_id:
        return None
    return f"https://copilot.stratospace.fun/voice/session/{session_id}"


def project_project_context_card(ctx: IngestContext, doc: dict[str, Any], project_id: str) -> None:
    card_id = project_id
    attr_specs = [
        ("project_id", "string", project_id),
        ("name", "string", as_string(doc.get("name"))),
        ("summary", "string", as_string(doc.get("description"))),
        ("activity_state", "string", normalize_status_from_bool(doc.get("is_active"))),
        ("created_at", "datetime", as_datetime(doc.get("created_at"))),
        ("updated_at", "datetime", as_datetime(doc.get("updated_at"))),
    ]
    upsert_entity(
        ctx,
        entity="project_context_card",
        key_attr="project_context_card_id",
        key_value=card_id,
        attr_specs=attr_specs,
    )
    reconcile_relation(
        ctx,
        relation_name="project_context_card_describes_project",
        source_entity="project_context_card",
        source_key_attr="project_context_card_id",
        source_key_value=card_id,
        source_role="project_context_card",
        owner_entity="project",
        owner_by="project_id",
        owner_role="described_project",
        owner_value=project_id,
    )
    reconcile_relation(
        ctx,
        relation_name="as_is_project_maps_to_project_context_card",
        source_entity="project",
        source_key_attr="project_id",
        source_key_value=project_id,
        source_role="as_is_project",
        owner_entity="project_context_card",
        owner_by="project_context_card_id",
        owner_role="project_context_card",
        owner_value=card_id,
    )


def project_oper_task_status_and_priority(ctx: IngestContext, doc: dict[str, Any], task_id: str) -> None:
    status_name = as_string(doc.get("task_status")) or as_string(doc.get("status"))
    if status_name:
        status_id = status_name
        upsert_entity(
            ctx,
            entity="status_dict",
            key_attr="status_id",
            key_value=status_id,
            attr_specs=[
                ("name", "string", status_name),
                ("module_scope", "string", "oper_task"),
            ],
        )
        reconcile_relation(
            ctx,
            relation_name="oper_task_has_status",
            source_entity="oper_task",
            source_key_attr="task_id",
            source_key_value=task_id,
            source_role="oper_task",
            owner_entity="status_dict",
            owner_by="status_id",
            owner_role="task_status",
            owner_value=status_id,
        )

    priority_value = as_number(doc.get("priority"))
    if priority_value is not None:
        priority_rank = int(priority_value)
        priority_id = str(priority_rank)
        upsert_entity(
            ctx,
            entity="priority_dict",
            key_attr="priority_id",
            key_value=priority_id,
            attr_specs=[
                ("name", "string", priority_id),
                ("priority_rank", "integer", priority_rank),
            ],
        )
        reconcile_relation(
            ctx,
            relation_name="oper_task_has_priority",
            source_entity="oper_task",
            source_key_attr="task_id",
            source_key_value=task_id,
            source_role="oper_task",
            owner_entity="priority_dict",
            owner_by="priority_id",
            owner_role="task_priority",
            owner_value=priority_id,
        )


def project_target_task_view(ctx: IngestContext, doc: dict[str, Any], task_id: str) -> None:
    target_id = task_id
    attr_specs = [
        ("project_id", "string", normalize_id(doc.get("project_id"))),
        ("title", "string", as_string(doc.get("name"))),
        ("summary", "string", as_string(doc.get("description"))),
        ("description", "string", as_string(doc.get("description"))),
        ("status", "string", as_string(doc.get("task_status")) or as_string(doc.get("status")) or "unknown"),
        ("priority", "string", to_stringish(doc.get("priority"))),
        ("created_at", "datetime", as_datetime(doc.get("created_at"))),
        ("updated_at", "datetime", as_datetime(doc.get("updated_at"))),
    ]
    upsert_entity(
        ctx,
        entity="target_task_view",
        key_attr="target_task_view_id",
        key_value=target_id,
        attr_specs=attr_specs,
    )
    reconcile_relation(
        ctx,
        relation_name="as_is_oper_task_maps_to_target_task_view",
        source_entity="oper_task",
        source_key_attr="task_id",
        source_key_value=task_id,
        source_role="as_is_oper_task",
        owner_entity="target_task_view",
        owner_by="target_task_view_id",
        owner_role="target_task_view",
        owner_value=target_id,
    )
    if as_string(doc.get("source_kind")) == "voice_possible_task":
        reconcile_relation(
            ctx,
            relation_name="as_is_possible_task_maps_to_target_task_view",
            source_entity="oper_task",
            source_key_attr="task_id",
            source_key_value=task_id,
            source_role="as_is_possible_task",
            owner_entity="target_task_view",
            owner_by="target_task_view_id",
            owner_role="target_task_view",
            owner_value=target_id,
        )


def project_mode_segment(ctx: IngestContext, doc: dict[str, Any], session_id: str) -> None:
    segment_id = session_id
    attr_specs = [
        ("session_id", "string", session_id),
        ("source_ref", "string", derive_canonical_voice_session_url(session_id)),
        ("status", "string", as_string(doc.get("status")) or normalize_status_from_bool(doc.get("is_active"))),
        ("created_at", "datetime", as_datetime(doc.get("created_at"))),
        ("updated_at", "datetime", as_datetime(doc.get("updated_at"))),
    ]
    upsert_entity(
        ctx,
        entity="mode_segment",
        key_attr="mode_segment_id",
        key_value=segment_id,
        attr_specs=attr_specs,
    )
    reconcile_relation(
        ctx,
        relation_name="as_is_voice_session_maps_to_mode_segment",
        source_entity="voice_session",
        source_key_attr="voice_session_id",
        source_key_value=session_id,
        source_role="as_is_voice_session",
        owner_entity="mode_segment",
        owner_by="mode_segment_id",
        owner_role="mode_segment",
        owner_value=segment_id,
    )


def project_object_conclusion_from_session_summary(ctx: IngestContext, doc: dict[str, Any], session_id: str) -> None:
    summary_text = as_string(doc.get("summary_md_text"))
    if not summary_text:
        return
    conclusion_id = f"session-summary:{session_id}"
    project_id = normalize_id(doc.get("project_id"))
    attr_specs = [
        ("summary", "string", truncate_utf8_to_bytes(summary_text, TYPEDB_SAFE_STRING_BYTES)),
        ("description", "string", truncate_utf8_to_bytes(summary_text, TYPEDB_SAFE_STRING_BYTES)),
        ("source_ref", "string", derive_canonical_voice_session_url(session_id)),
        ("status", "string", "active"),
        ("created_at", "datetime", as_datetime(doc.get("created_at"))),
        ("updated_at", "datetime", as_datetime(doc.get("summary_saved_at")) or as_datetime(doc.get("updated_at"))),
    ]
    upsert_entity(
        ctx,
        entity="object_conclusion",
        key_attr="object_conclusion_id",
        key_value=conclusion_id,
        attr_specs=attr_specs,
    )
    reconcile_relation(
        ctx,
        relation_name="as_is_summary_maps_to_object_conclusion",
        source_entity="voice_session",
        source_key_attr="voice_session_id",
        source_key_value=session_id,
        source_role="as_is_summary",
        owner_entity="object_conclusion",
        owner_by="object_conclusion_id",
        owner_role="object_conclusion",
        owner_value=conclusion_id,
    )
    if project_id is not None:
        reconcile_relation(
            ctx,
            relation_name="object_conclusion_applies_to_project_context_card",
            source_entity="object_conclusion",
            source_key_attr="object_conclusion_id",
            source_key_value=conclusion_id,
            source_role="object_conclusion",
            owner_entity="project_context_card",
            owner_by="project_context_card_id",
            owner_role="concluded_project_context_card",
            owner_value=project_id,
        )


def project_object_event(ctx: IngestContext, doc: dict[str, Any], message_id: str) -> None:
    session_id = normalize_id(doc.get("session_id"))
    event_id = message_id
    summary = as_string(doc.get("transcription_text")) or as_string(doc.get("text")) or as_string(doc.get("summary"))
    attr_specs = [
        ("event_time", "datetime", as_datetime(doc.get("updated_at")) or as_datetime(doc.get("created_at"))),
        ("operation_type", "string", as_string(doc.get("message_type")) or as_string(doc.get("type")) or "voice_message"),
        ("source_ref", "string", session_id),
        ("summary", "string", truncate_utf8_to_bytes(summary, TYPEDB_SAFE_STRING_BYTES) if summary else None),
        ("status", "string", as_string(doc.get("status")) or normalize_status_from_bool(doc.get("is_finalized"))),
        ("created_at", "datetime", as_datetime(doc.get("created_at"))),
        ("updated_at", "datetime", as_datetime(doc.get("updated_at"))),
    ]
    upsert_entity(
        ctx,
        entity="object_event",
        key_attr="object_event_id",
        key_value=event_id,
        attr_specs=attr_specs,
    )
    reconcile_relation(
        ctx,
        relation_name="as_is_voice_message_maps_to_object_event",
        source_entity="voice_message",
        source_key_attr="voice_message_id",
        source_key_value=message_id,
        source_role="as_is_voice_message",
        owner_entity="object_event",
        owner_by="object_event_id",
        owner_role="object_event",
        owner_value=event_id,
    )
    if session_id is not None:
        reconcile_relation(
            ctx,
            relation_name="object_event_affects_mode_segment",
            source_entity="object_event",
            source_key_attr="object_event_id",
            source_key_value=event_id,
            source_role="object_event",
            owner_entity="mode_segment",
            owner_by="mode_segment_id",
            owner_role="affected_mode_segment",
            owner_value=session_id,
        )


def project_artifact_record_from_attachment(ctx: IngestContext, doc: dict[str, Any], message_id: str) -> None:
    has_attachment = any(
        doc.get(field)
        for field in ("file_id", "file_name", "file_path", "attachments", "image_anchor_message_id")
    )
    if not has_attachment:
        return
    artifact_id = f"voice-message-attachment:{message_id}"
    project_id = normalize_id(doc.get("project_id"))
    attr_specs = [
        ("project_id", "string", project_id),
        ("source_type", "string", as_string(doc.get("source_type")) or "voice_message_attachment"),
        ("source_ref", "string", message_id),
        ("external_ref", "string", as_string(doc.get("file_path")) or as_string(doc.get("file_id"))),
        ("title", "string", as_string(doc.get("file_name")) or f"attachment:{message_id}"),
        ("summary", "string", as_string(doc.get("file_name")) or as_string(doc.get("mime_type"))),
        ("status", "string", as_string(doc.get("status")) or "active"),
        ("created_at", "datetime", as_datetime(doc.get("created_at"))),
        ("updated_at", "datetime", as_datetime(doc.get("updated_at"))),
    ]
    upsert_entity(
        ctx,
        entity="artifact_record",
        key_attr="artifact_record_id",
        key_value=artifact_id,
        attr_specs=attr_specs,
    )
    reconcile_relation(
        ctx,
        relation_name="as_is_attachment_maps_to_artifact_record",
        source_entity="voice_message",
        source_key_attr="voice_message_id",
        source_key_value=message_id,
        source_role="as_is_attachment",
        owner_entity="artifact_record",
        owner_by="artifact_record_id",
        owner_role="artifact_record",
        owner_value=artifact_id,
    )


def reconcile_transcript_chunks(
    ctx: IngestContext,
    *,
    voice_message_id: str,
    chunks: list[tuple[str, str]],
) -> None:
    if not ctx.options.apply or ctx.typedb_driver is None:
        return
    match_existing = (
        f"match $m isa voice_message, has voice_message_id {lit_string(voice_message_id)}; "
        f"$r isa voice_message_chunked_as_transcript_chunk, links (voice_message: $m, transcript_chunk: $c); "
        f"$c isa transcript_chunk, has transcript_chunk_id $cid; limit 1;"
    )
    delete_existing = (
        f"match $m isa voice_message, has voice_message_id {lit_string(voice_message_id)}; "
        f"$r isa voice_message_chunked_as_transcript_chunk, links (voice_message: $m, transcript_chunk: $c); "
        f"$c isa transcript_chunk, has transcript_chunk_id $cid; "
        f"delete $r; $c;"
    )
    delete_query_if_exists(ctx.typedb_driver, ctx.options.typedb_database, match_existing, delete_existing)

    for chunk_id, chunk_text in chunks:
        insert_chunk = (
            f"insert $c isa transcript_chunk, has transcript_chunk_id {lit_string(chunk_id)}, "
            f"has summary {lit_string(chunk_text)};"
        )
        execute_query_in_transaction(ctx.typedb_driver, ctx.options.typedb_database, TransactionType.WRITE, insert_chunk)
        insert_relation = (
            f"match $m isa voice_message, has voice_message_id {lit_string(voice_message_id)}; "
            f"$c isa transcript_chunk, has transcript_chunk_id {lit_string(chunk_id)}; "
            f"insert (voice_message: $m, transcript_chunk: $c) isa voice_message_chunked_as_transcript_chunk;"
        )
        execute_query_in_transaction(ctx.typedb_driver, ctx.options.typedb_database, TransactionType.WRITE, insert_relation)


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
    query = build_collection_query(ctx, collection)
    cursor = ctx.db[collection].find(query).sort("_id", 1)
    if ctx.options.limit is not None:
        cursor = cursor.limit(ctx.options.limit)

    for raw_doc in cursor:
        doc = dict(raw_doc)
        stats.scanned += 1
        handler(doc, stats)
        update_sync_state_for_doc(ctx, collection, doc)

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
        append_string_attr(fields, "activity_state", normalize_status_from_bool(doc.get("is_active")))
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
        append_string_attr(fields, "activity_state", normalize_status_from_bool(doc.get("is_active")))
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
        project_project_context_card(ctx, doc, doc_id)

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
        project_target_task_view(ctx, doc, doc_id)
        project_oper_task_status_and_priority(ctx, doc, doc_id)

        project_id = None if is_tombstoned_doc("automation_tasks", doc) else normalize_id(doc.get("project_id"))
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
    incremental_reconcile = (
        ctx.options.apply
        and ctx.options.sync_mode == "incremental"
        and "automation_voice_bot_sessions" in INCREMENTAL_COLLECTIONS
        and ctx.typedb_driver is not None
    )

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

        activity_state = normalize_status_from_bool(doc.get("is_active"))
        attr_specs: list[tuple[str, str, Any]] = [
            ("activity_state", "string", activity_state),
            ("source_type", "string", as_string(doc.get("session_source"))),
            ("session_name", "string", as_string(doc.get("session_name"))),
            ("session_type", "string", as_string(doc.get("session_type"))),
            ("project_id", "string", normalize_id(doc.get("project_id"))),
            ("chat_id", "string", to_stringish(doc.get("chat_id"))),
            ("user_id", "string", normalize_id(doc.get("user_id")) or to_stringish(doc.get("user_id"))),
            ("access_level", "string", as_string(doc.get("access_level"))),
            ("done_count", "integer", as_number(doc.get("done_count"))),
            ("is_active", "boolean", as_bool(doc.get("is_active"))),
            ("is_active_legacy", "boolean", as_bool(doc.get("is_active:"))),
            ("is_deleted", "boolean", as_bool(doc.get("is_deleted"))),
            ("is_messages_processed", "boolean", as_bool(doc.get("is_messages_processed"))),
            ("is_waiting", "boolean", as_bool(doc.get("is_waiting"))),
            ("is_corrupted", "boolean", as_bool(doc.get("is_corrupted"))),
            ("is_postprocessing", "boolean", as_bool(doc.get("is_postprocessing"))),
            ("is_finished", "boolean", as_bool(doc.get("is_finished"))),
            ("is_finalized", "boolean", as_bool(doc.get("is_finalized"))),
            ("to_finalize", "boolean", as_bool(doc.get("to_finalize"))),
            ("participants", "string", to_capped_stringish(doc.get("participants"))),
            ("allowed_users", "string", to_capped_stringish(doc.get("allowed_users"))),
            ("processors", "string", to_capped_stringish(doc.get("processors"))),
            ("session_processors", "string", to_capped_stringish(doc.get("session_processors"))),
            ("processors_data", "string", to_capped_stringish(doc.get("processors_data"))),
            ("last_message_id", "string", to_stringish(doc.get("last_message_id"))),
            ("last_message_timestamp", "double", as_number(doc.get("last_message_timestamp"))),
            ("last_voice_timestamp", "double", as_number(doc.get("last_voice_timestamp"))),
            ("postprocessing_job_queued_timestamp", "double", as_number(doc.get("postprocessing_job_queued_timestamp"))),
            ("title_generated_at", "datetime", as_datetime(doc.get("title_generated_at"))),
            ("title_generated_by", "string", as_string(doc.get("title_generated_by"))),
            ("finished_at", "datetime", as_datetime(doc.get("finished_at"))),
            ("done_at", "datetime", as_datetime(doc.get("done_at"))),
            ("deleted_at", "datetime", as_datetime(doc.get("deleted_at"))),
            ("deletion_reason", "string", as_string(doc.get("deletion_reason"))),
            (
                "pending_image_anchor_message_id",
                "string",
                normalize_id(doc.get("pending_image_anchor_message_id"))
                or normalize_id(doc.get("pending_image_anchor_oid"))
                or to_stringish(doc.get("pending_image_anchor_message_id"))
                or to_stringish(doc.get("pending_image_anchor_oid")),
            ),
            ("pending_image_anchor_oid", "string", to_stringish(doc.get("pending_image_anchor_oid"))),
            ("pending_image_anchor_created_at", "datetime", as_datetime(doc.get("pending_image_anchor_created_at"))),
            (
                "merged_into_session_id",
                "string",
                normalize_id(doc.get("merged_into_session_id")) or to_stringish(doc.get("merged_into_session_id")),
            ),
            ("error_source", "string", as_string(doc.get("error_source"))),
            ("transcription_error", "string", as_string(doc.get("transcription_error"))),
            ("error_message", "string", to_capped_stringish(doc.get("error_message"))),
            ("error_message_id", "string", normalize_id(doc.get("error_message_id"))),
            ("error_timestamp", "datetime", as_datetime(doc.get("error_timestamp"))),
            ("current_spreadsheet_file_id", "string", as_string(doc.get("current_spreadsheet_file_id"))),
            ("summary_md_text", "string", as_string(doc.get("summary_md_text"))),
            ("summary_saved_at", "datetime", as_datetime(doc.get("summary_saved_at"))),
            ("summary_correlation_id", "string", as_string(doc.get("summary_correlation_id"))),
            ("runtime_tag", "string", as_string(doc.get("runtime_tag"))),
            ("updated_at", "datetime", as_datetime(doc.get("updated_at"))),
            ("created_at", "datetime", as_datetime(doc.get("created_at"))),
        ]

        if incremental_reconcile and ctx.typedb_driver is not None:
            exists_query = f"match $x isa voice_session, has voice_session_id {lit_string(doc_id)}; limit 1;"
            if query_has_rows(ctx.typedb_driver, ctx.options.typedb_database, exists_query):
                for attr, attr_type, raw_value in attr_specs:
                    reconcile_owned_attribute(
                        ctx,
                        entity="voice_session",
                        key_attr="voice_session_id",
                        key_value=doc_id,
                        attr=attr,
                        desired_literal=literal_for_attr_value(attr, attr_type, raw_value),
                    )
                stats.skipped += 1
            else:
                fields = ["insert $s isa voice_session", f"has voice_session_id {lit_string(doc_id)}"]
                for attr, attr_type, raw_value in attr_specs:
                    append_mapped_attr(fields, attr, attr_type, raw_value)
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
        else:
            fields = ["insert $s isa voice_session", f"has voice_session_id {lit_string(doc_id)}"]
            for attr, attr_type, raw_value in attr_specs:
                append_mapped_attr(fields, attr, attr_type, raw_value)
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
        project_mode_segment(ctx, doc, doc_id)
        project_object_conclusion_from_session_summary(ctx, doc, doc_id)

        project_id = None if is_tombstoned_doc("automation_voice_bot_sessions", doc) else normalize_id(doc.get("project_id"))
        if not project_id:
            return

        if incremental_reconcile:
            reconcile_relation(
                ctx,
                relation_name="project_has_voice_session",
                source_entity="voice_session",
                source_key_attr="voice_session_id",
                source_key_value=doc_id,
                source_role="voice_session",
                owner_entity="project",
                owner_by="project_id",
                owner_role="owner_project",
                owner_value=project_id,
            )
            if project_id is None:
                stats.relations_skipped += 1
            else:
                stats.relations_inserted += 1
        else:
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
    incremental_reconcile = (
        ctx.options.apply
        and ctx.options.sync_mode == "incremental"
        and "automation_voice_bot_messages" in INCREMENTAL_COLLECTIONS
        and ctx.typedb_driver is not None
    )

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
        resolved_session_id = normalize_id(doc.get("session_id"))

        attr_specs: list[tuple[str, str, Any]] = [
            ("source_type", "string", as_string(doc.get("source_type"))),
            ("session_id", "string", resolved_session_id),
            ("session_type", "string", as_string(doc.get("session_type"))),
            ("message_type", "string", as_string(doc.get("message_type")) or as_string(doc.get("type"))),
            ("message_id", "string", to_stringish(doc.get("message_id"))),
            ("chat_id", "string", to_stringish(doc.get("chat_id"))),
            ("speaker", "string", as_string(doc.get("speaker"))),
            ("file_id", "string", as_string(doc.get("file_id"))),
            ("file_hash", "string", as_string(doc.get("file_hash"))),
            ("hash_sha256", "string", as_string(doc.get("hash_sha256"))),
            ("file_unique_id", "string", as_string(doc.get("file_unique_id"))),
            ("file_path", "string", as_string(doc.get("file_path"))),
            ("file_name", "string", as_string(doc.get("file_name"))),
            ("file_size", "double", as_number(doc.get("file_size"))),
            ("mime_type", "string", as_string(doc.get("mime_type"))),
            ("file_metadata", "string", to_capped_stringish(doc.get("file_metadata"))),
            ("attachments", "string", to_capped_stringish(doc.get("attachments"))),
            ("duration", "double", as_number(doc.get("duration"))),
            ("text", "string", to_capped_stringish(doc.get("text"))),
            ("message_timestamp", "double", as_number(doc.get("message_timestamp"))),
            ("timestamp", "double", as_number(doc.get("timestamp"))),
            ("transcribe_timestamp", "double", as_number(doc.get("transcribe_timestamp"))),
            ("is_transcribed", "boolean", as_bool(doc.get("is_transcribed"))),
            ("transcription_method", "string", as_string(doc.get("transcription_method"))),
            ("transcription", "string", to_capped_stringish(doc.get("transcription"))),
            ("transcription_text", "string", summary_text),
            ("transcription_provider", "string", as_string(resolve_doc_path(doc, "transcription.provider"))),
            ("transcription_model", "string", as_string(resolve_doc_path(doc, "transcription.model"))),
            ("transcription_schema_version", "integer", as_number(resolve_doc_path(doc, "transcription.schema_version"))),
            ("transcription_raw", "string", to_capped_stringish(doc.get("transcription_raw"))),
            ("task", "string", as_string(doc.get("task"))),
            ("categorization", "string", to_capped_stringish(doc.get("categorization"))),
            ("categorization_timestamp", "double", as_number(doc.get("categorization_timestamp"))),
            ("categorization_error", "string", as_string(doc.get("categorization_error"))),
            ("categorization_error_message", "string", to_capped_stringish(doc.get("categorization_error_message"))),
            ("categorization_error_timestamp", "datetime", as_datetime(doc.get("categorization_error_timestamp"))),
            ("categorization_retry_reason", "string", as_string(doc.get("categorization_retry_reason"))),
            ("categorization_next_attempt_at", "datetime", as_datetime(doc.get("categorization_next_attempt_at"))),
            ("categorization_attempts", "integer", as_number(doc.get("categorization_attempts"))),
            ("transcription_error", "string", as_string(doc.get("transcription_error"))),
            ("transcription_error_context", "string", to_capped_stringish(doc.get("transcription_error_context"))),
            ("error_message", "string", to_capped_stringish(doc.get("error_message"))),
            ("error_message_id", "string", normalize_id(doc.get("error_message_id")) or to_stringish(doc.get("error_message_id"))),
            ("error_timestamp", "datetime", as_datetime(doc.get("error_timestamp"))),
            ("dedup_replaced_by", "string", normalize_id(doc.get("dedup_replaced_by")) or to_stringish(doc.get("dedup_replaced_by"))),
            ("dedup_reason", "string", as_string(doc.get("dedup_reason"))),
            ("processors_data", "string", to_capped_stringish(doc.get("processors_data"))),
            ("summary", "string", summary_text),
            ("is_finalized", "boolean", as_bool(doc.get("is_finalized"))),
            ("is_deleted", "boolean", as_bool(doc.get("is_deleted"))),
            ("is_image_anchor", "boolean", as_bool(doc.get("is_image_anchor"))),
            ("image_anchor_message_id", "string", normalize_id(doc.get("image_anchor_message_id")) or to_stringish(doc.get("image_anchor_message_id"))),
            ("image_anchor_linked_at", "datetime", as_datetime(doc.get("image_anchor_linked_at"))),
            ("to_transcribe", "boolean", as_bool(doc.get("to_transcribe"))),
            ("uploaded_by", "string", normalize_id(doc.get("uploaded_by"))),
            ("user_id", "string", normalize_id(doc.get("user_id")) or to_stringish(doc.get("user_id"))),
            ("username", "string", as_string(doc.get("username"))),
            ("runtime_tag", "string", as_string(doc.get("runtime_tag"))),
            ("created_at", "datetime", as_datetime(doc.get("created_at"))),
            ("updated_at", "datetime", as_datetime(doc.get("updated_at"))),
        ]

        if incremental_reconcile and ctx.typedb_driver is not None:
            exists_query = f"match $x isa voice_message, has voice_message_id {lit_string(doc_id)}; limit 1;"
            if query_has_rows(ctx.typedb_driver, ctx.options.typedb_database, exists_query):
                for attr, attr_type, raw_value in attr_specs:
                    reconcile_owned_attribute(
                        ctx,
                        entity="voice_message",
                        key_attr="voice_message_id",
                        key_value=doc_id,
                        attr=attr,
                        desired_literal=literal_for_attr_value(attr, attr_type, raw_value),
                    )
                stats.skipped += 1
            else:
                fields = ["insert $m isa voice_message", f"has voice_message_id {lit_string(doc_id)}"]
                for attr, attr_type, raw_value in attr_specs:
                    append_mapped_attr(fields, attr, attr_type, raw_value)
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
        else:
            fields = ["insert $m isa voice_message", f"has voice_message_id {lit_string(doc_id)}"]
            for attr, attr_type, raw_value in attr_specs:
                append_mapped_attr(fields, attr, attr_type, raw_value)
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
        project_object_event(ctx, doc, doc_id)
        project_artifact_record_from_attachment(ctx, doc, doc_id)

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

        tombstoned = is_tombstoned_doc("automation_voice_bot_messages", doc)
        chunk_pairs: list[tuple[str, str]] = []
        if (not tombstoned) and capped_transcript is not None and utf8_byte_length(capped_transcript) > TYPEDB_SAFE_STRING_BYTES:
            chunks = split_utf8_by_bytes(capped_transcript, VOICE_TRANSCRIPT_CHUNK_BYTES)
            for index, chunk in enumerate(chunks, start=1):
                chunk_id = f"{doc_id}:chunk:{index:05d}"
                chunk_pairs.append((chunk_id, chunk))
        if incremental_reconcile:
            reconcile_transcript_chunks(ctx, voice_message_id=doc_id, chunks=chunk_pairs)
            stats.relations_inserted += len(chunk_pairs)
        else:
            for chunk_id, chunk in chunk_pairs:
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
                    },
                    exists_query=(
                        f"match $m isa voice_message, has voice_message_id {lit_string(doc_id)}; "
                        f"$c isa transcript_chunk, has transcript_chunk_id {lit_string(chunk_id)}; "
                        "(voice_message: $m, transcript_chunk: $c) isa voice_message_chunked_as_transcript_chunk; limit 1;"
                    ),
                )

        session_id = None if tombstoned else resolved_session_id
        if not session_id:
            return

        if incremental_reconcile:
            reconcile_relation(
                ctx,
                relation_name="voice_session_has_message",
                source_entity="voice_message",
                source_key_attr="voice_message_id",
                source_key_value=doc_id,
                source_role="voice_message",
                owner_entity="voice_session",
                owner_by="voice_session_id",
                owner_role="voice_session",
                owner_value=session_id,
            )
            if session_id is None:
                stats.relations_skipped += 1
            else:
                stats.relations_inserted += 1
        else:
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
        append_string_attr(fields, "activity_state", normalize_status_from_bool(doc.get("is_active")))
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
        append_string_attr(fields, "deletion_state", normalize_deletion_state_from_bool(doc.get("is_deleted")))
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


def resolve_doc_path(doc: dict[str, Any], field_path: str) -> Any:
    current: Any = doc
    for part in field_path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
        if current is None:
            return None
    return current


def build_key_from_mapping(doc: dict[str, Any], key_cfg: dict[str, Any]) -> Optional[str]:
    from_field = key_cfg.get("from")
    if isinstance(from_field, str) and from_field:
        return mapping_key_component(resolve_doc_path(doc, from_field))

    compose_fields = key_cfg.get("compose")
    if isinstance(compose_fields, list) and compose_fields:
        parts: list[str] = []
        for field in compose_fields:
            if not isinstance(field, str) or not field:
                return None
            part = mapping_key_component(resolve_doc_path(doc, field))
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
        if attr == "activity_state":
            bool_status = as_bool(raw_value)
            if bool_status is not None:
                append_string_attr(parts, attr, normalize_status_from_bool(bool_status))
                return
        if attr == "deletion_state":
            bool_status = as_bool(raw_value)
            if bool_status is not None:
                append_string_attr(parts, attr, normalize_deletion_state_from_bool(bool_status))
                return
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


def is_non_empty_mapped_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def resolve_mapped_value(
    doc: dict[str, Any],
    default_source_field: str,
    coalesce_fields: Optional[list[str]],
) -> Any:
    if not coalesce_fields:
        return resolve_doc_path(doc, default_source_field)

    for field in coalesce_fields:
        candidate = resolve_doc_path(doc, field)
        if is_non_empty_mapped_value(candidate):
            return candidate
    return None


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
    coalesce_cfg = mapping_cfg.get("coalesce") or {}
    relations_cfg = mapping_cfg.get("relations") or []

    if not isinstance(target_entity, str) or not target_entity:
        raise ValueError(f"Mapping for {collection} has no target_entity")
    if not isinstance(key_cfg, dict):
        raise ValueError(f"Mapping for {collection} has invalid key config")

    key_attr = key_cfg.get("attribute")
    if not isinstance(key_attr, str) or not key_attr:
        raise ValueError(f"Mapping for {collection} has invalid key attribute")

    incremental_reconcile = (
        ctx.options.apply
        and ctx.options.sync_mode == "incremental"
        and collection in INCREMENTAL_COLLECTIONS
    )

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
        desired_attr_literals: list[tuple[str, Optional[str]]] = []
        if isinstance(attributes_cfg, dict):
            for attr, source_field in attributes_cfg.items():
                if not isinstance(attr, str) or not isinstance(source_field, str):
                    continue
                if attr not in owned_attrs:
                    continue
                attr_type = ctx.schema_attr_types.get(attr)
                if not attr_type:
                    continue
                coalesce_fields: Optional[list[str]] = None
                if isinstance(coalesce_cfg, dict):
                    raw_coalesce_fields = coalesce_cfg.get(attr)
                    if isinstance(raw_coalesce_fields, list):
                        coalesce_fields = [
                            field
                            for field in raw_coalesce_fields
                            if isinstance(field, str) and field
                        ]
                raw_value = resolve_mapped_value(doc, source_field, coalesce_fields)
                if attr_type == "string":
                    if attr == "activity_state":
                        bool_status = as_bool(raw_value)
                        desired_value = normalize_status_from_bool(bool_status) if bool_status is not None else to_stringish(raw_value)
                    elif attr == "deletion_state":
                        bool_status = as_bool(raw_value)
                        desired_value = normalize_deletion_state_from_bool(bool_status) if bool_status is not None else to_stringish(raw_value)
                    else:
                        desired_value = to_stringish(raw_value)
                    desired_literal = lit_string(desired_value) if desired_value is not None else None
                elif attr_type == "double":
                    numeric = as_number(raw_value)
                    desired_literal = lit_number(numeric) if numeric is not None else None
                elif attr_type == "integer":
                    numeric = as_number(raw_value)
                    desired_literal = lit_number(int(numeric)) if numeric is not None else None
                elif attr_type == "boolean":
                    boolean = as_bool(raw_value)
                    desired_literal = lit_bool(boolean) if boolean is not None else None
                elif attr_type == "datetime":
                    dt = as_datetime(raw_value)
                    desired_literal = lit_datetime(dt) if dt is not None else None
                else:
                    desired_literal = None
                desired_attr_literals.append((attr, desired_literal))
                append_mapped_attr(fields, attr, attr_type, raw_value)

        if incremental_reconcile and ctx.typedb_driver is not None:
            exists_query = (
                f"match $x isa {target_entity}, has {key_attr} {lit_string(source_id)}; limit 1;"
            )
            if query_has_rows(ctx.typedb_driver, ctx.options.typedb_database, exists_query):
                for attr, desired_literal in desired_attr_literals:
                    reconcile_owned_attribute(
                        ctx,
                        entity=target_entity,
                        key_attr=key_attr,
                        key_value=source_id,
                        attr=attr,
                        desired_literal=desired_literal,
                    )
                stats.skipped += 1
            else:
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
        else:
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

        if collection == "automation_tasks":
            project_oper_task_status_and_priority(ctx, doc, source_id)

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

            owner_transform = owner_lookup.get("transform")
            if owner_transform is not None and not isinstance(owner_transform, str):
                continue

            owner_value = apply_lookup_transform(owner_transform, resolve_doc_path(doc, owner_from))
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

            if incremental_reconcile:
                if is_tombstoned_doc(collection, doc) and relation_name in TOMBSTONE_RELATIONS.get(collection, set()):
                    owner_value = None
                reconcile_relation(
                    ctx,
                    relation_name=relation_name,
                    source_entity=target_entity,
                    source_key_attr=key_attr,
                    source_key_value=source_id,
                    source_role=source_role,
                    owner_entity=owner_entity,
                    owner_by=owner_by,
                    owner_role=owner_role,
                    owner_value=owner_value,
                )
                if owner_value is None:
                    stats.relations_skipped += 1
                else:
                    stats.relations_inserted += 1
            else:
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
    "automation_customers": lambda ctx: ingest_collection_from_mapping(ctx, "automation_customers"),
    "automation_projects": lambda ctx: ingest_collection_from_mapping(ctx, "automation_projects"),
    # Keep automation_tasks strictly mapping-driven to avoid schema/mapping drift.
    "automation_tasks": lambda ctx: ingest_collection_from_mapping(ctx, "automation_tasks"),
    "automation_voice_bot_sessions": ingest_voice_sessions,
    "automation_voice_bot_messages": ingest_voice_messages,
    "forecasts_project_month": lambda ctx: ingest_collection_from_mapping(ctx, "forecasts_project_month"),
    "finops_expense_categories": lambda ctx: ingest_collection_from_mapping(ctx, "finops_expense_categories"),
    "finops_expense_operations": lambda ctx: ingest_collection_from_mapping(ctx, "finops_expense_operations"),
    "finops_fx_rates": lambda ctx: ingest_collection_from_mapping(ctx, "finops_fx_rates"),
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
        f"sync_mode={options.sync_mode} "
        f"addresses={','.join(options.typedb_addresses)} db={options.typedb_database} "
        f"limit={options.limit if options.limit is not None else 'none'} "
        f"collections={','.join(options.collections)}"
    )

    deadletter = DeadletterWriter(options.deadletter_path)
    sync_state = load_sync_state(options.sync_state_path, reset=options.reset_sync_state)
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
            sync_state=sync_state,
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
        if options.apply:
            save_sync_state(options.sync_state_path, ctx.sync_state)
            print(f"[typedb-ontology-ingest] sync_state={options.sync_state_path}")
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
