#!/usr/bin/env python3
import argparse
import os
import sys
from dataclasses import dataclass
from typing import Callable, Optional

from dotenv import load_dotenv
from typedb.driver import Credentials, DriverOptions, TransactionType, TypeDB


@dataclass
class AggregateCheck:
    name: str
    query: str
    warn_if: Optional[Callable[[int], bool]] = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate TypeDB ontology ingestion")
    parser.add_argument("--typedb-addresses", type=str, default=None)
    parser.add_argument("--typedb-username", type=str, default=None)
    parser.add_argument("--typedb-password", type=str, default=None)
    parser.add_argument("--typedb-database", type=str, default=None)
    parser.add_argument("--typedb-tls-enabled", type=str, default=None)
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


CHECKS = [
    AggregateCheck("projects_total", "match $p isa project; reduce $count = count;"),
    AggregateCheck("tasks_total", "match $t isa oper_task; reduce $count = count;"),
    AggregateCheck("voice_sessions_total", "match $s isa voice_session; reduce $count = count;"),
    AggregateCheck("voice_messages_total", "match $m isa voice_message; reduce $count = count;"),
    AggregateCheck("voice_history_steps_total", "match $h isa history_step; reduce $count = count;"),
    AggregateCheck("voice_session_merge_logs_total", "match $l isa voice_session_merge_log; reduce $count = count;"),
    AggregateCheck("forecast_rows_total", "match $f isa forecast_project_month; reduce $count = count;"),
    AggregateCheck(
        "orphan_tasks_without_project",
        "match $t isa oper_task; not { (owner_project: $p, oper_task: $t) isa project_has_oper_task; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
    AggregateCheck(
        "orphan_messages_without_session",
        "match $m isa voice_message; not { (voice_session: $s, voice_message: $m) isa voice_session_has_message; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
    AggregateCheck(
        "orphan_forecasts_without_project",
        "match $f isa forecast_project_month; not { (owner_project: $p, forecast_project_month: $f) isa project_has_forecast_month; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
    AggregateCheck(
        "orphan_history_steps_without_session",
        "match $h isa history_step; not { (voice_session: $s, history_step: $h) isa voice_session_has_history_step; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
    AggregateCheck(
        "orphan_session_merge_logs_without_target_session",
        "match $l isa voice_session_merge_log; not { (target_session: $s, merge_log: $l) isa voice_session_has_merge_log; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
    AggregateCheck(
        "sessions_missing_runtime_tag",
        "match $s isa voice_session; not { $s has runtime_tag $rt; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
    AggregateCheck(
        "messages_missing_runtime_tag",
        "match $m isa voice_message; not { $m has runtime_tag $rt; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
    AggregateCheck(
        "merge_logs_missing_runtime_tag",
        "match $l isa voice_session_merge_log; not { $l has runtime_tag $rt; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
    AggregateCheck(
        "sessions_pending_anchor_without_message",
        "match $s isa voice_session, has pending_image_anchor_message_id $anchor_id; not { $m isa voice_message, has voice_message_id $anchor_id; (voice_session: $s, voice_message: $m) isa voice_session_has_message; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
    AggregateCheck(
        "messages_with_missing_image_anchor_parent",
        "match $m isa voice_message, has image_anchor_message_id $anchor_id; not { $a isa voice_message, has voice_message_id $anchor_id; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
    AggregateCheck(
        "session_done_contract_missing_done_at",
        "match $s isa voice_session, has is_active false, has to_finalize true; not { $s has done_at $done; }; reduce $count = count;",
        warn_if=lambda value: value > 0,
    ),
]


def extract_count(answer: any) -> int:
    if not answer.is_concept_rows():
        return 0

    rows = list(answer.as_concept_rows().iterator)
    if not rows:
        return 0

    first_row = rows[0]
    for column in list(first_row.column_names()):
        concept = first_row.get(column)
        if concept is None or not concept.is_value():
            continue
        value = concept.as_value()
        if value.is_integer():
            return int(value.get_integer())
        if value.is_double():
            return int(value.get_double())
        if value.is_decimal():
            try:
                return int(value.get_decimal())
            except Exception:
                continue
        if value.is_string():
            text = value.get_string().strip()
            if not text:
                continue
            try:
                return int(float(text))
            except ValueError:
                continue

    return 0


def run_count(driver: any, database: str, query: str) -> int:
    tx = driver.transaction(database, TransactionType.READ)
    try:
        answer = tx.query(query).resolve()
        return extract_count(answer)
    finally:
        try:
            tx.close()
        except Exception:
            pass


def main() -> int:
    load_dotenv()
    args = parse_args()

    addresses = parse_typedb_addresses(
        args.typedb_addresses or os.getenv("TYPEDB_ADDRESSES") or "127.0.0.1:1729"
    )
    if len(addresses) > 1:
        print(
            f"[typedb-ontology-validate] warning: Python gRPC driver uses a single address. "
            f"Using first address: {addresses[0]}",
            file=sys.stderr,
        )

    typedb_username = args.typedb_username or os.getenv("TYPEDB_USERNAME") or "admin"
    typedb_password = args.typedb_password or os.getenv("TYPEDB_PASSWORD") or "password"
    typedb_database = args.typedb_database or os.getenv("TYPEDB_DATABASE") or "str_opsportal_v1"
    typedb_tls_enabled = parse_bool(args.typedb_tls_enabled or os.getenv("TYPEDB_TLS_ENABLED"), default=False)

    print(f"[typedb-ontology-validate] addresses={','.join(addresses)} db={typedb_database}")

    try:
        driver = TypeDB.driver(
            addresses[0],
            Credentials(typedb_username, typedb_password),
            DriverOptions(is_tls_enabled=typedb_tls_enabled),
        )

        if not driver.databases.contains(typedb_database):
            raise RuntimeError(f"TypeDB database does not exist: {typedb_database}")

        for check in CHECKS:
            value = run_count(driver, typedb_database, check.query)
            is_warn = bool(check.warn_if(value)) if check.warn_if else False
            level = "WARN" if is_warn else "OK"
            print(f"[typedb-ontology-validate] {level} {check.name}={value}")

        driver.close()
        return 0
    except Exception as error:
        print(f"[typedb-ontology-validate] failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
