from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.schemas import (
    SnapshotInfo,
    AutomationCandidate,
    BacklogResponse,
    InboxItem,
    MemoryCreateRequest,
    MemoryNote,
    MemoryResponse,
    MetricLine,
    MetricsResponse,
    MonthResponse,
    ApplyRequest,
    ApprovePackage,
    ApproveRequest,
    PerformerDraftRequest,
    PerformerNoteRequest,
    PerformerProfile,
    PerformerResponse,
    PlanLine,
    SuggestOp,
    TimelineEvent,
    TimelineResponse,
    TodayResponse,
    WeekBlock,
    WeekResponse,
)
from app.services.automation import build_ask_items, cluster_by_intent, store_ask_log
from app.services.crm import load_crm_snapshot
from app.services.intake import build_inbox_items
from app.services.store import read_json, write_json
from app.config import CRM_API_BASE_URL, CRM_API_TOKEN, DATA_DIR

router = APIRouter(prefix="/api/ops", tags=["ops"])

APPROVALS_PATH = DATA_DIR / "approvals.json"
TIMELINE_PATH = DATA_DIR / "timeline.json"
MEMORY_PATH = DATA_DIR / "memory.json"
PERFORMERS_PATH = DATA_DIR / "performers.json"


def build_suggest_ops(tasks: list[dict], limit: int = 30) -> list[SuggestOp]:
    """
    Build patch suggestions from simple data-quality gates.

    Safe-by-default: ops may contain null values and should be treated as "needs verify"
    until approved by a human.
    """

    ops: list[SuggestOp] = []

    def add_op(op_type: str, payload: dict, reason: str, source_ref: str | None = None) -> None:
        ops.append(
            SuggestOp(
                op_id=f"op-{uuid4().hex[:8]}",
                type=op_type,  # type: ignore[arg-type]
                payload=payload,
                reason=reason,
                source_ref=source_ref,
            )
        )

    wip = [t for t in tasks if t.get("status") in {"InProgress", "Review"}]

    # Gate-1: WIP tasks must have assignee.
    for task in wip:
        if task.get("assignee_name") or task.get("assignee_id"):
            continue
        add_op(
            "assign",
            {"task_id": task.get("task_id"), "assignee": None},
            "Gate-1: task in InProgress/Review without assignee",
            source_ref=task.get("task_id"),
        )
        if len(ops) >= limit:
            return ops

    # Gate-1: tasks must have project_id to be planned per project.
    for task in tasks:
        if task.get("project_id"):
            continue
        add_op(
            "update",
            {"task_id": task.get("task_id"), "project_id": None},
            "Gate-1: task without project_id (needs mapping or Unsorted)",
            source_ref=task.get("task_id"),
        )
        if len(ops) >= limit:
            return ops

    # Gate-2: estimates required for load calculations (week), and useful for WIP.
    for task in wip:
        if task.get("estimate_h") is not None:
            continue
        add_op(
            "update",
            {"task_id": task.get("task_id"), "estimate_h": None},
            "Gate-2: missing estimate_h for WIP (load calculation)",
            source_ref=task.get("task_id"),
        )
        if len(ops) >= limit:
            return ops

    return ops


def group_plan_lines(tasks: list[dict], key_fn) -> list[PlanLine]:
    grouped: dict[str, list[str]] = {}
    for task in tasks:
        label = key_fn(task) or "Unassigned"
        grouped.setdefault(label, []).append(task["title"])

    lines: list[PlanLine] = []
    for label in sorted(grouped.keys()):
        titles = grouped[label][:3]
        details = ", ".join(titles)
        lines.append(PlanLine(label=label, details=details))
    return lines


