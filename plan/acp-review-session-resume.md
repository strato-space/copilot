# ACP Review Session Resume

Recovered on 2026-03-29 and refreshed on 2026-03-30 from local Codex session logs, the replayed `tmux` pane, `codex-session-scout`, and current `bd` state.

This file is the handoff for continuing the ACP review/fix wave in a fresh Codex session. It supersedes the earlier "review just finished" snapshot because several ACP follow-up bugs were fixed later the same day.

## Canonical Sessions

- Authoritative parent ACP thread: `019c4a06-89e1-75c1-9dcd-65bd54e53e34`
- Parent title in the local Codex index: `Explain ACP request`
- Parent source log:
  - `/root/.codex/sessions/2026/02/11/rollout-2026-02-11T03-07-48-019c4a06-89e1-75c1-9dcd-65bd54e53e34.jsonl`
- Governing specs used by the ACP review/fix wave:
  - `/home/strato-space/copilot/plan/acp-ui-component-base-spec.md`
  - `/home/strato-space/copilot/plan/closed/2026-26-03-voice-date-depth-and-range-fix-spec.md`

Treat the parent thread above as the authoritative conversation root. The `tmux` pane replay mixed ACP review output with later recovery/debug sessions; the raw parent thread and the issue state below are more reliable than pane scrollback. Direct session-log recovery did not surface any additional ACP follow-up fixes beyond what is normalized in this handoff.

## Review Subagents

On 2026-03-29 the parent thread spawned these review subagents for the ACP UI wave. Each child log is available locally under `/root/.codex/sessions/2026/03/29/`.

- `Pauli` -> source issue `copilot-ooc6` -> session `019d391f-fc81-7673-a0cb-42bc7971fc56`
- `Arendt` -> source issue `copilot-9zab` -> session `019d391f-ffb7-7c31-b057-704f1d39f0e7`
- `Peirce` -> source issue `copilot-412g` -> session `019d3920-03e2-7c83-b76e-9605820ab175`
- `Pasteur` -> source issue `copilot-ikuc` -> session `019d3920-08cf-7682-9c5e-a6ea94a99cca`
- `Godel` -> source issue `copilot-xklc` -> session `019d3920-0d74-7462-8558-842156798a63`
- `Erdos` -> source issue `copilot-y177` -> session `019d3920-11f0-7ea2-a640-d49d5d3546bf`
- `Hume` -> source issue `copilot-qpeq` -> session `019d3920-615b-7091-aed7-253da3cf5f97`
- `Mendel` -> source issue `copilot-2u41` -> session `019d3920-648a-79d2-b768-a10c41680c07`
- `Hubble` -> source issue `copilot-mhcy` -> session `019d3920-6980-7631-b1d4-a0813c636bfa`
- `Singer` -> source issue `copilot-8cuf` -> session `019d3920-71da-7e91-a42a-c01d1d4fa2fa`
- `Popper` -> source issue `copilot-72r5` -> session `019d3920-7b7d-7511-acc8-6a42e015dad2`
- `Volta` -> source issue `copilot-bshq` -> session `019d3920-806e-7982-bd81-06afe6538c20`
- `Harvey` -> source issue `copilot-m39w` -> session `019d3920-876e-74c3-ab7f-4fd3c7b9530f`

The aggregate review packet was normalized into:

- `copilot-n6mu` -> `Review: ACP UI wave implementation findings` -> now `closed`

## Source ACP Wave Context

The review wave audited the already-implemented ACP extraction tasks from the governing spec. Those source implementation tasks are closed and should be treated as the baseline implementation that the bug-follow-up work is repairing.

- `copilot-ooc6` -> `T1 Package Skeleton for @strato-space/acp-ui` -> `closed`
- `copilot-9zab` -> `T2 Stable Bridge Contract (Host Adapter API)` -> `closed`
- `copilot-412g` -> `T3 Library Build + Peer Dependency Hygiene` -> `closed`
- `copilot-xklc` -> `T5 Migrate ACP Plugin Webview to Package Consumption` -> `closed`
- `copilot-y177` -> `T6 Migrate acp-chat Web to Package Consumption` -> `closed`
- `copilot-qpeq` -> `T7 Publishing Pipeline to GitHub Packages` -> `closed`
- `copilot-2u41` -> `T7a Internal Prerelease Consumption Boundary` -> `closed`
- `copilot-mhcy` -> `T8 Copilot ACP Transport Adapter` -> `closed`
- `copilot-8cuf` -> `T9 Route Contract /agents/session/:id` -> `closed`
- `copilot-72r5` -> `T10 Theme + Responsive Host Integration` -> `closed`
- `copilot-bshq` -> `T11 Cross-Repo Verification Matrix` -> `closed`
- `copilot-m39w` -> `T12 Copilot docs/changelog update for shared acp-ui` -> `closed`

