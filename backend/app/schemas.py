from typing import Literal, Optional

from pydantic import BaseModel, Field


class SnapshotInfo(BaseModel):
    filename: str
    date: Optional[str] = None


class ItemBase(BaseModel):
    name: str
    description: Optional[str] = None


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class Item(ItemBase):
    id: int


class CRMTask(BaseModel):
    task_id: str
    title: str
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    status_raw: Optional[str] = None
    status: str
    priority: Optional[str] = None
    created_at: Optional[str] = None
    upload_date: Optional[str] = None
    order: Optional[int] = None
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    task_type_id: Optional[str] = None
    task_type_name: Optional[str] = None
    description: Optional[str] = None
    epic: Optional[str] = None
    estimate_h: Optional[float] = None
    updated_at: Optional[str] = None
    source: Optional[str] = None


class InboxItem(BaseModel):
    inbox_id: str
    source_type: str
    summary: str
    status: str
    project_guess: Optional[str] = None
    owner_guess: Optional[str] = None
    priority: Optional[str] = None


class SuggestOp(BaseModel):
    op_id: str
    type: Literal[
        "create",
        "update",
        "link",
        "assign",
        "status",
        "due",
        "links",
        "move",
        "split",
        "epic",
        "risk",
        "note",
        "draft",
    ]
    payload: dict
    reason: str
    source_ref: Optional[str] = None


class ApprovePackage(BaseModel):
    approve_id: str
    date: str
    ops: list[SuggestOp]
    status: Literal["ready", "approved", "applied"]
    approved_by: Optional[str] = None


class ApproveRequest(BaseModel):
    ops: list[SuggestOp] = Field(default_factory=list)
    context: Optional[str] = None
    approved_by: Optional[str] = None


class ApplyRequest(BaseModel):
    approve_id: Optional[str] = None


class TimelineEvent(BaseModel):
    event_id: str
    date: str
    event_type: str
    summary: str
    refs: list[str] = Field(default_factory=list)


class MemoryNote(BaseModel):
    note_id: str
    type: Literal["project_note", "person_note", "strategy_note"]
    text: str
    author: str
    created_at: str


class MemoryCreateRequest(BaseModel):
    type: Literal["project_note", "person_note", "strategy_note"]
    text: str
    author: str


class PerformerProfile(BaseModel):
    person_id: str
    notes: list[MemoryNote] = Field(default_factory=list)
    agent_drafts: list[str] = Field(default_factory=list)
    history: list[str] = Field(default_factory=list)


class PerformerNoteRequest(BaseModel):
    text: str
    author: str


class PerformerDraftRequest(BaseModel):
    text: str
    author: Optional[str] = None


class PlanLine(BaseModel):
    label: str
    details: str


class MetricLine(BaseModel):
    label: str
    value: str
    note: Optional[str] = None


class AutomationCandidate(BaseModel):
    label: str
    count: int
    pain: str


class WeekBlock(BaseModel):
    label: str
    items: list[str]


class BacklogResponse(BaseModel):
    snapshot: Optional[SnapshotInfo] = None
    items: list[InboxItem]
    needs_verify: list[InboxItem]
    unsorted: list[InboxItem]
    project_candidates: list[str]
    forwardable: list[str]
    suggest_ops: list[SuggestOp]


class TodayResponse(BaseModel):
    snapshot: Optional[SnapshotInfo] = None
    plan_by_project: list[PlanLine]
    plan_by_people: list[PlanLine]
    risk_signals: list[str]
    suggest_ops: list[SuggestOp]


class WeekResponse(BaseModel):
    snapshot: Optional[SnapshotInfo] = None
    by_people: list[PlanLine]
    by_projects: list[PlanLine]
    load_issues: list[str]
    suggest_ops: list[SuggestOp]


class MetricsResponse(BaseModel):
    snapshot: Optional[SnapshotInfo] = None
    metrics: list[MetricLine]
    not_ok_signals: list[str]
    automation_candidates: list[AutomationCandidate]
    suggest_ops: list[SuggestOp]


class TimelineResponse(BaseModel):
    events: list[TimelineEvent]
    filters: list[str]


class MonthResponse(BaseModel):
    weeks: list[WeekBlock]
    filters: list[str]
    suggest_ops: list[SuggestOp]


class MemoryResponse(BaseModel):
    notes: list[MemoryNote]
    history: list[str]
    suggest_ops: list[SuggestOp]


class PerformerResponse(BaseModel):
    profile: PerformerProfile
    suggest_ops: list[SuggestOp]


class TasksResponse(BaseModel):
    snapshot: Optional[SnapshotInfo] = None
    tasks: list[CRMTask]
    suggest_ops: list[SuggestOp]


class IntakeResponse(BaseModel):
    snapshot: Optional[SnapshotInfo] = None
    items: list[InboxItem]


class ProjectRef(BaseModel):
    project_id: str
    project_name: Optional[str] = None


class ProjectsResponse(BaseModel):
    snapshot: Optional[SnapshotInfo] = None
    projects: list[ProjectRef]
