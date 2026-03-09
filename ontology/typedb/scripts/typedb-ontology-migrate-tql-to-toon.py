#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import yaml


SCRIPT_DIR = Path(__file__).resolve().parent
TYPEDB_ROOT = SCRIPT_DIR.parent
FRAGMENTS_ROOT = TYPEDB_ROOT / "schema" / "fragments"
SECTION_LABELS = {
    "00-kernel": "kernel",
    "10-as-is": "as_is",
    "20-to-be": "to_be",
    "30-bridges": "bridges",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Migrate legacy TQL fragments into TOON YAML fragments")
    p.add_argument("--fragments-root", type=Path, default=FRAGMENTS_ROOT)
    p.add_argument("--overwrite", action="store_true")
    return p.parse_args()


def infer_scope(section: str, object_id: str) -> str:
    lower = object_id.lower()
    if "voice" in lower or "transcript" in lower or "dialog" in lower:
        return "BC.VoiceWorld"
    if "task" in lower or "priority" in lower or "status" in lower:
        return "BC.TaskWorld"
    if "artifact" in lower or "drive_" in lower or "file" in lower or "node" in lower:
        return "BC.ArtifactWorld"
    if "mode" in lower or "context_pack" in lower or "output_contract" in lower or "aggregation" in lower:
        return "BC.ModeEngineWorld"
    if "agent" in lower or "role" in lower or "prompt" in lower:
        return "BC.AgentWorld"
    if section == "00-kernel":
        return "BC.CrossContext"
    return "BC.ProjectWorld"


def infer_kind(target: str, object_id: str, section: str, inventory: dict[str, Any] | None = None) -> str:
    if target == "attribute":
        domain = (inventory or {}).get("domain")
        if domain == "dictionary":
            return "dictionary-domain-attribute"
        if domain == "state":
            return "state-attribute"
        if domain == "structured":
            return "structured-attribute"
        if domain == "open":
            return "open-domain-attribute"
        return "scalar-attribute"
    lower = object_id.lower()
    if target == "relation":
        if section == "30-bridges":
            return "projection-bridge"
        return "operational-relation"
    if lower.endswith("_dict") or lower.endswith("_type"):
        return "dictionary-record"
    if section == "20-to-be":
        return "semantic-object"
    if section == "10-as-is":
        return "operational-record"
    return "kernel-object"


def default_fpf_basis(section: str, target: str) -> list[str]:
    if section == "20-to-be":
        return ["U.BoundedContext", "E.17 U.MultiViewDescribing"]
    if section == "30-bridges":
        return ["A.6.9 U.CrossContextSamenessDisambiguation"]
    if target == "attribute":
        return ["U.BoundedContext"]
    return ["U.BoundedContext"]


def default_causes(object_id: str) -> dict[str, str]:
    return {
        "formal_what": f"The defining semantic form of `{object_id}` in the ontology.",
        "material_composed_of": f"The attributes and relations that compose `{object_id}`.",
        "efficient_created_by": f"The build, sync, or runtime processes that create or update `{object_id}`.",
        "final_goal": f"The reasoning, validation, or coordination purpose served by `{object_id}`.",
    }


def parse_inventory_meta(lines: list[str], idx: int) -> dict[str, Any] | None:
    if idx >= len(lines):
        return None
    line = lines[idx].strip()
    if not line.startswith("# @toon"):
        return None
    meta: dict[str, Any] = {}
    for token in line.replace("# @toon", "").strip().split():
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        meta[key.strip()] = value.strip()
    if "inventory" in meta:
        return {
            "inspect": meta.get("inventory") == "inspect",
            "domain": meta.get("domain"),
            "max_values": int(meta["max_values"]) if meta.get("max_values", "").isdigit() else None,
        }
    return None


def parse_attribute_items(section: str, text: str) -> list[dict[str, Any]]:
    lines = text.splitlines()
    items: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.strip()
        inv = parse_inventory_meta(lines, i)
        if inv:
            i += 1
            line = lines[i].strip() if i < len(lines) else ""
        if line.startswith("attribute "):
            attr_name = line.split()[1].rstrip(",")
            items.append(
                {
                    "id": attr_name,
                    "target": "attribute",
                    "kind": infer_kind("attribute", attr_name, section, inv),
                    "scope": infer_scope(section, attr_name),
                    "fpf_basis": default_fpf_basis(section, "attribute"),
                    "what": f"Attribute `{attr_name}` in the ontology kernel.",
                    "not": "Not a standalone ontology object.",
                    "why": f"Carries scalar/domain semantics for `{attr_name}`.",
                    "inventory": inv,
                    "causes": default_causes(attr_name),
                    "tql": line,
                }
            )
        i += 1
    return items


def parse_semantic_block(section: str, lines: list[str], start: int) -> tuple[dict[str, Any], int]:
    meta: dict[str, Any] = {"fpf_basis": []}
    first = lines[start].strip()
    object_id = first.split('id="', 1)[1].split('"', 1)[0]
    i = start + 1
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if stripped.startswith("# --- </semantic-card> ---"):
            raise ValueError(f"Malformed block for {object_id}: closing tag before tql body")
        if stripped.startswith("entity ") or stripped.startswith("relation "):
            break
        if stripped.startswith("#   -") and meta.get("_last_key") == "fpf_basis":
            meta["fpf_basis"].append(stripped.replace("#   -", "").strip())
        elif stripped.startswith("# "):
            content = stripped[2:]
            if ":" in content:
                key, value = content.split(":", 1)
                key = key.strip()
                value = value.strip()
                if key == "fpf_basis":
                    meta["_last_key"] = "fpf_basis"
                elif value:
                    meta[key] = value
                    meta["_last_key"] = key
        i += 1

    tql_lines: list[str] = []
    target = "entity" if i < len(lines) and lines[i].lstrip().startswith("entity ") else "relation"
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped.startswith("# --- </semantic-card> ---"):
            break
        tql_lines.append(lines[i])
        i += 1

    item = {
        "id": object_id,
        "target": target,
        "kind": meta.get("kind") or infer_kind(target, object_id, section),
        "scope": meta.get("scope") or infer_scope(section, object_id),
        "fpf_basis": meta.get("fpf_basis") or default_fpf_basis(section, target),
        "what": meta.get("what") or f"{target.title()} `{object_id}` in the ontology.",
        "not": meta.get("not") or "Not an unrelated ontology object.",
        "why": meta.get("why") or f"Preserves semantic meaning for `{object_id}`.",
        "tql": "\n".join(tql_lines).rstrip(),
    }
    if section in {"00-kernel", "20-to-be"}:
        item["causes"] = default_causes(object_id)
    return item, i


def parse_plain_blocks(section: str, text: str, target: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    current: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            if current and current[-1].rstrip().endswith(";"):
                block = "\n".join(current).rstrip()
                name = block.split()[1].rstrip(",")
                items.append(
                    {
                        "id": name,
                        "target": target,
                        "kind": infer_kind(target, name, section),
                        "scope": infer_scope(section, name),
                        "fpf_basis": default_fpf_basis(section, target),
                        "what": f"AS-IS {target} `{name}` from current runtime schema.",
                        "not": "Not a target-state semantic construct.",
                        "why": f"Preserves current operational structure for `{name}` during ontology migration.",
                        "causes": default_causes(name) if section in {"00-kernel", "20-to-be"} else None,
                        "tql": block,
                    }
                )
                current = []
            continue
        current.append(line)
    if current and current[-1].rstrip().endswith(";"):
        block = "\n".join(current).rstrip()
        name = block.split()[1].rstrip(",")
        items.append(
            {
                "id": name,
                "target": target,
                "kind": infer_kind(target, name, section),
                "scope": infer_scope(section, name),
                "fpf_basis": default_fpf_basis(section, target),
                "what": f"AS-IS {target} `{name}` from current runtime schema.",
                "not": "Not a target-state semantic construct.",
                "why": f"Preserves current operational structure for `{name}` during ontology migration.",
                "causes": default_causes(name) if section in {"00-kernel", "20-to-be"} else None,
                "tql": block,
            }
        )
    return items


def migrate_file(path: Path, root: Path) -> tuple[Path, dict[str, Any]]:
    section = path.parent.name
    text = path.read_text(encoding="utf-8")
    items: list[dict[str, Any]] = []
    if section == "00-kernel":
        items = parse_attribute_items(section, text)
    else:
        lines = text.splitlines()
        i = 0
        seen_card = False
        while i < len(lines):
            if lines[i].strip().startswith('# --- <semantic-card id="'):
                item, i = parse_semantic_block(section, lines, i)
                items.append(item)
                seen_card = True
            i += 1
        if not seen_card:
            target = "relation" if path.name == "40-relations.tql" or "bridges" in section else "entity"
            items = parse_plain_blocks(section, text, target)
    payload = {
        "version": 1,
        "section": section,
        "label": SECTION_LABELS.get(section, section),
        "items": items,
    }
    out_path = path.with_suffix("").with_suffix(".toon.yaml")
    return out_path, payload


def main() -> int:
    args = parse_args()
    for path in sorted(args.fragments_root.rglob("*.tql")):
        out_path, payload = migrate_file(path, args.fragments_root)
        if out_path.exists() and not args.overwrite:
            print(f"[typedb-ontology-migrate-tql-to-toon] skip existing {out_path}")
            continue
        out_path.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")
        print(f"[typedb-ontology-migrate-tql-to-toon] wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
