#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient
import yaml

SCRIPT_DIR = Path(__file__).resolve().parent
TYPEDB_ROOT = SCRIPT_DIR.parent
INVENTORY_ROOT = TYPEDB_ROOT / 'inventory_latest'
DEFAULT_MAPPING_PATH = TYPEDB_ROOT / 'mappings' / 'mongodb_to_typedb_v1.yaml'
DEFAULT_OUTPUT_PATH = INVENTORY_ROOT / 'domain_inventory_latest.md'
DEFAULT_JSON_OUTPUT_PATH = INVENTORY_ROOT / 'domain_inventory_latest.json'
DEFAULT_KERNEL_ATTRS_PATH = TYPEDB_ROOT / 'schema' / 'fragments' / '00-kernel' / '10-attributes-and-ids.tql'

CANDIDATE_TOKENS = {
    'status', 'state', 'type', 'kind', 'scope', 'role', 'priority', 'severity', 'currency',
    'source', 'message_type', 'session_type', 'access_level', 'operation_type', 'event_group',
    'mime_type', 'dialogue_tag', 'issue_type'
}
EXCLUDE_SUFFIXES = ('_id', '_ref')
EXCLUDE_ATTRS = {'source_ref', 'external_ref', 'source_data', 'notes', 'summary', 'description'}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description='Inventory dictionary-like Mongo domains from ontology mapping')
    p.add_argument('--mapping', type=Path, default=DEFAULT_MAPPING_PATH)
    p.add_argument('--kernel-attrs', type=Path, default=DEFAULT_KERNEL_ATTRS_PATH)
    p.add_argument('--output', type=Path, default=DEFAULT_OUTPUT_PATH)
    p.add_argument('--json-output', type=Path, default=DEFAULT_JSON_OUTPUT_PATH)
    p.add_argument('--limit-values', type=int, default=30)
    p.add_argument('--attrs', type=str, default='', help='Comma-separated attribute names to force-include')
    p.add_argument('--marked-only', action='store_true', help='Inspect only attrs marked in kernel TQL plus any --attrs overrides')
    p.add_argument('--include-heuristics', action='store_true', help='Include heuristic candidates from mapping in addition to TQL-marked attrs')
    return p.parse_args()


def resolve_mongo() -> tuple[MongoClient, str]:
    mongo_uri = os.getenv('MONGODB_CONNECTION_STRING')
    db_name = os.getenv('DB_NAME')
    if not mongo_uri:
        raise ValueError('MONGODB_CONNECTION_STRING is not set')
    if not db_name:
        raise ValueError('DB_NAME is not set')
    return MongoClient(mongo_uri), db_name


def is_candidate(attr: str) -> bool:
    if attr in EXCLUDE_ATTRS or attr.endswith(EXCLUDE_SUFFIXES):
        return False
    return any(tok == attr or tok in attr for tok in CANDIDATE_TOKENS)


