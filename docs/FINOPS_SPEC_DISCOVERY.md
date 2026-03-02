# FinOps Spec Discovery (copilot-081q)

## Purpose
This document consolidates the currently known FinOps specification sources and captures unresolved product-scope questions before implementation.

## Canonical Candidate (Copilot)
- `projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/spec.md`
- `projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/TZ.md`
- `projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/data-model.md`
- `projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/contracts/api-spec.yaml`
- `projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/plan.md`
- `projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/tasks.md`
- `projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/research.md`
- `projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/discovery.md`
- `projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/checklists/requirements.md`
- `projects/stratospace/finance-ops/specifications/002-finance-plan-fact-mvp/README.md`

## Additional Copilot FinOps References
- `docs/FINOPS_REALIZTION.md`
- `specs/finops-bonuses.md`

## Duplicate/Mirror Candidate
- `specs/specs/002-finance-plan-fact-mvp/*`

Notes:
- This mirror appears to overlap with the canonical candidate set above.
- Scope ownership and source-of-truth status should be explicitly confirmed before implementation.

## External Input (y-tasks-sandbox)
- `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/01-finops-main.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/02-finops-rasxod.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/03-finops-analytic.md`
- `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/04-finops-agentsidebar.md`

## Open Scope Questions (for Anton)
1. Which source is canonical: `projects/.../specifications/002-...` or `specs/specs/002-...`?
2. Is the current target only Plan-Fact MVP, or also expenses, analytics, agent sidebar, and bonuses/fund?
3. If broader than MVP, what is the required release order?
4. Confirm working-hours source for cost model (`billable_hours * salary / working_hours`).
5. Confirm Fix-contract margin behavior when hours/data are incomplete.
6. Confirm FX fallback policy parity for fact and forecast.
7. Confirm month-close lock matrix (read-only vs editable fields after close).
8. Confirm CRM freshness SLA and alerting policy.
9. Confirm whether bonuses/fund is mandatory in the current cycle.
10. Confirm whether access-role model must expand beyond current MVP assumptions.

## Current Status
- Discovery completed.
- No implementation changes are tied to this document.
- Task remains pending product-scope confirmation.
