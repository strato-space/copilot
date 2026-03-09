from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml


SCRIPT_DIR = Path(__file__).resolve().parent
TYPEDB_ROOT = SCRIPT_DIR.parent
FRAGMENTS_ROOT = TYPEDB_ROOT / "schema" / "fragments"
TOON_SUFFIX = ".toon.yaml"
FRAGMENT_SECTION_ORDER = ("00-kernel", "10-as-is", "20-to-be", "30-bridges")
SECTION_ORDER = tuple((name, FRAGMENTS_ROOT / name) for name in FRAGMENT_SECTION_ORDER)
TARGETS = {"attribute", "entity", "relation"}
SEMANTIC_FIELDS = ("kind", "scope", "fpf_basis", "what", "not", "why", "causes")


class ToonDumper(yaml.SafeDumper):
    pass


def _str_presenter(dumper: yaml.SafeDumper, data: str):
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


ToonDumper.add_representer(str, _str_presenter)


def infer_scope(section: str, object_id: str) -> str:
    lower = object_id.lower()
    if section == "00-kernel":
        if any(token in lower for token in ("status", "priority", "task_type", "type_class")):
            return "BC.TaskWorld"
        if any(token in lower for token in ("message", "session", "dialogue", "event_status", "mime_type", "source_type", "source_kind")):
            return "BC.VoiceWorld"
        if any(token in lower for token in ("currency", "amount", "month", "year")):
            return "BC.ProjectWorld"
        return "BC.CrossContext"
    if "voice" in lower or "transcript" in lower or "dialog" in lower:
        return "BC.VoiceWorld"
    if "task" in lower or "priority" in lower or "status" in lower:
        return "BC.TaskWorld"
    if "artifact" in lower or "drive_" in lower or "file" in lower or "node" in lower:
        return "BC.ArtifactWorld"
    if any(token in lower for token in ("mode", "context_pack", "output_contract", "aggregation", "interaction_scope")):
        return "BC.ModeEngineWorld"
    if "agent" in lower or "role" in lower or "prompt" in lower:
        return "BC.AgentWorld"
    if section == "30-bridges":
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
        if section == "20-to-be":
            return "semantic-relation"
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
    return ["U.BoundedContext"]


def default_causes(object_id: str) -> dict[str, str]:
    return {
        "formal_what": f"The semantic form that makes `{object_id}` this exact ontology object.",
        "material_composed_of": f"The attributes, relations, and stored substrate that compose `{object_id}`.",
        "efficient_created_by": f"The build, sync, runtime, or human processes that create or update `{object_id}`.",
        "final_goal": f"The reasoning, validation, coordination, or retrieval purpose served by `{object_id}`.",
    }


def default_semantics(target: str, object_id: str, section: str, inventory: dict[str, Any] | None = None) -> dict[str, Any]:
    if target == "attribute":
        return {
            "kind": infer_kind(target, object_id, section, inventory),
            "scope": infer_scope(section, object_id),
            "fpf_basis": default_fpf_basis(section, target),
            "what": f"Ontology attribute `{object_id}`.",
            "not": "Not a standalone ontology object.",
            "why": f"Carries scalar or domain semantics for `{object_id}`.",
        }
    return {
        "kind": infer_kind(target, object_id, section, inventory),
        "scope": infer_scope(section, object_id),
        "fpf_basis": default_fpf_basis(section, target),
        "what": f"{target.title()} `{object_id}` in the ontology.",
        "not": "Not an unrelated ontology object.",
        "why": f"Preserves semantic meaning for `{object_id}` in the ontology.",
    }


def parse_toon_kv_line(line: str) -> tuple[str, Any] | None:
    stripped = line.strip()
    if not stripped.startswith("# "):
        return None
    body = stripped[2:]
    if ":" not in body:
        return None
    key, value = body.split(":", 1)
    return key.strip(), value.strip()


def parse_inline_toon_marker(line: str) -> dict[str, Any] | None:
    stripped = line.strip()
    if not stripped.startswith("# @toon"):
        return None
    meta: dict[str, Any] = {}
    for token in stripped.replace("# @toon", "", 1).strip().split():
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        meta[key.strip()] = value.strip()
    return meta