## Normalized ACP Bugs: Current State

These are the bugs produced by the review wave, but updated to the current `bd` state as of this handoff.

### Already Fixed

- `copilot-iseg` -> `Bug: /agents deep-link session restore is broken on cold load` -> `closed`
  - Fix summary: `AgentsOpsPage` now keeps the requested `/agents/session/:id` route authoritative during hydration and re-runs session selection after sessions state changes.
  - Files changed:
    - `app/src/pages/AgentsOpsPage.tsx`
    - `app/__tests__/agents/agentsDeepLinkRestore.test.tsx`
- `copilot-84qr` -> `Bug: acp-ui tarball omits vscode declaration dependency` -> `closed`
  - Fix summary: package build now ships `dist/vscode.d.ts`, and the clean consumer smoke was strengthened to require strict `tsc --noEmit`.
  - Files changed:
    - `/home/tools/acp/strato-space/acp-plugin/packages/acp-ui/package.json`
    - `/home/tools/acp/strato-space/acp-plugin/scripts/smoke-acp-ui-consumer.sh`
- `copilot-q6tj` -> `Bug: webview test pipeline passes against stale out artifacts` -> `closed`
  - Fix summary: acp-plugin `pretest` / `precoverage` now clear the full `out/` tree so stale compiled artifacts cannot mask regressions.
  - Files changed:
    - `/home/tools/acp/strato-space/acp-plugin/package.json`
- `copilot-p8si` -> `Bug: selecting unavailable ACP agent desynchronizes UI and backend` -> `closed`
  - Fix summary: ACP socket now rejects unavailable-agent selection without emitting a false `agentChanged` or fake `disconnected` state, and shared ACP UI now ignores `agentChanged` for known unavailable agents as a defensive guard.
  - Files changed:
    - `/home/strato-space/copilot/backend/src/api/socket/acp.ts`
    - `/home/strato-space/copilot/backend/__tests__/services/acpSocketAgentSelection.test.ts`
    - `/home/tools/acp/strato-space/acp-plugin/packages/acp-ui/src/hooks/agentSelection.ts`
    - `/home/tools/acp/strato-space/acp-plugin/packages/acp-ui/src/hooks/useVsCodeApi.ts`
    - `/home/tools/acp/strato-space/acp-plugin/packages/acp-ui/src/hooks/agentSelection.test.ts`
    - `/home/tools/acp/strato-space/acp-plugin/package.json`
- `copilot-81xk` -> `Bug: Copilot harness can pass without acp-ui stylesheet` -> `closed`
  - Fix summary: the harness route now imports `@strato-space/acp-ui/styles.css`, source-level ACP surface tests assert that import for both `/agents` and `/__harness/agents`, and Playwright harness acceptance verifies ACP stylesheet rules are actually present in the browser.
  - Files changed:
    - `/home/strato-space/copilot/app/src/pages/AgentsHarnessPage.tsx`
    - `/home/strato-space/copilot/app/__tests__/agents/agentsAcpSurfaceContract.test.ts`
    - `/home/strato-space/copilot/app/e2e/agents-harness.spec.ts`
- `copilot-8uf9` -> `Bug: tri-host eval baseline does not validate real copilot /agents host` -> `closed`
  - Fix summary: the Copilot app now has a dedicated `npm run test:agents:runtime` lane that mounts the real `AgentsOpsPage`, verifies auth-token -> ACP socket wiring, ACP host-bridge injection, runtime event forwarding, and teardown, and the canonical ACP UI eval baseline now requires that runtime path.
  - Files changed:
    - `/home/strato-space/copilot/app/__tests__/agents/agentsOpsRuntimeContract.test.tsx`
    - `/home/strato-space/copilot/app/package.json`
    - `/home/tools/acp/strato-space/acp-plugin/docs/ACP_UI_EVAL_BASELINE.md`
- `copilot-uy3v` -> `Bug: real /agents host shell is not covered by mobile acceptance` -> `closed`
  - Fix summary: the Copilot app now has deterministic Playwright mobile acceptance for the real `/agents` route inside `MainLayout`, using an injected ACP socket harness so the test does not depend on a live backend, and the canonical ACP UI eval baseline now requires that real-shell route.
  - Files changed:
    - `/home/strato-space/copilot/app/src/services/acpSocket.ts`
    - `/home/strato-space/copilot/app/e2e/agents-shell.spec.ts`
    - `/home/strato-space/copilot/app/package.json`
    - `/home/tools/acp/strato-space/acp-plugin/docs/ACP_UI_EVAL_BASELINE.md`