def build_risk_signals(tasks: list[dict]) -> list[str]:
    missing_project = sum(1 for task in tasks if not task.get("project_id"))
    missing_assignee = sum(
        1
        for task in tasks
        if task.get("status") in {"InProgress", "Review"} and not task.get("assignee_name")
        and not task.get("assignee_id")
    )
    missing_estimate = sum(
        1
        for task in tasks
        if task.get("status") in {"InProgress", "Review"} and task.get("estimate_h") is None
    )

    signals: list[str] = []
    if missing_project:
        signals.append(f"Missing project: {missing_project}")
    if missing_assignee:
        signals.append(f"Missing assignee on WIP: {missing_assignee}")
    if missing_estimate:
        signals.append(f"Missing estimate on WIP: {missing_estimate}")
    return signals or ["No critical data risks detected"]


def build_backlog_response(tasks: list[dict], snapshot: SnapshotInfo | None) -> BacklogResponse:
    backlog_tasks = [task for task in tasks if task.get("status") == "Backlog"]
    unsorted_tasks = [task for task in tasks if not task.get("project_id")]
    needs_verify_tasks = [
        task
        for task in tasks
        if task.get("status") in {"InProgress", "Review"}
        and not task.get("assignee_name")
        and not task.get("assignee_id")
    ]

    def as_item(task: dict, status: str, summary_override: str | None = None) -> InboxItem:
        return InboxItem(
            inbox_id=task["task_id"],
            source_type="crm",
            summary=summary_override or task["title"],
            status=status,
            project_guess=task.get("project_name"),
            owner_guess=task.get("assignee_name") or task.get("assignee_id"),
            priority=task.get("priority"),
        )

    project_candidates = []
    if unsorted_tasks:
        project_candidates = ["Map missing projects"]

    return BacklogResponse(
        snapshot=snapshot,
        items=[as_item(task, "backlog") for task in backlog_tasks[:10]],
        needs_verify=[
            as_item(task, "needs_verify", f"Missing owner: {task['title']}")
            for task in needs_verify_tasks[:10]
        ],
        unsorted=[
            as_item(task, "unsorted", f"Missing project: {task['title']}")
            for task in unsorted_tasks[:10]
        ],
        project_candidates=project_candidates,
        forwardable=[
            "Status response ready for RMS",
            "Aurora status: link + next step in CRM",
        ],
        suggest_ops=build_suggest_ops(tasks),
    )

def build_backlog_from_intake(
    items: list[dict], suggest_ops: list[SuggestOp], snapshot: SnapshotInfo | None
) -> BacklogResponse:
    def as_item(raw: dict) -> InboxItem:
        return InboxItem(
            inbox_id=raw.get("inbox_id", "unknown"),
            source_type=raw.get("source_type", "doc"),
            summary=raw.get("summary", "No summary"),
            status=raw.get("status", "new"),
            project_guess=raw.get("project_guess"),
            owner_guess=raw.get("owner_guess"),
            priority=raw.get("priority"),
        )

    inbox = [as_item(item) for item in items]
    return BacklogResponse(
        snapshot=snapshot,
        items=[item for item in inbox if item.status == "new"],
        needs_verify=[item for item in inbox if item.status == "needs_verify"],
        unsorted=[item for item in inbox if item.status == "unsorted"],
        project_candidates=["Map missing projects"] if any(item.status == "unsorted" for item in inbox) else [],
        forwardable=["Draft answer ready for review"],
        suggest_ops=suggest_ops,
    )


def build_today_response(tasks: list[dict], snapshot: SnapshotInfo | None) -> TodayResponse:
    wip = [task for task in tasks if task.get("status") in {"InProgress", "Review"}]
    if not wip:
        wip = tasks[:]

    plan_by_project = group_plan_lines(wip, lambda task: task.get("project_name") or "No project")
    plan_by_people = group_plan_lines(
        wip, lambda task: task.get("assignee_name") or task.get("assignee_id") or "Unassigned"
    )
    return TodayResponse(
        snapshot=snapshot,
        plan_by_project=plan_by_project,
        plan_by_people=plan_by_people,
        risk_signals=build_risk_signals(tasks),
        suggest_ops=build_suggest_ops(tasks),
    )


