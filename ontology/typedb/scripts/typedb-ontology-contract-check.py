#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from pymongo import MongoClient

SCRIPT_DIR = Path(__file__).resolve().parent
INGEST_SCRIPT = SCRIPT_DIR / 'typedb-ontology-ingest.py'

spec = importlib.util.spec_from_file_location('typedb_ontology_ingest_module', INGEST_SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError(f'Cannot load ingest helpers from {INGEST_SCRIPT}')
ingest = importlib.util.module_from_spec(spec)
sys.modules['typedb_ontology_ingest_module'] = ingest
spec.loader.exec_module(ingest)


@dataclass
class Issue:
    level: str
    collection: str
    kind: str
    detail: str


SPARSE_OPTIONAL_FIELDS: dict[str, set[str]] = {
    "automation_projects": {"created_at", "description", "end_date", "git_repo", "runtime_tag"},
    "automation_task_types_tree": {"execution_plan", "parent_type_id", "roles", "task_id"},
    "automation_performers": {"is_banned"},
    "automation_tasks": {
        "assignee",
        "codex_review_approval_card_cancel_callback",
        "codex_review_approval_card_chat_id",
        "codex_review_approval_card_message_id",
        "codex_review_approval_card_sent_at",
    },
    "automation_work_hours": {"result_link"},
    "automation_voice_bot_sessions": {"allowed_users", "done_count", "error_message", "error_message_id", "error_source"},
    "automation_voice_bot_messages": {
        "attachments",
        "categorization_attempts",
        "categorization_error",
        "categorization_error_message",
        "categorization_error_timestamp",
    },
    "automation_voice_bot_session_log": {"correlation_id", "project_id", "runtime_tag"},
    "automation_voice_bot_session_merge_log": {"error_message"},
    "forecasts_project_month": {"amount_original", "comment", "currency", "fx_used"},
    "finops_expense_operations": {"comment", "fx_used", "project_id"},
    "finops_expense_operations_log": {"before_payload", "comment"},
}

SPARSE_OPTIONAL_RELATION_LOOKUPS: dict[str, set[str]] = {
    "automation_task_types_tree": {"task_type_tree_classifies_oper_task <- task_id"},
    "automation_tasks": {
        "oper_task_assigned_to_performer_profile <- performer_id",
        "oper_task_classified_as_task_type <- task_type_id",
        "voice_session_sources_oper_task <- source_ref",
    },
    "finops_expense_operations": {"project_has_cost_expense <- project_id"},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Validate MongoDB documents against TypeDB schema/mapping without importing data')
    parser.add_argument('--collections', type=str, default=None, help='Comma-separated collection list')
    parser.add_argument('--limit', type=int, default=None, help='Limit docs per collection')
    parser.add_argument('--schema', type=str, default=str(ingest.DEFAULT_SCHEMA_PATH), help='Path to generated TypeQL schema')
    parser.add_argument('--mapping', type=str, default=str(ingest.DEFAULT_MAPPING_PATH), help='Path to MongoDB->TypeDB mapping YAML')
    parser.add_argument('--sample-errors', type=int, default=5, help='Max examples per issue type')
    return parser.parse_args()


def iter_docs(db: Any, collection: str, limit: Optional[int]):
    cursor = db[collection].find({})
    if limit is not None:
        cursor = cursor.limit(limit)
    for raw_doc in cursor:
        yield dict(raw_doc)


def add_issue(issues: list[Issue], level: str, collection: str, kind: str, detail: str, seen: set[tuple[str, str, str]], max_per_kind: int, counters: dict[tuple[str, str], int]) -> None:
    key = (collection, kind, detail)
    if key in seen:
        return
    bucket = (collection, kind)
    if counters[bucket] >= max_per_kind:
        return
    seen.add(key)
    counters[bucket] += 1
    issues.append(Issue(level=level, collection=collection, kind=kind, detail=detail))


def classify_issue_level(collection: str, kind: str, detail: str) -> str:
    if kind == "path_unresolved_all_docs":
        field_name = detail.split(" <- ", 1)[0]
        if field_name in SPARSE_OPTIONAL_FIELDS.get(collection, set()):
            return "INFO"
    if kind == "relation_lookup_unresolved_all_docs":
        detail_key = detail.split(" unresolved", 1)[0]
        if detail_key in SPARSE_OPTIONAL_RELATION_LOOKUPS.get(collection, set()):
            return "INFO"
    return "WARN"


def main() -> int:
    ingest.load_operator_env()
    args = parse_args()
    schema_path = Path(args.schema).resolve()
    mapping_path = Path(args.mapping).resolve()
    ingest.maybe_build_generated_schema(schema_path)
    mapping_by_collection = ingest.load_mapping_by_collection(mapping_path)
    (
        schema_attr_types,
        entity_owned_attrs,
        relation_roles,
        entity_relation_roles,
    ) = ingest.parse_schema_metadata(schema_path)

    if args.collections:
        collections = [c.strip() for c in args.collections.split(',') if c.strip()]
    else:
        collections = list(mapping_by_collection.keys())

    mongo = MongoClient(ingest.resolve_mongo_uri())
    db = mongo[ingest.resolve_db_name()]
    issues: list[Issue] = []
    seen: set[tuple[str, str, str]] = set()
    counters: dict[tuple[str, str], int] = defaultdict(int)
    total_scanned = 0
    t0 = time.time()

    for collection in collections:
        cfg = mapping_by_collection.get(collection)
        if cfg is None:
            add_issue(issues, 'ERROR', collection, 'missing_mapping', 'Collection missing from mapping file', seen, args.sample_errors, counters)
            continue
        target_entity = cfg.get('target_entity')
        if not isinstance(target_entity, str) or not target_entity:
            add_issue(issues, 'ERROR', collection, 'missing_target_entity', 'Mapping has no valid target_entity', seen, args.sample_errors, counters)
            continue
        if target_entity not in entity_owned_attrs:
            add_issue(issues, 'ERROR', collection, 'unknown_entity', f'target_entity {target_entity!r} not found in schema', seen, args.sample_errors, counters)
            continue

        attributes_cfg = cfg.get('attributes') or {}
        coalesce_cfg = cfg.get('coalesce') or {}
        relations_cfg = cfg.get('relations') or []

        for attr in attributes_cfg.keys():
            if attr not in schema_attr_types:
                add_issue(issues, 'ERROR', collection, 'schema_attr_missing', f'attribute {attr!r} not declared in schema', seen, args.sample_errors, counters)
            elif attr not in entity_owned_attrs.get(target_entity, set()):
                add_issue(issues, 'ERROR', collection, 'entity_ownership_missing', f'entity {target_entity!r} does not own attribute {attr!r}', seen, args.sample_errors, counters)

        for rel_cfg in relations_cfg:
            relation_name = rel_cfg.get('relation') if isinstance(rel_cfg, dict) else None
            owner_lookup = rel_cfg.get('owner_lookup') if isinstance(rel_cfg, dict) else None
            owner_role_hint = rel_cfg.get('owner_role') if isinstance(rel_cfg, dict) else None
            if not isinstance(relation_name, str) or relation_name not in relation_roles:
                add_issue(issues, 'ERROR', collection, 'relation_missing', f'relation {relation_name!r} not declared in schema', seen, args.sample_errors, counters)
                continue
            if not isinstance(owner_lookup, dict):
                add_issue(issues, 'ERROR', collection, 'owner_lookup_missing', f'relation {relation_name!r} has no valid owner_lookup', seen, args.sample_errors, counters)
                continue
            owner_entity = owner_lookup.get('entity')
            owner_by = owner_lookup.get('by')
            owner_from = owner_lookup.get('from')
            owner_transform = owner_lookup.get('transform')
            if not isinstance(owner_entity, str) or owner_entity not in entity_owned_attrs:
                add_issue(issues, 'ERROR', collection, 'owner_entity_missing', f'owner entity {owner_entity!r} for relation {relation_name!r} not found in schema', seen, args.sample_errors, counters)
            if not isinstance(owner_by, str) or owner_by not in schema_attr_types:
                add_issue(issues, 'ERROR', collection, 'owner_attr_missing', f'owner lookup attr {owner_by!r} for relation {relation_name!r} not declared in schema', seen, args.sample_errors, counters)
            if isinstance(owner_transform, str) and owner_transform not in ingest.LOOKUP_TRANSFORMS:
                add_issue(issues, 'ERROR', collection, 'unknown_lookup_transform', f'lookup transform {owner_transform!r} is not implemented', seen, args.sample_errors, counters)
            roles = ingest.resolve_relation_roles_for_entities(
                ctx=type('Ctx', (), {'entity_relation_roles': entity_relation_roles, 'relation_roles': relation_roles})(),
                relation_name=relation_name,
                source_entity=target_entity,
                owner_entity=owner_entity if isinstance(owner_entity, str) else '',
                owner_role_hint=owner_role_hint if isinstance(owner_role_hint, str) else None,
            )
            if roles is None:
                add_issue(issues, 'ERROR', collection, 'relation_roles_unresolved', f'relation roles unresolved for {target_entity!r} -> {owner_entity!r} in {relation_name!r}', seen, args.sample_errors, counters)
            if not isinstance(owner_from, str) or not owner_from:
                add_issue(issues, 'ERROR', collection, 'owner_source_missing', f'owner lookup source missing for relation {relation_name!r}', seen, args.sample_errors, counters)

        scanned = 0
        sample_missing_paths: dict[str, int] = defaultdict(int)
        sample_empty_relation_keys: dict[str, int] = defaultdict(int)
        for doc in iter_docs(db, collection, args.limit):
            scanned += 1
            total_scanned += 1
            for attr, source_field in attributes_cfg.items():
                if not isinstance(source_field, str):
                    continue
                coalesce_fields = coalesce_cfg.get(attr) if isinstance(coalesce_cfg, dict) else None
                value = ingest.resolve_mapped_value(doc, source_field, coalesce_fields if isinstance(coalesce_fields, list) else None)
                if value is None:
                    sample_missing_paths[f'{attr} <- {source_field}'] += 1
            for rel_cfg in relations_cfg:
                if not isinstance(rel_cfg, dict):
                    continue
                relation_name = rel_cfg.get('relation')
                owner_lookup = rel_cfg.get('owner_lookup') or {}
                owner_from = owner_lookup.get('from') if isinstance(owner_lookup, dict) else None
                owner_transform = owner_lookup.get('transform') if isinstance(owner_lookup, dict) else None
                if not isinstance(relation_name, str) or not isinstance(owner_from, str):
                    continue
                resolved = ingest.apply_lookup_transform(owner_transform if isinstance(owner_transform, str) else None, ingest.resolve_doc_path(doc, owner_from))
                if resolved is None:
                    sample_empty_relation_keys[f'{relation_name} <- {owner_from}'] += 1

        for desc, count in sorted(sample_missing_paths.items()):
            if count == scanned and scanned > 0:
                detail = f'{desc} unresolved in all {scanned} scanned docs'
                add_issue(issues, classify_issue_level(collection, 'path_unresolved_all_docs', detail), collection, 'path_unresolved_all_docs', detail, seen, args.sample_errors, counters)
        for desc, count in sorted(sample_empty_relation_keys.items()):
            if count == scanned and scanned > 0:
                detail = f'{desc} unresolved in all {scanned} scanned docs'
                add_issue(issues, classify_issue_level(collection, 'relation_lookup_unresolved_all_docs', detail), collection, 'relation_lookup_unresolved_all_docs', detail, seen, args.sample_errors, counters)

        print(f'[typedb-ontology-contract-check] checked {collection}: scanned={scanned}')

    mongo.close()

    errors = [i for i in issues if i.level == 'ERROR']
    warns = [i for i in issues if i.level == 'WARN']
    infos = [i for i in issues if i.level == 'INFO']
    print(f'[typedb-ontology-contract-check] collections={len(collections)} scanned={total_scanned} errors={len(errors)} warnings={len(warns)} infos={len(infos)} duration_ms={int((time.time()-t0)*1000)}')
    for issue in issues:
        print(f'[{issue.level}] {issue.collection} :: {issue.kind} :: {issue.detail}')
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