- `copilot-ehme` -> `Bug: copilot app file: prerelease lane breaks when acp-ui dist is absent` -> `closed`
  - Fix summary: the local `file:` prerelease lane now materializes `dist/` through the package `prepare` lifecycle, and a dedicated `smoke:acp-ui:file-consumer` check proves a dist-less source copy installs and builds cleanly for a browser consumer.
  - Files changed:
    - `/home/tools/acp/strato-space/acp-plugin/packages/acp-ui/package.json`
    - `/home/tools/acp/strato-space/acp-plugin/scripts/smoke-acp-ui-file-consumer.sh`
    - `/home/tools/acp/strato-space/acp-plugin/package.json`
    - `/home/tools/acp/strato-space/acp-plugin/packages/acp-ui/README.md`

### Already Fixed After Session Recovery

- `copilot-vg8c` -> `Bug: acp-ui publish workflow lacks semver enforcement` -> `closed`
  - Fix summary: the ACP UI publish lane now derives the package semver from release tags in the form `acp-ui-v<semver>`, syncs `packages/acp-ui/package.json` to that derived version before build/publish, and verifies the package version matches the release tag. A dedicated `acp-ui-release-version` helper and test suite now enforce the contract.
  - Files changed:
    - `/home/tools/acp/strato-space/acp-plugin/.github/workflows/publish-acp-ui-package.yml`
    - `/home/tools/acp/strato-space/acp-plugin/scripts/acp-ui-release-version.mjs`
    - `/home/tools/acp/strato-space/acp-plugin/scripts/acp-ui-release-version.test.mjs`
    - `/home/tools/acp/strato-space/acp-plugin/package.json`
    - `/home/tools/acp/strato-space/acp-plugin/packages/acp-ui/README.md`

### Still Open

- No ACP follow-up bugs remain open from this review wave. The implementation backlog produced by the ACP review is fully closed in `bd`.

## Live Browser Verification Done In The Same Thread

### OperOps Draft/Archive Depth

- `copilot-v9d3` -> `Verify OperOps Draft/Archive depth counts across 1d/7d/14d/30d/Infinity` -> `closed`
- Verified against `https://copilot.stratospace.fun/operops/crm`
- Recorded counts:
  - `1d` -> `Draft 0`, `Archive 0`
  - `7d` -> `Draft 160`, `Archive 0`
  - `14d` -> `Draft 362`, `Archive 30`
  - `30d` -> `Draft 693`, `Archive 35`
  - `Infinity` -> `Draft 2060`, `Archive 3002`
- Conclusion:
  - all counts matched expectations from the closed date-depth-range spec
  - no follow-up bug is needed

### `/agents` Settings Dialog

- `copilot-phe1` -> `Bug: /agents Settings dialog shows disconnected and no agents available` -> `closed`
- Live verification concluded:
  - Settings displayed `Connected`
  - agent combobox was populated
  - mode/model/reasoning controls were present
  - original screenshot state was not reproducible on live

## What Not To Redo

- Do not restart from `copilot-iseg`, `copilot-84qr`, or `copilot-q6tj`; they are already fixed and closed.
- Do not restart from `copilot-81xk` or `copilot-8uf9`; they are already fixed and closed.
- Do not restart from `copilot-uy3v`; it is already fixed and closed.
- Do not restart from `copilot-ehme`; it is already fixed and closed.
- Do not restart from `copilot-vg8c`; it is already fixed and closed.
- Do not reopen `copilot-phe1` without a fresh live repro on `/agents`.
- Do not spend more time on OperOps Draft/Archive depth counts unless new regression evidence appears; `copilot-v9d3` already closed that verification branch.

## Recommended Restart Point Now

There is no remaining ACP bug frontier from this review wave. A new session should treat the ACP follow-up implementation backlog as closed and only reopen the branch if fresh regression evidence appears.

## Suggested Bootstrap Prompt For A New Session

Use this file as the handoff and treat the ACP follow-up bug backlog as already closed. Start a new ACP session only if there is fresh regression evidence or a new bounded issue.

`Read /home/strato-space/copilot/plan/acp-review-session-resume.md and treat session 019c4a06-89e1-75c1-9dcd-65bd54e53e34 as the authoritative parent thread. The ACP follow-up bug backlog from that review wave is already closed; only continue if new regression evidence exists or a new bounded issue has been opened in bd.`