def build_week_response(tasks: list[dict], snapshot: SnapshotInfo | None) -> WeekResponse:
    week_tasks = [task for task in tasks if task.get("status") in {"Backlog", "InProgress", "Review"}]
    if not week_tasks:
        week_tasks = tasks[:]

    load_issues = []
    missing_estimate = sum(1 for task in week_tasks if task.get("estimate_h") is None)
    if missing_estimate:
        load_issues.append(f"Missing estimates: {missing_estimate}")
    missing_assignee = sum(
        1 for task in week_tasks if not task.get("assignee_name") and not task.get("assignee_id")
    )
    if missing_assignee:
        load_issues.append(f"Missing assignee: {missing_assignee}")
    if not load_issues:
        load_issues.append("No load issues detected")

    return WeekResponse(
        snapshot=snapshot,
        by_people=group_plan_lines(
            week_tasks,
            lambda task: task.get("assignee_name") or task.get("assignee_id") or "Unassigned",
        ),
        by_projects=group_plan_lines(week_tasks, lambda task: task.get("project_name") or "No project"),
        load_issues=load_issues,
        suggest_ops=build_suggest_ops(tasks),
    )


def build_metrics_response(
    tasks: list[dict], intake_items: list[dict], snapshot: SnapshotInfo | None
) -> MetricsResponse:
    total = len(tasks)
    done = sum(1 for task in tasks if task.get("status") == "Done")
    review = sum(1 for task in tasks if task.get("status") == "Review")
    missing_project = sum(1 for task in tasks if not task.get("project_id"))
    missing_assignee = sum(1 for task in tasks if not task.get("assignee_name"))

    if total:
        execution_rate = f"{int((done / total) * 100)}%"
        integrity = int(((total - missing_project + total - missing_assignee) / (2 * total)) * 100)
    else:
        execution_rate = "0%"
        integrity = 0

    metrics = [
        MetricLine(label="Execution rate", value=execution_rate, note="Based on Done vs total"),
        MetricLine(label="Unsorted", value=str(missing_project), note="Missing project id"),
        MetricLine(label="WIP stuck", value=str(review), note="Review items"),
        MetricLine(label="Data integrity", value=f"{integrity}%", note="Project + owner coverage"),
    ]

    ask_items = build_ask_items(intake_items)
    store_ask_log(ask_items)
    clusters = cluster_by_intent(ask_items)
    automation_candidates = [
        AutomationCandidate(label=item["label"], count=item["count"], pain=item["pain"])
        for item in clusters[:3]
    ]

    if not automation_candidates:
        automation_candidates = [
            AutomationCandidate(label="Status answers", count=0, pain="No ask log yet")
        ]

    return MetricsResponse(
        snapshot=snapshot,
        metrics=metrics,
        not_ok_signals=build_risk_signals(tasks),
        automation_candidates=automation_candidates,
        suggest_ops=build_suggest_ops(tasks, limit=10)
        + [
            SuggestOp(
                op_id="op-101",
                type="epic",
                payload={"title": "Auto status answers"},
                reason="top automation candidate",
            ),
            SuggestOp(
                op_id="op-102",
                type="epic",
                payload={"title": "Chat intake parser"},
                reason="top automation candidate",
            ),
        ],
    )


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def store_approval(package: ApprovePackage) -> None:
    data = read_json(APPROVALS_PATH, {"packages": []})
    packages = data.get("packages", [])
    packages.append(package.model_dump())
    data["packages"] = packages
    write_json(APPROVALS_PATH, data)


def update_approval_status(approve_id: str, status: str) -> ApprovePackage | None:
    data = read_json(APPROVALS_PATH, {"packages": []})
    for package in data.get("packages", []):
        if package.get("approve_id") == approve_id:
            package["status"] = status
            write_json(APPROVALS_PATH, data)
            return ApprovePackage(**package)
    return None


def append_timeline_event(event: TimelineEvent) -> None:
    data = read_json(TIMELINE_PATH, {"events": []})
    events = data.get("events", [])
    events.append(event.model_dump())
    data["events"] = events
    write_json(TIMELINE_PATH, data)


