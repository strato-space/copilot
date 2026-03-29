# Plan Index

Ticket-bound normative docs in `/home/strato-space/copilot/plan`.

Legend:
- `Document status` mirrors the current `## Status` state in the document.
- `Epic issue ID` shows the dedicated epic when the document has one; `—` means the doc is tracked by tasks/follow-ups without a dedicated epic.
- `Issue count` counts related non-epic issues tracked for that document; the epic row itself is excluded.

This index intentionally excludes non-normative reports and comparison/research docs.

| Document | Kind | Document status | Epic issue ID | Issue count | Notes |
| --- | --- | --- | --- | ---: | --- |
| [acp-ui-component-base-spec.md](./acp-ui-component-base-spec.md) | spec | `✅Closed` | `copilot-o7g3` | 13 | Shared ACP UI package wave for `copilot /agents`; extraction, harness acceptance, tri-host verification, and rollout docs are implemented. External registry publication remains a release/operator action, not open implementation work. |
| [2026-03-27-voice-media-attachment-transcription-spec.md](./2026-03-27-voice-media-attachment-transcription-spec.md) | spec | `✅Closed` | `copilot-qtcp` | 8 | Telemost `.webm` driver case; core correctness and optional backfill wave are closed and synced in `bd`. |
| [2026-03-21-voice-task-surface-normalization-spec-2.md](./2026-03-21-voice-task-surface-normalization-spec-2.md) | spec | `⚪Open` | `—` | 4 | Follow-up contract; `copilot-3d7n` and `copilot-muzv` have landed evidence but remain open. |
| [2026-03-18-voice-task-session-discussion-linking-spec.md](./2026-03-18-voice-task-session-discussion-linking-spec.md) | spec | `⚪Open` | `—` | 6 | Discussion-link/comment wave is still design-first; implementation tickets remain open. |
| [voice-non-draft-discussion-analyzer-contract.md](./voice-non-draft-discussion-analyzer-contract.md) | contract | `⚪Open` | `—` | 2 | Separate analyzer contract; tracked by `copilot-roqv` plus related implementation ticket `copilot-zvxa`. |
| [2026-26-03-voice-date-depth-and-range-fix-spec.md](./closed/2026-26-03-voice-date-depth-and-range-fix-spec.md) | spec | `✅Closed` | `copilot-xmcm` | 12 | Moved to `plan/closed`; closed temporal filtering wave; companion execution DAG lives in the `xmcm` swarm plan. |
| [2026-26-03-copilot-xmcm-swarm-plan.md](./closed/2026-26-03-copilot-xmcm-swarm-plan.md) | plan | `✅Closed` | `copilot-xmcm` | 12 | Moved to `plan/closed`; execution DAG companion for the closed `xmcm` spec wave. |
| [voice-task-surface-normalization-spec.md](./closed/voice-task-surface-normalization-spec.md) | spec | `✅Closed` | `copilot-cux2` | 20 | Moved to `plan/closed`; canonical task-surface truth; execution epics `copilot-ojxy` and `copilot-kdqs` are closed; follow-up bug `copilot-f6z4` remains open. |
| [voice-session-possible-tasks-deprecation-plan.md](./closed/voice-session-possible-tasks-deprecation-plan.md) | plan | `✅Closed` | `—` | 5 | Moved to `plan/closed`; completed deprecation wave; parent task is `copilot-kdqs`, not a dedicated epic. |
| [voice-operops-codex-taskflow-spec.md](./closed/voice-operops-codex-taskflow-spec.md) | spec | `✅Closed` | `copilot-bq81` | 35 | Moved to `plan/closed`; main rollout is closed; residual deferred bug `copilot-tmcu` sits outside the completed epic family. |
| [operops-voice-codex-audit-spec-2026-02-28.md](./closed/operops-voice-codex-audit-spec-2026-02-28.md) | audit | `✅Closed` | `copilot-ztlv` | 26 | Moved to `plan/closed`; verification-only pack; one historical tombstone child is omitted from the count; successor execution rollout moved to `copilot-bq81`. |
