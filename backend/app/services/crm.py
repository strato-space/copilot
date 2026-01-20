from __future__ import annotations

import csv
import json
import re
from datetime import date
from pathlib import Path

from app.config import CSV_DIR, DEFAULT_CRM_SNAPSHOT

_SNAPSHOT_RE = re.compile(r"^crm-tasks-active-selected-(\d{4}-\d{2}-\d{2})\.csv$")

_TOKENS_BACKLOG = ("backlog", "new", "request", "periodic")
_TOKENS_IN_PROGRESS = ("progress", "inprogress")
_TOKENS_REVIEW = ("ready", "review")
_TOKENS_DONE = ("done", "complete")


def normalize_status(raw: str) -> str:
    """
    Normalize CRM `task_status` into one of:
    Backlog | InProgress | Review | Done

    We intentionally use token/substring matching because exports may contain
    combined labels like "New / Request" or "Review / Ready".
    """

    if not raw:
        return "Backlog"
    key = raw.strip().lower()

    if any(t in key for t in _TOKENS_DONE):
        return "Done"
    if any(t in key for t in _TOKENS_IN_PROGRESS):
        return "InProgress"
    if any(t in key for t in _TOKENS_REVIEW):
        return "Review"
    if any(t in key for t in _TOKENS_BACKLOG):
        return "Backlog"
    return "Backlog"


def parse_assignee(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if isinstance(data, dict):
        return data.get("name") or raw
    return raw


def parse_estimate(raw: str | None) -> float | None:
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _parse_snapshot_date(path: Path) -> date | None:
    m = _SNAPSHOT_RE.match(path.name)
    if not m:
        return None
    try:
        return date.fromisoformat(m.group(1))
    except ValueError:
        return None


def resolve_snapshot() -> Path | None:
    default_path = Path(DEFAULT_CRM_SNAPSHOT) if DEFAULT_CRM_SNAPSHOT else None
    if default_path and default_path.exists():
        return default_path

    if not CSV_DIR.exists():
        return None

    candidates = [p for p in CSV_DIR.glob("crm-tasks-active-selected-*.csv") if p.is_file()]
    if not candidates:
        candidates = [p for p in CSV_DIR.glob("*.csv") if p.is_file()]
        if not candidates:
            return None

    # Prefer latest by date in filename; tie-break by mtime. Fallback to latest mtime.
    dated = []
    undated = []
    for p in candidates:
        d = _parse_snapshot_date(p)
        if d:
            dated.append((d, p.stat().st_mtime, p))
        else:
            undated.append((p.stat().st_mtime, p))

    if dated:
        dated.sort(key=lambda x: (x[0], x[1]))
        return dated[-1][2]
    undated.sort(key=lambda x: x[0])
    return undated[-1][1]


def load_crm_tasks(snapshot_path: Path | None = None) -> list[dict]:
    path = snapshot_path or resolve_snapshot()
    if not path or not path.exists():
        return []

    tasks: list[dict] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            task_id = (row.get("id") or "").strip()
            title = (row.get("name") or "").strip()
            project_name = (row.get("project") or "").strip() or None
            project_id_raw = (row.get("project_id") or "").strip()
            project_id = project_id_raw.strip().strip('"').strip("'") or None
            status_raw = (row.get("task_status") or "").strip()
            priority = (row.get("priority") or "").strip() or None
            assignee_id = (row.get("performer_id") or "").strip() or None
            assignee_name = parse_assignee(row.get("performer"))
            estimate_h = parse_estimate(row.get("estimated_time"))
            updated_at = (row.get("updated_at") or "").strip() or None

            if not task_id and not title:
                continue

            tasks.append(
                {
                    "task_id": task_id or title,
                    "title": title or "Untitled task",
                    "project_id": project_id,
                    "project_name": project_name,
                    "status_raw": status_raw,
                    "status": normalize_status(status_raw),
                    "priority": priority,
                    "assignee_id": assignee_id,
                    "assignee_name": assignee_name,
                    "estimate_h": estimate_h,
                    "updated_at": updated_at,
                }
            )

    return tasks