def detect_target_from_tql(block: str) -> str:
    first = block.strip().splitlines()[0].strip()
    if first.startswith("attribute "):
        return "attribute"
    if first.startswith("entity "):
        return "entity"
    if first.startswith("relation "):
        return "relation"
    raise ValueError(f"Cannot infer target from TQL block: {first!r}")


def detect_id_from_tql(block: str, target: str) -> str:
    first = block.strip().splitlines()[0].strip()
    if target == "attribute":
        return first.split()[1].rstrip(",;")
    return first.split()[1].rstrip(",;")


def derive_fragment_name(path: Path) -> str:
    stem = path.stem
    if stem.endswith(".toon"):
        stem = stem[:-5]
    return stem


def _flush_card(cards: list[dict[str, Any]], card: dict[str, Any] | None) -> None:
    if not card:
        return
    cards.append(card)


def parse_legacy_tql_fragment(path: Path) -> dict[str, Any]:
    lines = path.read_text(encoding="utf-8").splitlines()
    cards: list[dict[str, Any]] = []
    pending_inventory: dict[str, Any] | None = None
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped or stripped.startswith("# =============================="):
            i += 1
            continue

        if stripped.startswith("# @toon"):
            pending_inventory = parse_inline_toon_marker(line)
            i += 1
            continue

        if stripped.startswith("# --- <semantic-card"):
            meta: dict[str, Any] = {}
            m = re.search(r'id="([^"]+)"', stripped)
            if m:
                meta["id"] = m.group(1)
            i += 1
            current_list_key: str | None = None
            list_values: list[str] = []
            while i < len(lines):
                inner = lines[i].strip()
                if inner.startswith("# --- </semantic-card> ---"):
                    break
                if inner.startswith("# "):
                    content = inner[2:]
                    if content.startswith("- ") and current_list_key:
                        list_values.append(content[2:].strip())
                    elif ":" in content:
                        if current_list_key and list_values:
                            meta[current_list_key] = list_values
                            list_values = []
                        key, value = content.split(":", 1)
                        key = key.strip()
                        value = value.strip()
                        if value == "":
                            current_list_key = key
                            list_values = []
                        else:
                            current_list_key = None
                            meta[key] = value
                else:
                    if current_list_key and list_values:
                        meta[current_list_key] = list_values
                        list_values = []
                        current_list_key = None
                    break
                i += 1
            if current_list_key and list_values:
                meta[current_list_key] = list_values
            while i < len(lines) and lines[i].strip().startswith("# --- </semantic-card> ---"):
                i += 1
            tql_lines: list[str] = []
            while i < len(lines):
                current = lines[i]
                current_stripped = current.strip()
                if not current_stripped:
                    break
                if current_stripped.startswith("# --- <semantic-card") or current_stripped.startswith("# @toon") or current_stripped.startswith("# =============================="):
                    break
                tql_lines.append(current)
                i += 1
                if current_stripped.endswith(";"):
                    break
            block = "\n".join(tql_lines).strip()
            target = detect_target_from_tql(block)
            object_id = meta.pop("id", detect_id_from_tql(block, target))
            card: dict[str, Any] = {"target": target, "id": object_id, "tql": block, **default_semantics(target, object_id, path.parent.name)}
            for field in SEMANTIC_FIELDS:
                if field in meta:
                    card[field] = meta[field]
            if path.parent.name in {"00-kernel", "20-to-be"}:
                card.setdefault("causes", default_causes(object_id))
            cards.append(card)
            continue

        if stripped.startswith("attribute "):
            block = stripped
            attr_id = detect_id_from_tql(block, "attribute")
            card: dict[str, Any] = {
                "target": "attribute",
                "id": attr_id,
                "tql": block,
                **default_semantics("attribute", attr_id, path.parent.name, None),
                "causes": default_causes(attr_id),
            }
            if pending_inventory:
                inventory = {}
                if "inventory" in pending_inventory:
                    inventory["inspect"] = pending_inventory["inventory"] == "inspect"
                if "domain" in pending_inventory:
                    inventory["domain"] = pending_inventory["domain"]
                if "max_values" in pending_inventory:
                    inventory["max_values"] = int(pending_inventory["max_values"])
                card["inventory"] = inventory
                card.update(default_semantics("attribute", attr_id, path.parent.name, inventory))
            cards.append(card)
            pending_inventory = None
            i += 1
            continue

        if stripped.startswith("entity ") or stripped.startswith("relation "):
            block_lines = [line]
            target = "entity" if stripped.startswith("entity ") else "relation"
            i += 1
            while i < len(lines):
                next_line = lines[i]
                next_stripped = next_line.strip()
                if not next_stripped:
                    break
                if next_stripped.startswith("# "):
                    break
                block_lines.append(next_line)
                i += 1
                if next_stripped.endswith(";"):
                    break
            block = "\n".join(block_lines).strip()
            cards.append(
                {
                    "target": target,
                    "id": detect_id_from_tql(block, target),
                    "tql": block,
                    **default_semantics(target, detect_id_from_tql(block, target), path.parent.name),
                }
            )
            continue

        i += 1

    return {
        "version": 1,
        "layer": path.parent.name,
        "fragment": derive_fragment_name(path),
        "cards": cards,
    }


