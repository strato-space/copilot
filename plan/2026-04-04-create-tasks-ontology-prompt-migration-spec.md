# 2026-04-04 Create Tasks Ontology/Morphology Prompt Migration Spec

## Status
- Spec status: `Implemented` (primary scope delivered)
- Primary BD issue: `copilot-j7dp` (`closed`, 2026-04-04)
- Closed residual issue: `copilot-2bd3` (`closed`, 2026-04-04)
- Residual quality issue: `copilot-bzt6` (`open`, row_id determinism across reruns)
- Closed residual blocker: `copilot-grzr` (`closed`, 2026-04-04)
- Related issue: `copilot-52pj` (runtime transition exceptions for LLM reformulation)
- Scope:
  - [createTasksAgent.ts](/home/strato-space/copilot/backend/src/services/voicebot/createTasksAgent.ts)
  - [create_tasks.md](/home/strato-space/copilot/agents/agent-cards/create_tasks.md)

## 1. Scholastic Term Normalization
- `Ontology`: classification of candidate statements into classes (`deliverable_task`, `coordination_only`, `input_artifact`, `reference_or_idea`, `status_or_report`) and permitted transitions into persistence surfaces.
- `Morphology`: language-form handling (case endings, token normalization, lexical cleanup).
- `Prompt layer`: semantic interpretation and re-attribution.
- `Runtime layer`: deterministic contract enforcement on the write boundary.

Normalization rule for this spec:
- morphology and lexical policy are prompt-owned;
- persistence transition validity is runtime-owned.

## 2. Ontology-First Diagnosis

### 2.1 Category Mistake in the naive variant
Rejected formulation: “move ontology fully to prompt and keep runtime only for shape checks.”

Why this fails (categorical):
- classification and transition are different ontological kinds;
- prompt can classify probabilistically;
- runtime must authorize transitions deterministically before DB write.

Counterexample:
- model outputs `coordination_only` item inside `task_draft`;
- without runtime transition guard, invalid class reaches persistence even if JSON shape is valid.

Failure type: `categorical` (not empirical).

### 2.2 Minimal sound ontology
- Prompt decides semantics and may reformulate/re-attribute.
- Runtime enforces transition invariants and returns structured rejection causes back to prompt.
- Persistence accepts only invariant-satisfying outputs.

## 3. Goal
Extract language-dependent ontology/morphology logic from TypeScript and place it into prompt policy, while preserving deterministic runtime transition enforcement through structured exceptions (not silent filtering).

## 3.1 Non-goals (to prevent category drift)
- Do not keep or re-introduce language-specific lexical heuristics in TS runtime (`ru` stopwords, pronoun heuristics, case-ending regexes).
- Do not encode session-specific extraction hints in code.
- Do not expand runtime role from transition validator into semantic classifier.
- Do not keep `TASK_NAME_STOPWORDS` (or equivalent denylist) as runtime decision authority.

## 4. Migration Scope

### 4.1 Move from TS to prompt-layer policy
Remove policy ownership in TS for:
- `RUSSIAN_ONTOLOGY_ALLOWLIST`
- `TASK_NAME_STOPWORDS`
- `TASK_SHORT_COVERAGE_TOKENS` when used as semantic policy
- `TASK_OBJECT_ACTION_TOKEN_RE`
- `TASK_ONTOLOGY_*` lexical classifiers
- `TASK_GAP_REPAIR_*` lexical cues for semantic classification
- language-specific structural object morphology cleanup

These become explicit rules in `agents/agent-cards/create_tasks.md`.

`TASK_NAME_STOPWORDS` migration rule:
- TS must not reject, trim, or downgrade candidates based on stopword lexicon.
- Prompt policy may use stopword guidance only as soft linguistic signal inside semantic attribution.
- Final accept/reject stays bound to ontology class + transition legality, not lexical denylist hit.

### 4.2 Keep in TS runtime (non-linguistic)
- parse/validation,
- merge/dedup/id normalization,
- no-task decision consistency,
- retry/error handling,
- deterministic persistence side-effects,
- transition invariants.