def read_memory() -> dict:
    return read_json(MEMORY_PATH, {"notes": [], "history": []})


def build_memory_response() -> MemoryResponse:
    data = read_memory()
    notes = [MemoryNote(**note) for note in data.get("notes", [])]
    history = data.get("history", [])
    return MemoryResponse(
        notes=notes,
        history=history,
        suggest_ops=[
            SuggestOp(
                op_id="op-201",
                type="note",
                payload={"text": "RMS needs demo link"},
                reason="memory draft",
            )
        ],
    )


def read_performers() -> dict:
    return read_json(PERFORMERS_PATH, {"profiles": {}})


def write_performers(data: dict) -> None:
    write_json(PERFORMERS_PATH, data)


def get_profile(data: dict, person_id: str) -> dict:
    profiles = data.get("profiles", {})
    profile = profiles.get(person_id)
    if not profile:
        profile = {"notes": [], "agent_drafts": [], "history": []}
        profiles[person_id] = profile
        data["profiles"] = profiles
    return profile


def build_fallback_backlog() -> BacklogResponse:
    return BacklogResponse(
        items=[
            InboxItem(
                inbox_id="inbox-101",
                source_type="voice",
                summary="RMS demo flow update with owner",
                status="new",
                project_guess="RMS",
                owner_guess="Masha",
            ),
            InboxItem(
                inbox_id="inbox-102",
                source_type="chat",
                summary="Move Aurora links into CRM",
                status="new",
                project_guess="Aurora",
                owner_guess="Dasha",
            ),
        ],
        needs_verify=[
            InboxItem(
                inbox_id="inbox-201",
                source_type="chat",
                summary="Project? Marketing board revamp",
                status="needs_verify",
            ),
            InboxItem(
                inbox_id="inbox-202",
                source_type="voice",
                summary="Owner? Landing QA checklist",
                status="needs_verify",
            ),
        ],
        unsorted=[
            InboxItem(
                inbox_id="inbox-301",
                source_type="voice",
                summary="Unknown project: Alpha doc clean-up",
                status="unsorted",
            ),
            InboxItem(
                inbox_id="inbox-302",
                source_type="chat",
                summary="No link: Fix timeline screenshot",
                status="unsorted",
            ),
        ],
        project_candidates=["Beta launch", "Gamma refactor"],
        forwardable=[
            "Aurora status: link + next step in CRM",
            "RMS: demo assets due Wed",
        ],
        suggest_ops=build_suggest_ops(),
    )


def build_fallback_today() -> TodayResponse:
    return TodayResponse(
        plan_by_project=[
            PlanLine(label="RMS", details="demo flow -> script draft -> link in CRM"),
            PlanLine(label="Aurora", details="landing QA -> fix checklist -> update status"),
            PlanLine(label="Internal", details="automation backlog review"),
        ],
        plan_by_people=[
            PlanLine(label="Masha", details="RMS demo script, Aurora QA checklist"),
            PlanLine(label="Andre", details="RMS asset cleanup (needs link)"),
            PlanLine(label="Dasha", details="Unsorted triage + CRM links"),
        ],
        risk_signals=[
            "RMS demo task missing artifact link",
            "Aurora landing fix lacks due date",
            "Andre exceeds 2 projects today",
        ],
        suggest_ops=build_suggest_ops(),
    )


def build_fallback_week() -> WeekResponse:
    return WeekResponse(
        by_people=[
            PlanLine(label="Masha", details="Mon RMS (3h), Tue Aurora (2h), Wed RMS (2h)"),
            PlanLine(label="Andre", details="Mon Aurora (4h), Tue Aurora (4h) overload"),
            PlanLine(label="Dasha", details="Thu RMS QA (2h), Fri Unsorted triage (2h)"),
        ],
        by_projects=[
            PlanLine(label="RMS", details="demo flow, QA, asset handoff"),
            PlanLine(label="Aurora", details="landing fix, CRM links, QA checklist"),
            PlanLine(label="Internal", details="automation backlog review"),
        ],
        load_issues=[
            "Andre exceeds 7h/day",
            "Aurora QA checklist missing estimate",
        ],
        suggest_ops=build_suggest_ops(),
    )


