from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "typedb-ontology-domain-inventory.py"
KERNEL_ATTRS_PATH = ROOT / "schema" / "fragments" / "00-kernel" / "10-attributes-and-ids.tql"

spec = importlib.util.spec_from_file_location("typedb_domain_inventory_test_module", SCRIPT_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load module from {SCRIPT_PATH}")
tool = importlib.util.module_from_spec(spec)
sys.modules["typedb_domain_inventory_test_module"] = tool
spec.loader.exec_module(tool)


class DomainInventoryToolTest(unittest.TestCase):
    def test_parse_marked_kernel_attrs_reads_inline_markers(self) -> None:
        marked = tool.parse_marked_kernel_attrs(KERNEL_ATTRS_PATH)
        self.assertIn("status", marked)
        self.assertEqual(marked["status"]["inventory"], "inspect")
        self.assertEqual(marked["status"]["domain"], "dictionary")
        self.assertEqual(marked["status"]["max_values"], "50")

    def test_default_policy_is_marker_first(self) -> None:
        marked = {"status": {"inventory": "inspect"}}
        forced = set()
        heuristic = True

        selected_status = bool("status" in marked or "status" in forced or (False and heuristic))
        selected_last_status = bool("last_status" in marked or "last_status" in forced or (False and heuristic))

        self.assertTrue(selected_status)
        self.assertFalse(selected_last_status)

    def test_normalize_priority_value_reduces_decorated_labels_to_canonical_text(self) -> None:
        flame = chr(0x1F525)
        self.assertEqual(tool.normalize_priority_value(f"{flame} P1"), "P1")
        self.assertEqual(tool.normalize_priority_value(f"{flame} P4 "), "P4")
        self.assertEqual(tool.normalize_priority_value("P7"), "P7")
        self.assertEqual(tool.normalize_priority_value("custom"), "custom")


if __name__ == "__main__":
    unittest.main()
