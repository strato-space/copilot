#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from pymongo import MongoClient


SCRIPT_DIR = Path(__file__).resolve().parent
TYPEDB_ROOT = SCRIPT_DIR.parent
INVENTORY_ROOT = TYPEDB_ROOT / "inventory_latest"
DEFAULT_MAPPING_PATH = TYPEDB_ROOT / "mappings" / "mongodb_to_typedb_v1.yaml"
DEFAULT_OUTPUT_PATH = INVENTORY_ROOT / "entity_sampling_latest.md"
DEFAULT_JSON_OUTPUT_PATH = INVENTORY_ROOT / "entity_sampling_latest.json"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sample Mongo entity documents for ontology verification and TOON examples")
    p.add_argument("--mapping", type=Path, default=DEFAULT_MAPPING_PATH)
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    p.add_argument("--json-output", type=Path, default=DEFAULT_JSON_OUTPUT_PATH)
    p.add_argument("--collections", type=str, default="", help="Comma-separated collection names")
    p.add_argument("--mode", choices=["verify", "toon", "both"], default="both")
    p.add_argument("--verify-limit", type=int, default=20)
    p.add_argument("--toon-limit", type=int, default=3)
    p.add_argument(
        "--toon-columns",
        choices=["mapped", "minimal", "all"],
        default="mapped",
        help="Columns to keep in TOON examples: mapped attrs + relation sources, minimal key+title-ish, or all top-level fields",
    )
    return p.parse_args()


def resolve_mongo() -> tuple[MongoClient, str]:
    mongo_uri = os.getenv("MONGODB_CONNECTION_STRING")
    db_name = os.getenv("DB_NAME")
    if not mongo_uri:
        raise ValueError("MONGODB_CONNECTION_STRING is not set")
    if not db_name:
        raise ValueError("DB_NAME is not set")
    return MongoClient(mongo_uri), db_name


def top_level_keys(doc: dict[str, Any]) -> list[str]:
    return sorted(str(k) for k in doc.keys())


def unique_preserve(seq: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in seq:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def select_toon_fields(collection_cfg: dict[str, Any], mode: str) -> list[str]:
    if mode == "all":
        return []

    key_cfg = collection_cfg.get("key") or {}
    attrs = collection_cfg.get("attributes") or {}
    rels = collection_cfg.get("relations") or []

    key_from = key_cfg.get("from")
    mapped_fields = [src for src in attrs.values() if isinstance(src, str)]
    relation_fields = [rel.get("owner_lookup", {}).get("from") for rel in rels if isinstance(rel.get("owner_lookup", {}).get("from"), str)]

    if mode == "minimal":
        candidates = [
            key_from,
            "name",
            "title",
            "description",
            "status",
            "task_status",
            "project",
            "project_id",
            "performer_id",
            "performer",
            "source",
            "source_kind",
            "source_ref",
            "created_at",
            "updated_at",
        ]
        return unique_preserve([field for field in candidates if isinstance(field, str)])

    return unique_preserve([field for field in [key_from, *mapped_fields, *relation_fields] if isinstance(field, str)])


def trim_doc(doc: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    if not fields:
        return doc
    return {field: doc.get(field) for field in fields}


def render_markdown_table(rows: list[dict[str, Any]]) -> list[str]:
    if not rows:
        return ["| sample | data |", "|---|---|", "| - | _no rows_ |"]
    lines = ["| sample | data |", "|---|---|"]
    for idx, row in enumerate(rows, start=1):
        payload = json.dumps(row, ensure_ascii=False, default=str).replace("\n", "\\n")
        lines.append(f"| {idx} | `{payload}` |")
    return lines


def main() -> int:
    args = parse_args()
    mapping = yaml.safe_load(args.mapping.read_text(encoding="utf-8"))
    client, db_name = resolve_mongo()
    db = client[db_name]

    wanted = {c.strip() for c in args.collections.split(",") if c.strip()}
    collections_cfg = [item for item in mapping.get("collections", []) if not wanted or item["collection"] in wanted]

    md: list[str] = [
        "# Entity Sampling Latest",
        "",
        f"- Generated: {datetime.now(timezone.utc).isoformat()}",
        f"- Mode: `{args.mode}`",
        f"- Verify limit: `{args.verify_limit}`",
        f"- TOON limit: `{args.toon_limit}`",
        f"- TOON columns: `{args.toon_columns}`",
        "",
        "Rules:",
        "- `verify` mode samples full top-level Mongo documents and should be used for ontology/mapping checks.",
        "- `toon` mode samples a reduced, ontology-relevant projection intended for LLM-facing examples.",
        "- Verification should inspect all top-level columns. TOON examples should stay compact and ontology-relevant.",
        "",
    ]

    json_payload: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "verify_limit": args.verify_limit,
        "toon_limit": args.toon_limit,
        "toon_columns": args.toon_columns,
        "collections": {},
    }

    for cfg in collections_cfg:
        coll_name = cfg["collection"]
        target_entity = cfg.get("target_entity")
        coll = db[coll_name]
        total = coll.count_documents({})
        verify_docs = list(coll.find({}, sort=[("_id", -1)]).limit(args.verify_limit)) if args.mode in {"verify", "both"} else []
        toon_fields = select_toon_fields(cfg, args.toon_columns)
        toon_docs = [trim_doc(doc, toon_fields) for doc in verify_docs[: args.toon_limit]] if args.mode == "both" else []
        if args.mode == "toon":
            toon_docs = [trim_doc(doc, toon_fields) for doc in list(coll.find({}, sort=[("_id", -1)]).limit(args.toon_limit))]
            verify_docs = []

        md.append(f"## {coll_name} -> {target_entity}")
        md.append(f"- total_docs: `{total}`")
        md.append(f"- verify_sample_columns: `all top-level fields`")
        md.append(f"- toon_sample_columns: `{args.toon_columns}`")
        if toon_fields:
            md.append(f"- toon_fields: `{', '.join(toon_fields)}`")
        else:
            md.append("- toon_fields: `all top-level fields`")
        md.append("")

        if verify_docs:
            union_keys = unique_preserve(sorted({key for doc in verify_docs for key in top_level_keys(doc)}))
            md.append("### Verify Sample")
            md.append(f"- sampled_rows: `{len(verify_docs)}`")
            md.append(f"- observed_top_level_keys: `{', '.join(union_keys)}`")
            md.extend(render_markdown_table(verify_docs))
            md.append("")

        if toon_docs:
            md.append("### TOON Example Sample")
            md.append(f"- sampled_rows: `{len(toon_docs)}`")
            md.extend(render_markdown_table(toon_docs))
            md.append("")

        json_payload["collections"][coll_name] = {
            "target_entity": target_entity,
            "total_docs": total,
            "verify_sample_columns": "all",
            "toon_sample_columns": args.toon_columns,
            "toon_fields": toon_fields,
            "verify_rows": verify_docs,
            "toon_rows": toon_docs,
        }

    args.output.write_text("\n".join(md).rstrip() + "\n", encoding="utf-8")
    args.json_output.write_text(json.dumps(json_payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"[typedb-ontology-entity-sampling] wrote {args.output}")
    print(f"[typedb-ontology-entity-sampling] wrote {args.json_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