def build_fallback_metrics() -> MetricsResponse:
    return MetricsResponse(
        metrics=[
            MetricLine(label="Execution rate", value="78%", note="Up 6% vs last week"),
            MetricLine(label="Unsorted", value="14", note="+9 in 5 days"),
            MetricLine(label="WIP stuck", value="4", note="Need review follow-up"),
            MetricLine(label="Data integrity", value="92%", note="Missing links 3, owners 1"),
        ],
        not_ok_signals=[
            "Unsorted growth +9",
            "WIP stuck above threshold",
        ],
        automation_candidates=[
            AutomationCandidate(label="Plan status answers", count=12, pain="manual replies"),
            AutomationCandidate(label="Task intake from chat", count=9, pain="context loss"),
            AutomationCandidate(label="Data fixes for links", count=7, pain="missing artifacts"),
        ],
        suggest_ops=[
            SuggestOp(
                op_id="op-101",
                type="epic",
                payload={"title": "Auto status answers"},
                reason="top automation candidate",
            ),
            SuggestOp(
                op_id="op-102",
                type="epic",
                payload={"title": "Chat intake parser"},
                reason="top automation candidate",
            ),
        ],
    )


@router.get("/backlog", response_model=BacklogResponse)
async def get_backlog():
    snapshot_dict, tasks = load_crm_snapshot()
    snapshot = SnapshotInfo(**snapshot_dict) if snapshot_dict else None
    intake_items = build_inbox_items(tasks)
    if intake_items:
        return build_backlog_from_intake(intake_items, build_suggest_ops(tasks), snapshot)
    if tasks:
        return build_backlog_response(tasks, snapshot)
    return build_fallback_backlog()


@router.get("/today", response_model=TodayResponse)
async def get_today():
    snapshot_dict, tasks = load_crm_snapshot()
    snapshot = SnapshotInfo(**snapshot_dict) if snapshot_dict else None
    if tasks:
        return build_today_response(tasks, snapshot)
    return build_fallback_today()


@router.get("/week", response_model=WeekResponse)
async def get_week():
    snapshot_dict, tasks = load_crm_snapshot()
    snapshot = SnapshotInfo(**snapshot_dict) if snapshot_dict else None
    if tasks:
        return build_week_response(tasks, snapshot)
    return build_fallback_week()


@router.get("/metrics", response_model=MetricsResponse)
async def get_metrics():
    snapshot_dict, tasks = load_crm_snapshot()
    snapshot = SnapshotInfo(**snapshot_dict) if snapshot_dict else None
    intake_items = build_inbox_items(tasks)
    if tasks:
        return build_metrics_response(tasks, intake_items, snapshot)
    return build_fallback_metrics()


@router.post("/approve", response_model=ApprovePackage)
async def approve_ops(payload: ApproveRequest):
    package = ApprovePackage(
        approve_id=f"approve-{uuid4().hex[:8]}",
        date=now_iso(),
        ops=payload.ops,
        status="approved",
        approved_by=payload.approved_by,
    )
    store_approval(package)
    return package


@router.post("/apply", response_model=ApprovePackage)
async def apply_ops(payload: ApplyRequest):
    if not payload.approve_id:
        raise HTTPException(status_code=400, detail="approve_id is required")

    if not CRM_API_BASE_URL or not CRM_API_TOKEN:
        raise HTTPException(
            status_code=409,
            detail="Apply disabled (fail-closed): set CRM_API_BASE_URL and CRM_API_TOKEN on the server.",
        )

    raise HTTPException(
        status_code=501,
        detail="Apply is not implemented yet: CRM API endpoints/mapping are TBD.",
    )


