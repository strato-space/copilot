#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import sys
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.database import Database
from typedb.driver import Credentials, DriverOptions, TransactionType, TypeDB

SUPPORTED_COLLECTIONS = [
    "automation_customers",
    "automation_projects",
    "automation_tasks",
    "automation_voice_bot_sessions",
    "automation_voice_bot_messages",
    "forecasts_project_month",
    "finops_expense_categories",
    "finops_expense_operations",
    "finops_fx_rates",
]

TYPEDB_SAFE_STRING_BYTES = 60_000
VOICE_TRANSCRIPT_MAX_BYTES = 1_048_576
VOICE_TRANSCRIPT_CHUNK_BYTES = 60_000


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


@dataclass
class CollectionStats:
    collection: str
    scanned: int = 0
    inserted: int = 0
    failed: int = 0
    skipped: int = 0
    relations_inserted: int = 0
    relation_failed: int = 0


@dataclass
class IngestContext:
    db: Database
    typedb_driver: Any
    options: CliOptions
    deadletter: "DeadletterWriter"


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
        default="./logs/typedb-ontology-ingest-deadletter.ndjson",
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
        default="../ontology/typedb/schema/str_opsportal_v1.tql",
        help="Path to TypeQL schema",
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


def append_string_attr(parts: list[str], attr: str, value: Optional[str]) -> None:
    if value is None:
        return
    parts.append(f"has {attr} {lit_string(value)}")


def append_number_attr(parts: list[str], attr: str, value: Optional[float]) -> None:
    if value is None:
        return
    parts.append(f"has {attr} {lit_number(value)}")


def print_stats(stats: list[CollectionStats]) -> None:
    print("")
    print("[typedb-ontology-ingest] summary")
    for item in stats:
        print(
            f"  - {item.collection}: scanned={item.scanned} inserted={item.inserted} "
            f"failed={item.failed} skipped={item.skipped} rel_inserted={item.relations_inserted} "
            f"rel_failed={item.relation_failed}"
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


def insert_query(
    ctx: IngestContext,
    stats: CollectionStats,
    collection: str,
    source_id: Optional[str],
    query: str,
    payload: Any,
) -> None:
    if not ctx.options.apply or ctx.typedb_driver is None:
        stats.inserted += 1
        return

    try:
        execute_query_in_transaction(ctx.typedb_driver, ctx.options.typedb_database, TransactionType.WRITE, query)
        stats.inserted += 1
    except Exception as error:
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


def insert_relation_query(
    ctx: IngestContext,
    stats: CollectionStats,
    collection: str,
    source_id: Optional[str],
    query: str,
    payload: Any,
) -> None:
    if not ctx.options.apply or ctx.typedb_driver is None:
        stats.relations_inserted += 1
        return

    try:
        execute_query_in_transaction(ctx.typedb_driver, ctx.options.typedb_database, TransactionType.WRITE, query)
        stats.relations_inserted += 1
    except Exception as error:
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
        insert_query(ctx, stats, "automation_customers", doc_id, query, {"_id": doc_id})

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
        insert_query(ctx, stats, "automation_projects", doc_id, query, {"_id": doc_id})

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
        insert_query(ctx, stats, "automation_tasks", doc_id, query, {"_id": doc_id})

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
        insert_query(ctx, stats, "automation_voice_bot_sessions", doc_id, query, {"_id": doc_id})

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
        insert_query(ctx, stats, "automation_voice_bot_messages", doc_id, query, {"_id": doc_id})

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
        insert_query(ctx, stats, "finops_fx_rates", synthetic_id, query, {"month": month, "pair": pair})

    return for_each_doc(ctx, "finops_fx_rates", handler)


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

        ctx = IngestContext(db=db, typedb_driver=typedb_driver, options=options, deadletter=deadletter)
        stats: list[CollectionStats] = []

        for collection in options.collections:
            start = time.time()
            result = INGESTERS[collection](ctx)
            duration_ms = int((time.time() - start) * 1000)
            print(
                f"[typedb-ontology-ingest] done {collection}: scanned={result.scanned} "
                f"inserted={result.inserted} failed={result.failed} "
                f"rel_inserted={result.relations_inserted} rel_failed={result.relation_failed} "
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
