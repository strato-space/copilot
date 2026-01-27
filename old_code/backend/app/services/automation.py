from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from app.config import DATA_DIR
from app.services.store import read_json, write_json

ASK_LOG_PATH = DATA_DIR / "ask_log.json"

INTENT_KEYWORDS = {
    "plan": ["plan", "schedule", "weekly", "today"],
    "task_intake": ["task", "create", "add", "draft"],
    "status_answer": ["status", "update", "progress"],
    "data_fix": ["link", "owner", "assign", "assignee", "due"],
    "risk_control": ["risk", "block", "overload", "late"],
    "money": ["budget", "cost", "margin", "rate"],
    "knowledge": ["context", "doc", "knowledge", "note"],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def infer_intent(text: str) -> str:
    lowered = text.lower()
    for intent, keywords in INTENT_KEYWORDS.items():
        if any(keyword in lowered for keyword in keywords):
            return intent
    return "task_intake"


def build_ask_items(items: Iterable[dict]) -> list[dict]:
    asks: list[dict] = []
    for idx, item in enumerate(items):
        summary = item.get("summary") or ""
        intent_type = infer_intent(summary)
        asks.append(
            {
                "ask_id": f"ask-{idx:04d}",
                "date": now_iso(),
                "asker": "unknown",
                "channel": item.get("source_type") or "unknown",
                "project_id": item.get("project_guess") or "Unsorted",
                "intent_type": intent_type,
                "ask_text_norm": summary[:140],
                "pain": f"Repeated {intent_type} requests",
                "expected_outcome": "automation candidate",
                "artifact_link": item.get("source_ref") or "",
                "followup_needed": "no",
                "resolved": "no",
            }
        )
    return asks


def store_ask_log(asks: list[dict]) -> None:
    write_json(ASK_LOG_PATH, {"asks": asks})


def load_ask_log() -> list[dict]:
    data = read_json(ASK_LOG_PATH, {"asks": []})
    return data.get("asks", [])


def cluster_by_intent(asks: Iterable[dict]) -> list[dict]:
    clusters: dict[str, dict] = {}
    for ask in asks:
        intent = ask.get("intent_type") or "task_intake"
        cluster = clusters.setdefault(intent, {"count": 0, "examples": []})
        cluster["count"] += 1
        if len(cluster["examples"]) < 3:
            cluster["examples"].append(ask.get("ask_text_norm", ""))
    results = []
    for intent, data in clusters.items():
        examples = "; ".join([ex for ex in data["examples"] if ex])
        results.append(
            {
                "label": intent.replace("_", " ").title(),
                "count": data["count"],
                "pain": examples or f"Repeated {intent} requests",
            }
        )
    results.sort(key=lambda item: item["count"], reverse=True)
    return results