def parse_marked_kernel_attrs(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    marked: dict[str, dict[str, Any]] = {}
    pending_meta: dict[str, Any] | None = None
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if line.startswith('# @toon'):
            meta: dict[str, Any] = {}
            for token in line.replace('# @toon', '').strip().split():
                if '=' not in token:
                    continue
                key, value = token.split('=', 1)
                meta[key.strip()] = value.strip()
            pending_meta = meta if meta.get('inventory') == 'inspect' else None
            continue
        if line.startswith('# @domain_inventory'):
            pending_meta = {'inventory': 'inspect'} if 'inspect' in line else None
            continue
        if pending_meta and line.startswith('attribute '):
            attr_name = line.split()[1].rstrip(',')
            marked[attr_name] = pending_meta
            pending_meta = None
        elif line and not line.startswith('#'):
            pending_meta = None
    return marked


def _freeze(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def classify(values: list[Any]) -> str:
    non_null = [v for v in values if v is not None]
    unique = list(dict.fromkeys(_freeze(v) for v in non_null))
    if not unique:
        return 'null-only / no live domain'
    if set(unique).issubset({'true', 'false'}):
        return 'boolean-derived state domain'
    if any(isinstance(v, (list, dict)) for v in non_null):
        return 'structured domain / not a flat dictionary'
    if len(unique) <= 20 and all(isinstance(v, str) for v in non_null):
        return 'likely enumerated/string-dictionary domain'
    return 'open or mixed domain'


def main() -> int:
    args = parse_args()
    mapping = yaml.safe_load(args.mapping.read_text(encoding='utf-8'))
    marked_attrs = parse_marked_kernel_attrs(args.kernel_attrs)
    forced_attrs = {part.strip() for part in args.attrs.split(',') if part.strip()}
    client, db_name = resolve_mongo()
    db = client[db_name]

    lines = [
        '# Dictionary-like Domain Inventory',
        '',
        f'- Generated: {datetime.now(timezone.utc).isoformat()}',
        f'- Source mapping: `{args.mapping}`',
        '',
        'This report inventories mapped fields that behave like dictionary/enum-like domains and prints distinct values from MongoDB.',
        '',
    ]
    attr_rollup: dict[str, dict[str, Any]] = {}

    for item in mapping['collections']:
        coll = item['collection']
        target = item['target_entity']
        attrs = item.get('attributes') or {}
        candidates = []
        for attr, src in attrs.items():
            if not isinstance(attr, str) or not isinstance(src, str):
                continue
            marked = attr in marked_attrs
            forced = attr in forced_attrs
            heuristic = is_candidate(attr)
            if args.marked_only:
                if not (marked or forced):
                    continue
            else:
                if not (marked or forced or (args.include_heuristics and heuristic)):
                    continue
            candidates.append((attr, src, marked, forced, heuristic))
        if not candidates:
            continue
        lines.append(f'## {coll} -> {target}')
        for attr, src, marked, forced, heuristic in candidates:
            rows = list(db[coll].aggregate([
                {'$group': {'_id': f'${src}', 'count': {'$sum':1}}},
                {'$sort': {'count': -1, '_id': 1}},
            ]))
            values = [r['_id'] for r in rows]
            meta = marked_attrs.get(attr, {})
            bucket = attr_rollup.setdefault(
                attr,
                {
                    'declared_domain': meta.get('domain'),
                    'max_values': int(meta.get('max_values', args.limit_values)) if str(meta.get('max_values', '')).isdigit() else args.limit_values,
                    'collections': [],
                    'values': [],
                },
            )
            bucket['collections'].append({'collection': coll, 'target_entity': target, 'source_field': src})
            bucket['values'].extend(values)
            lines.append(f'- `{attr}` <- `{src}`')
            selectors = []
            if marked:
                selectors.append('kernel-marked')
            if forced:
                selectors.append('cli')
            if heuristic and not args.marked_only:
                selectors.append('heuristic')
            if selectors:
                lines.append(f'  - selection: {", ".join(selectors)}')
            lines.append(f'  - classification: {classify(values)}')
            for row in rows[: args.limit_values]:
                lines.append(f'  - value: `{json.dumps(row["_id"], ensure_ascii=False, default=str)}` count=`{row["count"]}`')
        lines.append('')

    args.output.write_text('\n'.join(lines).rstrip() + '\n', encoding='utf-8')
    serializable_rollup = {}
    for attr, payload in attr_rollup.items():
        unique_values = list(dict.fromkeys(_freeze(v) for v in payload['values']))
        serializable_rollup[attr] = {
            'declared_domain': payload['declared_domain'],
            'max_values': payload['max_values'],
            'collections': payload['collections'],
            'values': unique_values,
            'classification': classify(payload['values']),
        }
    args.json_output.write_text(json.dumps(serializable_rollup, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'[typedb-ontology-domain-inventory] wrote {args.output}')
    print(f'[typedb-ontology-domain-inventory] wrote {args.json_output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
