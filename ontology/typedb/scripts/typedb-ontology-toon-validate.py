#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from typedb_ontology_toon import FRAGMENT_SECTION_ORDER, load_toon_fragment, validate_toon_fragment

TYPEDB_ROOT = SCRIPT_DIR.parent
FRAGMENTS_ROOT = TYPEDB_ROOT / "schema" / "fragments"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Validate TOON YAML ontology fragments")
    p.add_argument("--fragments-root", type=Path, default=FRAGMENTS_ROOT)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    errors: list[str] = []
    checked = 0
    for section in FRAGMENT_SECTION_ORDER:
        section_dir = args.fragments_root / section
        for fragment in sorted(section_dir.glob("*.toon.yaml")):
            payload = load_toon_fragment(fragment)
            errors.extend(validate_toon_fragment(payload, fragment))
            checked += 1
    if errors:
        for error in errors:
            print(f"[typedb-ontology-toon-validate] ERROR {error}")
        raise SystemExit(1)
    print(f"[typedb-ontology-toon-validate] checked={checked} errors=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