def load_toon_fragment(path: Path) -> dict[str, Any]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Fragment {path} must be a YAML object")
    layer = str(payload.get("layer"))
    cards = payload.get("cards") or []
    normalized_cards: list[dict[str, Any]] = []
    for card in cards:
        card = dict(card)
        target = str(card.get("target"))
        object_id = str(card.get("id"))
        inventory = card.get("inventory") if isinstance(card.get("inventory"), dict) else None
        defaults = default_semantics(target, object_id, layer, inventory)
        for key, value in defaults.items():
            card.setdefault(key, value)
        if layer in {"00-kernel", "20-to-be"}:
            card.setdefault("causes", default_causes(object_id))
        normalized_cards.append(card)
    payload["cards"] = normalized_cards
    return payload


def parse_toon_fragment(path: Path) -> dict[str, Any]:
    return load_toon_fragment(path)


def validate_toon_fragment(payload: dict[str, Any], path: Path) -> list[str]:
    errors: list[str] = []
    for key in ("version", "layer", "fragment", "cards"):
        if key not in payload:
            errors.append(f"{path}: missing top-level key {key!r}")
    cards = payload.get("cards")
    if not isinstance(cards, list):
        errors.append(f"{path}: cards must be a list")
        return errors
    for idx, card in enumerate(cards):
        if not isinstance(card, dict):
            errors.append(f"{path}: card[{idx}] must be a mapping")
            continue
        for key in ("id", "target", "kind", "scope", "fpf_basis", "what", "not", "why", "tql"):
            if key not in card:
                errors.append(f"{path}: card[{idx}] missing {key!r}")
        target = card.get("target")
        if target not in TARGETS:
            errors.append(f"{path}: card[{idx}] invalid target {target!r}")
        if not isinstance(card.get("fpf_basis"), list) or not card.get("fpf_basis"):
            errors.append(f"{path}: card[{idx}] fpf_basis must be a non-empty list")
        causes = card.get("causes")
        if payload.get("layer") in {"00-kernel", "20-to-be"}:
            if not isinstance(causes, dict):
                errors.append(f"{path}: card[{idx}] causes must be a mapping")
            else:
                for key in ("formal_what", "material_composed_of", "efficient_created_by", "final_goal"):
                    if key not in causes:
                        errors.append(f"{path}: card[{idx}] causes missing {key!r}")
        elif causes is not None and not isinstance(causes, dict):
            errors.append(f"{path}: card[{idx}] causes must be a mapping")
    return errors


def find_toon_fragments(root: Path = FRAGMENTS_ROOT) -> list[Path]:
    paths: list[Path] = []
    for section in FRAGMENT_SECTION_ORDER:
        section_dir = root / section
        paths.extend(sorted(section_dir.glob(f"*{TOON_SUFFIX}")))
    return paths