@router.get("/timeline", response_model=TimelineResponse)
async def get_timeline():
    return TimelineResponse(
        events=[
            TimelineEvent(
                event_id="evt-001",
                date="2026-01-19T09:10:00Z",
                event_type="decision",
                summary="RMS demo scope locked",
                refs=["RMS"],
            ),
            TimelineEvent(
                event_id="evt-002",
                date="2026-01-19T11:40:00Z",
                event_type="patch_applied",
                summary="RMS-88 moved to Review",
                refs=["RMS-88"],
            ),
            TimelineEvent(
                event_id="evt-003",
                date="2026-01-19T12:15:00Z",
                event_type="risk_created",
                summary="Missing link for Aurora QA",
                refs=["AUR-312"],
            ),
        ],
        filters=["project", "assignee", "event_type"],
    )


@router.get("/month", response_model=MonthResponse)
async def get_month():
    return MonthResponse(
        weeks=[
            WeekBlock(label="Week 1", items=["RMS demo assets + QA", "Owner: Masha", "Risk: missing link"]),
            WeekBlock(label="Week 2", items=["RMS launch checklist", "Owner: Andre", "Estimate pending"]),
            WeekBlock(label="Week 3", items=["RMS client demo", "Owner: Dasha", "Status: planned"]),
            WeekBlock(label="Week 4", items=["RMS retrospective", "Owner: Masha", "Artifacts: doc + links"]),
        ],
        filters=["month", "project", "assignee"],
        suggest_ops=build_suggest_ops(),
    )


@router.get("/memory", response_model=MemoryResponse)
async def get_memory():
    return build_memory_response()


@router.post("/memory", response_model=MemoryResponse)
async def add_memory(payload: MemoryCreateRequest):
    data = read_memory()
    note = MemoryNote(
        note_id=f"note-{uuid4().hex[:8]}",
        type=payload.type,
        text=payload.text,
        author=payload.author,
        created_at=now_iso(),
    )
    notes = data.get("notes", [])
    notes.append(note.model_dump())
    data["notes"] = notes
    history = data.get("history", [])
    history.append(f"{note.created_at}: added {note.type}")
    data["history"] = history
    write_json(MEMORY_PATH, data)
    return build_memory_response()


@router.get("/performer/{person_id}", response_model=PerformerResponse)
async def get_performer(person_id: str):
    data = read_performers()
    profile_data = get_profile(data, person_id)
    notes = [MemoryNote(**note) for note in profile_data.get("notes", [])]
    profile = PerformerProfile(
        person_id=person_id,
        notes=notes,
        agent_drafts=profile_data.get("agent_drafts", []),
        history=profile_data.get("history", []),
    )
    return PerformerResponse(
        profile=profile,
        suggest_ops=[
            SuggestOp(
                op_id="op-301",
                type="draft",
                payload={"text": "Add note: prioritize CRM links"},
                reason="agent draft",
            )
        ],
    )


@router.post("/performer/{person_id}/note", response_model=PerformerResponse)
async def add_performer_note(person_id: str, payload: PerformerNoteRequest):
    data = read_performers()
    profile_data = get_profile(data, person_id)
    note = MemoryNote(
        note_id=f"note-{uuid4().hex[:8]}",
        type="person_note",
        text=payload.text,
        author=payload.author,
        created_at=now_iso(),
    )
    notes = profile_data.get("notes", [])
    notes.append(note.model_dump())
    profile_data["notes"] = notes
    history = profile_data.get("history", [])
    history.append(f"{note.created_at}: added person note")
    profile_data["history"] = history
    write_performers(data)
    return await get_performer(person_id)


@router.post("/performer/{person_id}/draft", response_model=PerformerResponse)
async def add_performer_draft(person_id: str, payload: PerformerDraftRequest):
    data = read_performers()
    profile_data = get_profile(data, person_id)
    drafts = profile_data.get("agent_drafts", [])
    drafts.append(payload.text)
    profile_data["agent_drafts"] = drafts
    history = profile_data.get("history", [])
    history.append(f"{now_iso()}: added agent draft")
    profile_data["history"] = history
    write_performers(data)
    return await get_performer(person_id)