Formal invariant:
- For every candidate `c`: write to `task_draft` is allowed iff `class(c)` is in runtime-allowed transition set.
- `class(c)` is prompt-supplied semantic output; runtime only validates transition legality, not lexical evidence.

## 5. Runtime Transition Contract (mandatory)
Runtime must not silently drop invalid candidates.

If `task_draft` contains non-deliverable classes:
1. raise structured transition exception;
2. issue one reformulation retry to prompt with `runtime_rejections` payload;
3. if still invalid, fail fast with machine-readable reason.

Runtime does not decide language/morphology anymore; it decides only validity of transition to write surface.

Required exception payload:
- `candidate_id`
- `attempted_surface` (`task_draft`)
- `candidate_class`
- `violated_invariant_code` (stable enum)
- `message` (human-readable)
- `recovery_action` (`reclassify` | `reattribute` | `discard`)

## 6. Prompt Contract Update
Add/keep in `create_tasks.md`:
- authoritative ontology decision contract,
- explicit materialization criteria,
- explicit non-materialization rules,
- handling for `runtime_rejections`:
  - reclassify/re-attribute invalid candidates,
  - never repeat rejected transitions unchanged,
  - encode discard rationale in `scholastic_review_md`.

## 7. Modalities
- `Necessary`: transition guard in runtime before persistence.
- `Allowed`: prompt-level semantic and morphology rules.
- `Forbidden`: silent runtime filtering of non-deliverables from `task_draft`.
- `Contingent`: one bounded LLM reformulation retry after runtime rejection.

## 8. Implementation Plan

### Phase A: Prompt policy extraction
1. Move lexical/morphology ontology rules into `create_tasks.md`.
2. Remove duplicate semantic lexicons from TS.

### Phase B: Runtime guard simplification
1. Replace silent ontology filtering with structured transition exceptions.
2. Add one retry path with `runtime_rejections`.
3. Preserve fail-fast semantics on repeated invalid transition.
4. Ensure error enums are stable and test-covered (no ad-hoc string drift).

### Phase C: Language portability
1. Remove Russian-specific allowlist/stopword dependence from TS.
2. Keep language behavior in prompt policy and envelope preferences.

### Phase D: Acceptance
1. run targeted suites,
2. run clean-slate replay on reference sessions,
3. compare incremental vs clean replay stability,
4. deploy + smoke.

## 9. Tests and Evidence

### 9.1 Unit/contract
- `createTasksAgentCardContract.test.ts`
- `createTasksAgentRecovery.test.ts`
- Required scenarios:
  - numbered lower-bound preservation,
  - non-deliverable transition rejection,
  - runtime rejection -> LLM reformulation path,
  - structural walkthrough materialization remains valid,
  - runtime has no dependency on language-specific stopword/allowlist constants,
  - candidate is not rejected solely due to stopword surface form when ontology class is deliverable.

### 9.2 Replay
Reference session:
- `69cf65712a7446295ac67771`

Procedure:
1. soft-delete active Draft rows,
2. rerun create_tasks,
3. verify expected task surface,
4. compare with incremental run.

## 10. Acceptance Gates (spec closure)
- Gate 1: no language-dependent ontology lexicon ownership remains in TS.
- Gate 2: runtime transition guard is present and non-silent.
- Gate 3: prompt consumes `runtime_rejections` and reformulates once.
- Gate 4: target replay remains stable (no material divergence between clean/incremental rerun).
- Gate 5: deploy smoke green (`/api/health`) and issue evidence recorded in `bd`.
- Gate 6: grep-level check confirms TS runtime no longer owns ontology lexicons (`TASK_NAME_STOPWORDS`, `RUSSIAN_ONTOLOGY_ALLOWLIST`, analogous language-coupled policy constants).
- Gate 7: runtime decision path contains no lexical denylist branch for task naming (including `TASK_NAME_STOPWORDS` descendants/renames).

## 11. Deliverables
- updated prompt contract in `create_tasks.md`,
- reduced `createTasksAgent.ts` with transition-only runtime guard,
- tests covering structured rejection/retry path,
- replay evidence and closure notes in `bd` (`copilot-j7dp`).
