from __future__ import annotations

from pathlib import Path
from typing import Iterable

from app.config import INTAKE_DIR


def load_transcript_paths() -> list[Path]:
    if not INTAKE_DIR.exists():
        return []

    preferred = sorted(INTAKE_DIR.glob("voice_*.md")) + sorted(INTAKE_DIR.glob("chat_dump_*.md"))
    if preferred:
        return preferred

    fallback = sorted(INTAKE_DIR.glob("*.md")) + sorted(INTAKE_DIR.glob("*.txt"))
    return fallback


def split_transcript(text: str) -> list[str]:
    parts = [chunk.strip() for chunk in text.split("\n\n") if chunk.strip()]
    if len(parts) > 1:
        return parts

    lines = [line.strip() for line in text.split("\n") if line.strip()]
    return lines


def normalize_names(names: Iterable[str]) -> list[str]:
    unique = {name.strip() for name in names if name and name.strip()}
    return sorted(unique, key=len, reverse=True)


def match_name(text: str, names: list[str]) -> str | None:
    lowered = text.lower()
    for name in names:
        if name.lower() in lowered:
            return name
    return None


def infer_source_type(path: Path) -> str:
    lower = path.name.lower()
    if lower.startswith("voice"):
        return "voice"
    if lower.startswith("chat"):
        return "chat"
    return "doc"


def priority_rank(value: str | None) -> int:
    if not value:
        return 999
    digits = "".join(ch for ch in value if ch.isdigit())
    if digits:
        return int(digits)
    return 999


def build_priority_map(tasks: list[dict]) -> dict[str, str]:
    priorities: dict[str, str] = {}
    for task in tasks:
        project = task.get("project_name")
        priority = task.get("priority")
        if not project or not priority:
            continue
        existing = priorities.get(project)
        if not existing or priority_rank(priority) < priority_rank(existing):
            priorities[project] = priority
    return priorities


def build_inbox_items(
    tasks: list[dict],
    max_items: int = 30,
) -> list[dict]:
    project_names = normalize_names(task.get("project_name") for task in tasks)
    assignee_names = normalize_names(task.get("assignee_name") for task in tasks)
    priority_map = build_priority_map(tasks)

    items: list[dict] = []
    for path in load_transcript_paths():
        source_type = infer_source_type(path)
        file_id = path.stem
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue

        chunks = split_transcript(text)
        for idx, chunk in enumerate(chunks):
            if len(items) >= max_items:
                break
            summary = chunk.replace("\n", " ").strip()
            if not summary:
                continue
            summary = summary[:160]

            project_guess = match_name(summary, project_names)
            owner_guess = match_name(summary, assignee_names)
            priority = priority_map.get(project_guess) if project_guess else None

            if not project_guess:
                status = "unsorted"
            elif not owner_guess:
                status = "needs_verify"
            else:
                status = "new"

            items.append(
                {
                    "inbox_id": f"{source_type}-{file_id}-{idx:03d}",
                    "source_type": source_type,
                    "summary": summary,
                    "status": status,
                    "project_guess": project_guess,
                    "owner_guess": owner_guess,
                    "priority": priority,
                }
            )
    return items
