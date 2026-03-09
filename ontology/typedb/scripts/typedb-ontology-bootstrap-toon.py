#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from typedb_ontology_toon import FRAGMENT_SECTION_ORDER, parse_legacy_tql_fragment

TYPEDB_ROOT = SCRIPT_DIR.parent
FRAGMENTS_ROOT = TYPEDB_ROOT / "schema" / "fragments"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Bootstrap TOON YAML fragments from legacy TQL fragments")
    p.add_argument("--fragments-root", type=Path, default=FRAGMENTS_ROOT)
    p.add_argument("--overwrite", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    written = 0
    for section in FRAGMENT_SECTION_ORDER:
        section_dir = args.fragments_root / section
        for legacy in sorted(section_dir.glob("*.tql")):
            toon_path = legacy.with_suffix(".toon.yaml")
            if toon_path.exists() and not args.overwrite:
                continue
            payload = parse_legacy_tql_fragment(legacy)
            toon_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")
            written += 1
            print(f"[typedb-ontology-bootstrap-toon] wrote {toon_path}")
    print(f"[typedb-ontology-bootstrap-toon] fragments={written}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