def render_inventory_comments(card: dict[str, Any], values_line: str | None = None) -> list[str]:
    inventory = card.get("inventory") or {}
    if not inventory:
        return []
    inspect = inventory.get("inspect")
    domain = inventory.get("domain")
    max_values = inventory.get("max_values")
    if inspect is None and domain is None and max_values is None:
        return []
    inspect_token = "inspect" if inspect else "ignore"
    out = [f"# @toon inventory={inspect_token} domain={domain} max_values={max_values}"]
    if values_line:
        out.append(values_line)
        out.append("")
    return out


def render_semantic_card_comments(card: dict[str, Any]) -> list[str]:
    if card.get("target") == "attribute":
        return []
    semantic_keys = [key for key in ("kind", "fpf_basis", "scope", "what", "not", "why") if key in card]
    if not semantic_keys:
        return []
    out = [f'# --- <semantic-card id="{card["id"]}"> ---']
    for key in semantic_keys:
        value = card[key]
        if isinstance(value, list):
            out.append(f"# {key}:")
            for item in value:
                out.append(f"#   - {item}")
        else:
            out.append(f"# {key}: {value}")
    out.append("# --- </semantic-card> ---")
    return out


def build_yaml_aggregate(section_payloads: list[dict[str, Any]]) -> str:
    aggregate = {
        "version": 1,
        "generated_from": "ontology/typedb/schema/fragments/*.toon.yaml",
        "sections": section_payloads,
    }
    return yaml.dump(aggregate, Dumper=ToonDumper, sort_keys=False, allow_unicode=True, width=1000)


def emit_yaml(payload: dict[str, Any]) -> str:
    return yaml.dump(payload, Dumper=ToonDumper, sort_keys=False, allow_unicode=True, width=1000)


def sort_inventory_values(values: list[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        display = str(value).strip('"').strip()
        if display in seen:
            continue
        seen.add(display)
        unique.append(display)
    unique.sort(key=lambda value: (value != "null", value.casefold()))
    return unique


def convert_tql_fragment(path: Path) -> dict[str, Any]:
    return parse_legacy_tql_fragment(path)


def render_toon_values(attr: str, inventory: dict[str, dict] | None) -> str | None:
    if not inventory:
        return None
    payload = inventory.get(attr)
    if not payload:
        return None
    values = payload.get("values") or []
    declared_domain = payload.get("declared_domain")
    max_values = payload.get("max_values") or 0
    if declared_domain == "structured":
        return "# @toon values: <structured domain; see domain_inventory_latest.md>"
    if len(values) == 0:
        return None
    if max_values and len(values) > int(max_values):
        return "# @toon values: <too many values; see domain_inventory_latest.md>"
    return "# @toon values: " + " | ".join(sort_inventory_values(values))


def build_tql_from_sections(section_payloads: list[dict[str, Any]], domain_inventory: dict[str, dict] | None = None) -> str:
    out: list[str] = [
        "define",
        "",
        "# Generated from ontology/typedb/schema/fragments/*.toon.yaml",
        "# Do not edit this file manually; edit TOON fragments and regenerate.",
        "",
    ]
    for payload in section_payloads:
        section_name = payload["layer"]
        fragment_name = payload["fragment"]
        out.append(f"# --- <{section_name[3:]}.{fragment_name}> ---")
        for card in payload["cards"]:
            card = dict(card)
            target = card["target"]
            tql_block = str(card["tql"]).strip()
            if target == "attribute":
                values_line = render_toon_values(card["id"], domain_inventory)
                out.extend(render_inventory_comments(card, values_line))
                out.append(tql_block)
                out.append("")
                continue
            out.extend(render_semantic_card_comments(card))
            out.extend(tql_block.splitlines())
            out.append("")
        if out and out[-1] == "":
            out.pop()
        out.append(f"# --- </{section_name[3:]}.{fragment_name}> ---")
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def build_outputs(domain_inventory: dict[str, dict] | None = None) -> tuple[str, str]:
    section_payloads = [parse_toon_fragment(path) for path in find_toon_fragments()]
    return build_yaml_aggregate(section_payloads), build_tql_from_sections(section_payloads, domain_inventory)
