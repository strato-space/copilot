# Спецификация: ACP UI как компонентная база для Copilot Agents

## Status ✅Completed

- Tracking epic: `copilot-o7g3` (`ACP UI reusable package integration for Copilot /agents`)
- Dependency baseline: `copilot-xmcm` и companion-spec [2026-26-03-voice-date-depth-and-range-fix-spec.md](/home/strato-space/copilot/plan/closed/2026-26-03-voice-date-depth-and-range-fix-spec.md) должны быть закрыты до начала реализации этой волны; на момент фиксации этой спеки dependency chain уже закрыт.
- Companion execution DAG for dependency chain: [2026-26-03-copilot-xmcm-swarm-plan.md](/home/strato-space/copilot/plan/closed/2026-26-03-copilot-xmcm-swarm-plan.md)
- Plan status: architecture + delta artifact; repositories now contain implemented package extraction, ACP host wiring, canonical eval baseline, reproducible browser harness acceptance, cross-repo build/type/test proof, and deterministic package-consumer smoke for the ACP path. External registry publication remains an operator/release action rather than a blocker for implementation closure.
- `bd` normalization status: task set `T1..T12` + `T7a` materialized under epic `copilot-o7g3`, dependencies normalized to match this spec, snapshot synced on 2026-03-29.
- Implementation frontier: none inside the implementation wave; `T1`, `T2`, `T3`, `T4`, `T5`, `T6`, `T7`, `T7a`, `T8`, `T9`, `T10`, `T11`, and `T12` are implemented with code/test/documentation evidence. External registry publication remains a separate release/operator action.
- Snapshot date: 2026-03-29

**Статус документа**: completed architecture + observed delta, dependency chain satisfied, ACP extraction wave implemented and documented  
**Дата**: 2026-03-29  
**Основание**: текущая архитектурная цель для `ACP Plugin` и `Copilot /agents`, существующий epic `copilot-o7g3`, репозиторные ограничения из [AGENTS.md](/home/strato-space/copilot/AGENTS.md).

## 1. Definitions and Assumptions

### 1.1 Core Terms

- `ACP wire protocol` — the message-exchange protocol between an ACP-compatible client and an agent service. It is neither a UI nor a host shell.
- `ACP UI kernel` — the set of React components, state orchestration, and rendering contracts for ACP conversation surfaces. It is neither protocol authority nor a standalone app.
- `ACP UI package artifact` — the publishable carrier of the ACP UI kernel as the npm package `@strato-space/acp-ui`. It does not create a new domain entity above the kernel, but it does define a public API boundary (`exports`, versioned install surface, consumer contract).
- `Versioned contract governance` — the locus where required public exports, host-port interfaces, and ACP UI kernel conformance rules evolve. Governance belongs to the versioned contract/kernel line, not to the artifact delivery channel.
- `Host shell` — the concrete application that embeds ACP UI:
  - VS Code webview shell,
  - `acp-chat` browser shell,
  - `copilot /agents` shell.
- `Bridge` — the aggregate contract between the ACP UI kernel and a host/runtime. It must not become one monolithic object; it is composed from separate host ports and governed through versioned contract governance.
- `TransportAdapter` — the host port specifically for ACP message/state transport and ACP runtime events. It is not a generic app transport and not an MCP invocation surface.
- `HostPersistenceAdapter` — the host port for persisting and restoring UI/session state.
- `RouteAdapter` — the host port for synchronizing ACP session state with the URL/navigation model of a host app where applicable.
- `Coding agent runtime surface` — an executable non-human agent surface in the sense of `coding_agent` from the ontology; in `copilot`, the nearest runtime contour is materialized through the Fast-Agent service and agent cards under `agents/agent-cards/*`.
- `Reusable package` — a package artifact that consumer applications install as a dependency rather than copying a source tree. Within this execution wave, two install lanes are allowed: internal prerelease consumption and external registry publish.
- `Consumer` — an application that uses `@strato-space/acp-ui` and supplies its own host bridge.
- `Theme contract` — the minimum set of CSS variables / theme tokens that the package defines and the host maps into its own theme system.
- `Internal prerelease consumption` — consumption of the shared package inside two locally available repositories through a workspace/file dependency or another explicit non-registry link suitable for build/test/CI before external publish.
- `Route contract` — the way ACP UI state is bound to host-app URLs, for example `/agents` and `/agents/session/:id`.

### 1.2 Ontology Constraints

In this spec:
- `acp-ui` = a library/kernel, not an app;
- `@strato-space/acp-ui` = the package artifact that carries the kernel;
- `ACP Plugin`, `acp-chat`, `copilot /agents` = consumers/hosts;
- `ACP` = a protocol family, not a package name and not a specific frontend;
- `bridge` = an aggregate adapter boundary, not the semantic owner of the UI or the protocol.

This yields hard constraints:
- the UI package must not be treated as the protocol;
- the Copilot host must not be treated as the owner of shared UI semantics;
- a VS Code-specific runtime must not be treated as the universal form of ACP UI;
- the `/agents` UI must not be treated as an ontology authoring surface for `executor_routing`, `task_execution_run`, or other execution-layer objects;
- transport, persistence, and routing must not be collapsed into an indistinguishable god-adapter;
- the MCP runtime path must not be used as the canonical transport surface for ACP `/agents`;
- extraction must not be considered complete if only source code was moved without a stable contract surface.

The last point is critical: a `shared package` without clear exports, a bridge contract, and a consumer boundary does not solve duplication; it only relocates source files.

### 1.3 Assumptions and Hypotheses

Confirmed assumptions:
- the architectural intent of the `acp-plugin` repository allows its UI to be used as a component base rather than only as an internal implementation detail;
- `copilot` already has the tracking epic `copilot-o7g3` for this integration wave;
- the deliberate repo-level tooling constraint remains in force: the working contour intentionally stays on `bd 0.49.6` rather than the latest upstream;
- `acp-plugin` already contains `packages/acp-ui` as a source tree used by the webview and `acp-chat` via path aliases; what is missing is not UI code itself but a stable package artifact and public package contract;
- the ACP common surface across hosts is large enough to justify a shared kernel, while host-specific affordances do not need to be identical.

Hypotheses that this execution wave must verify:
- `acp-ui` already has a sufficiently mature internal kernel to be extracted into a package without a total redesign;
- `copilot /agents` is compatible with ACP UX semantics and will not require a competing interaction model;
- GitHub Packages is operationally acceptable as a distribution channel for all consumer environments;
- the package boundary will not damage the delivery velocity of ACP Plugin.

Modalities must remain separated:
- **Necessity**:
  - separate protocol, package, and host shell;
  - maintain one family of host-port contracts;
  - eliminate source-copy drift.
- **Normative restriction for this program of work**:
  - use the three-port bridge decomposition (`TransportAdapter`, `HostPersistenceAdapter`, `RouteAdapter`) as the canonical contract shape for this execution wave;
  - treat an unsupported host port as absent, not as a noop-compatible placeholder.
- **Possibility**:
  - publish through GitHub Packages;
  - reuse `acp-ui` with minimal redesign;
  - use `/agents/session/:id` as the canonical deep-link shape.
- **Hypothesis**:
  - package extraction will reduce duplication/drift faster and cheaper than local integration without a package;
  - responsive/theming concerns can be solved at the host-contract level without redesigning the ACP UI kernel.

## 2. Summary

The goal of this spec is to:
- make `acp-plugin/packages/acp-ui` the canonical ACP UI kernel;
- package it as `@strato-space/acp-ui`;
- use the same UI contour in three host environments:
  - VS Code ACP Plugin,
  - browser `acp-chat`,
  - `copilot` routes `/agents` and `/agents/session/:id`;
- avoid copying ACP UI code into `copilot`, and instead consume a shared package with host-specific bridges/adapters;
- keep the ACP wire protocol independent from the UI package;
- keep ACP transport on `/agents` independent from the MCP runtime path;
- encode dependency-aware execution through BD issues and DAG.

The core thesis:
- `acp-ui` must not become another application or the “owner of the protocol”;
- `acp-ui` must become a reusable UI/kernel library;
- `acp-ui` must not become the owner of endpoint discovery, runtime routing, or host-app network policy;
- ACP protocol, kernel, package artifact, host shell, and host adapters must remain distinct entities with distinct responsibilities.

## 2.1 Harness Alignment

This execution wave must follow the principle from `factory/harness.md`: quality comes from the harness, not from the model alone. For this spec, that means:
- repository state and the checked-in eval surface are the system of record;
- canonical guarantees are extracted from `acp-plugin` code and tests, not invented afresh inside `copilot`;
- ACP package extraction counts as high-quality only if host consumers are validated through a shared eval matrix;
- prompt quality and model choice are secondary to contract boundaries, tools, evals, feedback loops, and deterministic host adapters.

Consequence: the automatic implementation cycle must be eval-first and repo-grounded. Any task whose completion is defined only by prose/diff without a repeatable check remains under-normalized.

Execution policy alignment with `copilot/AGENTS.md`:
- bounded swarm/subagent execution is preferred when practical, but final integration and final acceptance remain the responsibility of the parent thread;
- browser-based acceptance is canonical for UI work;
- layout acceptance must include screenshot-level overlap checks, not only DOM/CSS assertions;
- spec-governed implementation packets must carry both the `bd` issue id and the governing spec path;
- child execution must start with `bd show <id> --json` and reading the governing spec before any repo reads/edits;
- the ticket provides bounded execution scope, the spec provides normative contract, and AGENTS authority precedence still overrides both.
- `spec_id` remains the bd-native issue field for linking a governing specification document; for spec-driven execution in this repo, the literal full path should also be duplicated in `metadata.source_ref`;
- when `metadata.source_ref` is present in `bd show <id> --json`, that field is the authoritative governing spec full path for the task;
- if `metadata.source_ref` is absent, execution falls back to `spec_id` as the governing spec reference;
- if the parent packet provides a different spec path than `metadata.source_ref` (or `spec_id` when no full-path duplicate exists), execution must stop and report the mismatch instead of choosing locally.

## 3. Normative Scope of This Document

### 3.1 What This Document Does

This document:
- fixes the target architecture for the shared ACP UI package;
- normalizes the vocabulary for `library vs app vs host adapter vs protocol`;
- defines the dependency graph and execution decomposition into `T1..T12`;
- defines acceptance criteria for `acp-plugin`, `acp-chat`, and `copilot`.

### 3.2 What This Document Does Not Do

This document:
- does not start code changes by itself;
- does not mean `copilot /agents` may already be switched to the new package;
- does not change the current runtime contract of `copilot` by decree;
- does not authorize automatic upgrades of pinned tooling just because upstream is newer.

### 3.3 Repo/Tooling Constraints

- `copilot` tracks this work through `bd`; execution must use the existing epic `copilot-o7g3` and its related tasks.
- Every artifact-changing step in this wave must be covered by a claimed or created `bd` issue before edits begin; do not rely on implicit scope.
- Deliberate tooling constraint: the working contour intentionally stays on `bd 0.49.6`; the existence of upstream `0.62` is not, by itself, grounds for an upgrade in this wave.
- This spec is authored as a planning artifact inside `copilot`, but real implementation spans two repositories:
  - `/home/tools/acp/strato-space/acp-plugin`
  - `/home/strato-space/copilot`

## 4. Context and Problem

### 4.1 Current State

ACP UI logic currently lives in `acp-plugin` and is already treated in practice as more than the internal UI of a single extension.
At the same time, `acp-plugin` already contains `packages/acp-ui` as a shared source tree, and both `src/views/webview` and `acp-chat/web` already reference it through TypeScript/Vite aliases.
Therefore the immediate task is not to “invent an ACP UI package”, but to turn the existing shared source tree into a stable package artifact and consumer contract.

At the same time, `copilot /agents` needs an ACP-compatible surface, but porting or forking the UI into `copilot` is the wrong shape:
- it would duplicate state/rendering logic;
- it would create drift between ACP Plugin and Copilot;
- it would make testing and rollout harder.

The current repo snapshot already shows a provisional internal prerelease lane: `copilot/app/package.json` consumes `@strato-space/acp-ui` through an explicit `file:` dependency. This does not replace the publish lane, but it does prove that cross-repo consumption must be normalized separately from external registry publication.

### 4.2 Why a Package Rather Than a “Port”

Required architectural shape:
- one ACP UI kernel;
- multiple host adapters;
- one shared test surface;
- controlled packaging/distribution.

Forbidden shape:
- copying ACP UI sources into `copilot`;
- feature divergence between ACP Plugin and Copilot;
- ad hoc bridging where each host renders ACP events on its own terms.

### 4.3 Observed State + Delta To Target

At the time this spec is fixed, the codebase already contains important parts of the target contour:
- `@strato-space/acp-ui` is already materialized as a package artifact in `packages/acp-ui/package.json`;
- `copilot/app/package.json` already uses the internal prerelease install lane through an explicit `file:` dependency;
- `copilot` already contains route wiring for `/agents/session/:sessionId`.

Therefore this spec must not pretend to be a zero-state plan. Its job is to fix:
- what is already materialized;
- what architectural delta still remains;
- which guarantees and evals must become the gating surface for a fully automatic execution cycle.

### 4.4 Existing Deduplication Hotspots Inside `acp-plugin`

Inside `/home/tools/acp/strato-space/acp-plugin`, several duplication hotspots are already visible and must be resolved in explicit phases:
- shared ACP UI behavior lives in `packages/acp-ui`, but host-specific bootstraps and legacy entrypoints still exist around it;
- `acp-chat/web/src/main.tsx` already uses `@strato-space/acp-ui`, while `acp-chat/web/main.ts` remains a legacy imperative surface and must either be eliminated or explicitly removed from the canonical runtime path;
- guarantees are fragmented across several test surfaces:
  - `src/test/*.test.ts`
  - `packages/acp-ui/**/*.test.ts`
  - `packages/acp-runtime-shared/index.test.js`
  - `e2e/*.spec.ts`
- host bootstraps must remain thin shells rather than sites of repeated materialization of UI/kernel semantics.

### 4.5 Deduplication Phases Inside `acp-plugin`

Deduplication inside `acp-plugin` must proceed in phases:
- **Phase D1 — entrypoint dedup**:
  - make `packages/acp-ui` the sole source of truth for chat UI behavior;
  - eliminate or archive legacy `acp-chat/web/main.ts` if it is no longer a canonical entrypoint;
  - keep `src/views/webview/src/main.tsx` and `acp-chat/web/src/main.tsx` as thin host bootstraps.
- **Phase D2 — runtime/settings dedup**:
  - keep shared ACP/runtime transforms and agent/settings resolution in `packages/acp-runtime-shared` or an equivalent shared contract layer;
  - prevent re-materialization of those rules inside the extension host, browser shell, and Copilot consumer.
- **Phase D3 — eval dedup**:
  - extract the canonical set of guarantees from existing tests/e2e;
  - turn them into a tri-host conformance matrix for:
    - VS Code extension,
    - browser `acp-chat`,
    - `copilot /agents`.

## 5. Target Contract (To Be)

### 5.1 Package Contract

A publishable package is required:
- package name: `@strato-space/acp-ui`
- source of truth: existing source tree `acp-plugin/packages/acp-ui`
- consumers:
  - ACP Plugin webview
  - `acp-chat`
  - `copilot /agents`

The package must export:
- `AcpUiApp`
- public UI types
- bridge interfaces
- shared bridge primitives and reference helpers where applicable
- CSS/theme entrypoints

The package is not required to own host-specific adapters:
- the VS Code-specific adapter remains a VS Code host concern;
- the `acp-chat` websocket adapter remains a browser-host concern;
- the Copilot ACP adapter remains a `copilot` concern.

The package must own only what forms the shared ACP UI contract:
- kernel components,
- shared types,
- host-port interfaces,
- optional reference helpers that do not replace host-specific ownership.

The work counts as solved only if extraction yields a stable contract surface:
- package exports;
- type-safe host-port contracts (`TransportAdapter`, `HostPersistenceAdapter`, `RouteAdapter`);
- theme contract;
- consumer integration contract;
- at least one non-native consumer connected without source-alias coupling.

If package extraction provides only relocated code without these boundaries, the duplication/drift problem remains unsolved.

### 5.2 Bridge Contract

In this spec, the bridge must not be understood as one object with arbitrary authority, but as an aggregate contract over distinct host ports.

At minimum, the bridge layer must separate:
- `TransportAdapter`:
  - message/state transport,
  - inbound agent/runtime events;
- `HostPersistenceAdapter`:
  - host persistence hooks,
  - state/session restore semantics;
- `RouteAdapter`:
  - host routing integration,
  - URL/session synchronization where the host actually has a URL/navigation model.

The bridge must not:
- be coupled to `acquireVsCodeApi` as the only runtime;
- leak concrete host-shell knowledge into the shared UI package;
- make the ACP UI kernel depend on websocket specifics or VS Code specifics;
- become a god-adapter that owns transport, persistence, routing, and host UX semantics simultaneously.

Authority note:
- the public bridge contract is governed through the versioned contract surface of `@strato-space/acp-ui`, but authority belongs to versioned contract governance rather than to the package artifact as a delivery channel;
- a host shell implements the contract, but does not redefine it locally;
- adding a new host port is a change to the versioned contract surface, not a local consumer detail or a property of one install lane.

Consequences:
- the VS Code host may omit a full `RouteAdapter` if route semantics are absent there;
- the Copilot host will almost certainly implement all three host ports;
- browser `acp-chat` may have transport + persistence and a more limited routing layer.

Host conformance profiles:
- VS Code ACP Plugin:
  - required: `TransportAdapter`, `HostPersistenceAdapter`
  - absent by design: `RouteAdapter`
- `acp-chat`:
  - required: `TransportAdapter`, `HostPersistenceAdapter`
  - optional/limited: `RouteAdapter`
- `copilot /agents`:
  - required: `TransportAdapter`, `HostPersistenceAdapter`, `RouteAdapter`

An unsupported host port must be **absent**, not replaced with a noop implementation just to satisfy nominal typing. In this execution wave, `absent` means the host port is omitted at the type level as an omitted property / explicit profile shape, not passed as a noop object and not enabled through a runtime feature flag without type-level distinction.

### 5.3 Copilot Host Contract

`copilot` must use the shared ACP UI package on the routes:
- `/agents`
- `/agents/session/:id`

The `copilot` host must:
- use a dedicated ACP transport surface isolated from the MCP runtime path;
- synchronize the active session with the URL;
- inject theme tokens;
- maintain responsive behavior without horizontal overflow on narrow viewports;
- keep endpoint discovery, runtime address resolution, and network policy in the host layer rather than in `@strato-space/acp-ui`.

For this wave, the canonical transport shape for `copilot /agents` is:
- browser ACP host
- dedicated ACP backend/socket namespace or equivalent ACP-only runtime boundary
- backend ACP client/runtime orchestration
- a separate Python agents service/runtime outside the Copilot frontend/backend build artifact boundary

Current repo guardrails from `copilot/AGENTS.md` that this host contract must preserve:
- `VITE_AGENTS_API_URL` must use plain HTTP for `:8722`; `https://` is a known broken configuration for the Fast-Agent runtime on this port;
- the agents runtime remains a separate Python service, operationally managed outside the UI package and outside the frontend bundle;
- long-running host/runtime services are PM2-managed operational concerns, not responsibilities of `@strato-space/acp-ui`.

The shared ACP UI package must not depend on the MCP proxy, `mcp_call`, Fast-Agent MCP endpoint routing, or voice-runtime concerns.
Endpoint discovery, runtime address resolution, network policy, and PM2/runtime topology are host concerns and are outside the authority of `@strato-space/acp-ui`.

Ontology alignment:
- `/agents` in this wave is treated as a runtime interaction surface for `coding_agent` / ACP-compatible agent runtime;
- `/agents` is not a UI for editing `executor_routing`, `task_execution_run`, `artifact_record`, or `acceptance_evaluation`;
- execution-layer ontology remains kernel vocabulary of `copilot`, but it does not become the semantic owner of ACP chat UI.

### 5.4 Non-goals

This wave does not attempt to:
- turn `acp-ui` into a protocol SDK;
- replace the ACP backend;
- redesign the ACP message schema;
- build a unified invocation layer for ACP and MCP;
- introduce arbitrary dark-mode behavior outside the shared host contract.

## 6. Dependency Graph

```text
T1 ──┬── T3 ──┬── T5 ───────┬── T8 ──┬── T10 ── T11 ── T12
T2 ──┘        │             │        └── T9 ───┘
T4 ───────────┴─────────────┘
              ├── T6 ── T7
              └── T7a
```

Interpretation note:
- `T4` starts in parallel, but in this wave it is not merely advisory: the extracted eval baseline becomes a hard gating surface for introducing `copilot /agents` as a third ACP consumer;
- a red `T4` must block progression into `T8` / `T9`, because a fully automatic execution cycle without canonical guarantees is out of contract.

## 7. Work Plan

### T1: Package Skeleton for `@strato-space/acp-ui`
- **issue_id**: `copilot-ooc6`
- **depends_on**: []
- **location**: `tools/acp/strato-space/acp-plugin/packages/acp-ui`
- **description**: formalize the existing `packages/acp-ui` source tree as a standalone npm package with metadata, exports, entrypoints, CSS export, build scripts, and typings generation.
- **validation**: `npm run build` in the package context produces correct artifacts and `exports`.
- **status**: Completed
- **log**: package artifact formalized; standalone package build passes; exports and typed CSS subpath verified.
- **files edited/created**: `packages/acp-ui/package.json`, `packages/acp-ui/tsconfig.build.json`, `packages/acp-ui/vite.config.ts`, `packages/acp-ui/postcss.config.js`, `packages/acp-ui/tailwind.config.ts`, `packages/acp-ui/src/index.ts`

### T2: Stable Bridge Contract (Host Adapter API)
- **issue_id**: `copilot-9zab`
- **depends_on**: []
- **location**: `tools/acp/strato-space/acp-plugin/packages/acp-ui/src`
- **description**: introduce the public aggregate bridge contract as a composition of host ports (`TransportAdapter`, `HostPersistenceAdapter`, `RouteAdapter`) so the UI no longer depends on global `acquireVsCodeApi` as the only runtime and does not drift back into a monolithic god-adapter.
- **validation**: the UI works correctly with an injected bridge; the VS Code fallback remains a compatibility mode rather than the only runtime; unsupported host ports are absent rather than replaced with noop implementations.
- **status**: Completed
- **log**: aggregate host-port bridge introduced; legacy VS Code bridge normalized; contract tests added for absent-route semantics and compatibility wiring.
- **files edited/created**: `packages/acp-ui/src/hostBridge.ts`, `packages/acp-ui/src/hooks/useVsCodeApi.ts`, `packages/acp-ui/src/hostBridge.test.ts`, `packages/acp-ui/src/index.ts`

### T3: Library Build + Peer Dependency Hygiene
- **issue_id**: `copilot-412g`
- **depends_on**: [T1, T2]
- **location**: `tools/acp/strato-space/acp-plugin/packages/acp-ui`
- **description**: harden the library build, eliminate duplicate React copies, keep `react` and `react-dom` in `peerDependencies`, and guarantee consumer-safe bundling.
- **validation**: the bundle does not pull its own React copy; a React 19 consumer connects without hook/runtime conflicts.
- **status**: Completed
- **log**: peer-dependency boundary enforced; React stays externalized; shared package builds and consumer app build succeed without duplicate-react failures.
- **files edited/created**: `packages/acp-ui/package.json`, `packages/acp-ui/vite.config.ts`, `app/package.json`, `app/package-lock.json`

### T4: ACP UI Canonical Eval Baseline
- **issue_id**: `copilot-ikuc`
- **depends_on**: []
- **location**: `tools/acp/strato-space/acp-plugin/src/test`, `tools/acp/strato-space/acp-plugin/packages/acp-ui/src`, `tools/acp/strato-space/acp-plugin/packages/acp-runtime-shared`, `tools/acp/strato-space/acp-plugin/e2e`
- **description**: extract a canonical eval baseline from existing `acp-plugin` tests/e2e and shape it into a tri-host guarantee surface. The raw material comes from extension-host tests (`npm test`), shared UI unit tests (`npm run test:webview:unit`), runtime-shared unit tests (`npm run test:runtime:unit`), and Playwright smoke/E2E (`npm run test:e2e`). This baseline must be reclassified into:
  - shared kernel guarantees,
  - host-specific guarantees,
  - cross-host conformance guarantees.
- **validation**: the canonical eval baseline is explicitly documented and can validate guarantees equally for:
  - VS Code extension,
  - browser `acp-chat`,
  - `copilot /agents`.
- **status**: Completed
- **log**: canonical eval baseline extracted and documented; tri-host guarantee matrix anchored to existing tests and build gates.
- **files edited/created**: `docs/ACP_UI_EVAL_BASELINE.md`, `packages/acp-ui/src/hostBridge.test.ts`, `app/__tests__/agents/acpHostBridge.test.ts`, `app/__tests__/agents/agentsAcpSurfaceContract.test.ts`, `backend/__tests__/services/acpSocketIsolationContract.test.ts`

### T5: Migrate ACP Plugin Webview to Package Consumption
- **issue_id**: `copilot-xklc`
- **depends_on**: [T3]
- **location**: `tools/acp/strato-space/acp-plugin/src/views/webview`
- **description**: keep the ACP Plugin webview on package imports rather than direct source-level coupling.
- **validation**: ACP Plugin webview preserves behavior parity without regressions.
- **status**: Completed
- **log**: ACP Plugin webview consumes package exports and still builds/tests green.
- **files edited/created**: `src/views/webview/src/main.tsx`, `src/views/webview/tsconfig.json`, `src/views/webview/vite.config.ts`

### T6: Migrate `acp-chat` Web to Package Consumption
- **issue_id**: `copilot-y177`
- **depends_on**: [T3]
- **location**: `tools/acp/strato-space/acp-plugin/acp-chat/web`
- **description**: keep browser `acp-chat` on consumption of the shared package and a websocket bridge host adapter.
- **validation**: `acp-chat` works without regressions across connect/send/receive/render flows.
- **status**: Completed
- **log**: browser host wired to shared package with browser-local websocket bridge; host build green.
- **files edited/created**: `acp-chat/web/src/main.tsx`, `acp-chat/web/package.json`, `acp-chat/web/tsconfig.json`, `acp-chat/web/vite.config.ts`, `acp-chat/package.json`

### T7: Publishing Pipeline to GitHub Packages
- **issue_id**: `copilot-qpeq`
- **depends_on**: [T6]
- **location**: `tools/acp/strato-space/acp-plugin`
- **description**: add the workflow and operational docs to publish `@strato-space/acp-ui` through GitHub Packages, including auth, `.npmrc`, semver, and a clean consumer install path.
- **validation**: test publish/install succeeds in a clean consumer environment.
- **status**: Completed
- **log**: GitHub Packages workflow, package publish metadata, local auth example, deterministic `prepack`, dry-run packaging scripts, and checked-in clean-consumer tarball smoke are in place. External registry publication remains an operator action, but package-installability is now proven automatically.
- **files edited/created**: `packages/acp-ui/package.json`, `.github/workflows/publish-acp-ui-package.yml`, `packages/acp-ui/.npmrc.github-packages.example`, `package.json`, `packages/acp-ui/README.md`, `README.md`, `AGENTS.md`, `scripts/smoke-acp-ui-consumer.sh`, `docs/ACP_UI_EVAL_BASELINE.md`

### T7a: Internal Prerelease Consumption Boundary
- **issue_id**: `copilot-2u41`
- **depends_on**: [T3]
- **location**: `strato-space/copilot/app/package.json`, `strato-space/copilot/app/package-lock.json`, and equivalent consumer install metadata
- **description**: formalize the internal prerelease install path for cross-repo integration before external publish: explicit `file:` dependency, workspace link, or another reproducible non-registry channel between `copilot` and `acp-plugin`.
- **validation**: `copilot` builds and tests against the shared package in a clean internal workspace without source aliasing into `acp-ui` internals; the install mode is documented as a prerelease lane distinct from GitHub Packages publish.
- **status**: Completed
- **log**: copilot consumes `@strato-space/acp-ui` via explicit local prerelease lane and builds cleanly without source aliasing into acp-ui internals.
- **files edited/created**: `app/package.json`, `app/package-lock.json`, `packages/acp-ui/README.md`, `README.md`

### T8: Copilot ACP Transport Adapter
- **issue_id**: `copilot-mhcy`
- **depends_on**: [T4, T5, T7a]
- **location**: `strato-space/copilot/app/src/pages/AgentsOpsPage.tsx` and the host adapter module
- **description**: implement the Copilot host bridge over a dedicated ACP-only transport surface and connect the shared `AcpUiApp`, without mixing ACP runtime with the MCP proxy path and without moving endpoint discovery into the shared package.
- **validation**: `/agents` works through an ACP-only transport boundary, correctly handles send/receive/state-restore flows, and contains no MCP invocation path as a runtime dependency.
- **status**: Completed
- **log**: `/agents` is ACP-only; shared `AcpUiApp` wired through dedicated ACP host bridge/socket path; MCP runtime coupling excluded by test.
- **files edited/created**: `app/src/pages/AgentsOpsPage.tsx`, `app/src/services/acpHostBridge.ts`, `app/src/services/acpSocket.ts`, `backend/src/api/socket/acp.ts`, `backend/src/services/acp/*`, `backend/__tests__/services/acpSocketIsolationContract.test.ts`

### T9: Route Contract `/agents/session/:id`
- **issue_id**: `copilot-8cuf`
- **depends_on**: [T4, T5, T7a]
- **location**: `strato-space/copilot/app/src/App.tsx` and the agents page store wiring
- **description**: add the route contract `/agents/session/:id` and URL/session synchronization.
- **validation**: a deep link opens the correct ACP session; navigation between `/agents` and `/agents/session/:id` is consistent.
- **status**: Completed
- **log**: route contract implemented with URL/session synchronization and direct test coverage.
- **files edited/created**: `app/src/App.tsx`, `app/src/pages/AgentsOpsPage.tsx`, `app/src/services/acpHostBridge.ts`, `app/__tests__/agents/agentsAcpSurfaceContract.test.ts`

### T10: Theme + Responsive Host Integration
- **issue_id**: `copilot-72r5`
- **depends_on**: [T8, T9]
- **location**: `strato-space/copilot/app/src/index.css` and agents host styles
- **description**: provide theme-token mapping and a mobile-first layout without horizontal overflow, including iPhone XR and narrower Android widths.
- **validation**: desktop/mobile visual verification passes; ACP UI retains a usable layout inside the host shell.
- **status**: Completed
- **log**: host-shell flex and narrow-width protections added; deterministic ACP harness route introduced; checked-in browser acceptance proves no horizontal overflow at iPhone XR width.
- **files edited/created**: `app/src/index.css`, `app/src/pages/AgentsHarnessPage.tsx`, `app/src/App.tsx`, `app/src/hooks/useAppInit.ts`, `app/e2e/agents-harness.spec.ts`

### T11: Cross-Repo Verification Matrix
- **issue_id**: `copilot-bshq`
- **depends_on**: [T10]
- **location**: `acp-plugin` + `copilot` verification scripts
- **description**: run the build/type/test matrix for the three consumer environments — ACP Plugin webview, `acp-chat`, Copilot `/agents` — and require that the verification surface rely on the `T4`-extracted canonical guarantees rather than on three disconnected local smoke sets. For `copilot`, verification must use repo-authoritative test/build gates from `copilot/AGENTS.md`, including `platforms.json`, `docs/TESTING_PROCEDURE.md`, repo-level runner compatibility, module-local build gates, and browser-based acceptance discipline.
- **validation**: all required type/build/test gates are green in both repositories, browser-based acceptance has fresh CDP state plus screenshot-level overlap verification for UI/layout changes, and the tri-host conformance matrix confirms equal base guarantees for:
  - VS Code extension
  - browser `acp-chat`
  - `copilot /agents`
- **status**: Completed
- **log**: package build, VS Code/`acp-chat` host builds, ACP-specific frontend/backend tests, runtime baseline, and browser harness e2e are green. The checked-in matrix now includes deterministic browser acceptance for `copilot /agents` through `/__harness/agents`.
- **files edited/created**: `docs/ACP_UI_EVAL_BASELINE.md`, `package.json`, `AGENTS.md`, `app/__tests__/agents/*`, `backend/__tests__/services/acpSocketIsolationContract.test.ts`, `app/e2e/agents-harness.spec.ts`, `packages/acp-ui/src/harness.ts`, `packages/acp-ui/README.md`

### T12: Docs + Changelog + Rollout Notes
- **issue_id**: `copilot-m39w`
- **depends_on**: [T11]
- **location**: README/AGENTS/CHANGELOG across both repositories + `copilot/plan`
- **description**: record the canonical shared ACP UI package contract, install/publish/upgrade path, host responsibilities, and rollout caveats.
- **validation**: the documentation is consistent and covers operational handoff.
- **status**: Completed
- **log**: README/AGENTS/spec docs updated across both repos; ACP UI eval baseline documents deterministic harness verification for both browser hosts and `copilot /agents`; changelog records the package extraction, consumer-smoke, and publish-lane hardening. Remaining external registry publish is explicitly documented as a release/operator action, not unresolved implementation work.
- **files edited/created**: `README.md`, `AGENTS.md`, `CHANGELOG.md`, `packages/acp-ui/README.md`, `docs/ACP_UI_EVAL_BASELINE.md`, `plan/acp-ui-component-base-spec.md`

## 8. Parallel Execution Groups

| Wave | Tasks | Can Start When |
|---|---|---|
| 1 | T1, T2, T4 | Immediately |
| 2 | T3 | T1 + T2 |
| 3 | T5, T6 | T3 |
| 4 | T7a | T3 |
| 5 | T8, T9 | T4 + T5 + T7a |
| 6 | T7 | T6 |
| 7 | T10 | T8 + T9 |
| 8 | T11 | T10 |
| 9 | T12 | T11 |

Wave interpretation note:
- `T7a` is required for internal prerelease cross-repo consumption and unblocks runtime integration before public publish;
- `T7` is required for package publication readiness and external distribution, but not for internal workspace validation once `T7a` is satisfied;
- `T11` verifies cross-repo build/type/test integrity of consumers and therefore follows the critical runtime path, not the publication path;
- the fully automatic implementation cycle assumes `T4`-extracted guarantees become the canonical evaluation substrate for later waves.

## 9. Acceptance Criteria

### 9.1 ACP Plugin
- the webview no longer depends directly on the source-internal `acp-ui` tree as a private implementation detail;
- ACP Plugin continues to work as before, but now consumes the package contract.

### 9.2 `acp-chat`
- the browser shell uses the same shared UI package;
- there is no UI drift between `acp-chat` and ACP Plugin across the main ACP surfaces.

### 9.3 Copilot `/agents`
- the placeholder on `/agents` is replaced with a shared ACP UI host;
- the route `/agents/session/:id` works;
- state is synchronized with URL and ACP runtime transport;
- the layout remains usable on narrow/mobile widths;
- `/agents` does not depend on the MCP proxy path as its runtime transport;
- the surface does not claim to author execution-layer ontology objects and remains a runtime UI for agent interaction.

### 9.4 Shared Package
- `@strato-space/acp-ui` publish/install is reproducible across both the internal prerelease lane and the external registry lane;
- React duplication does not occur;
- the bridge contract is stable and not host-specific in meaning;
- transport, persistence, and routing are not collapsed into an indistinguishable runtime adapter;
- at least one consumer outside ACP Plugin is connected without source aliasing into `acp-ui` internals;
- the canonical eval baseline extracted from `acp-plugin` verifies shared guarantees equally across all three ACP surfaces.

## 10. Testing Strategy

- `acp-plugin`: package build + extension webview build + `acp-chat` build + unit tests.
- `copilot`: type/build + route/navigation checks for `/agents` and `/agents/session/:id` in internal prerelease install mode; external registry mode is validated separately in the publish lane.
- `copilot` verification must align with repo-level test policy from `copilot/AGENTS.md`:
  - treat `platforms.json` and `docs/TESTING_PROCEDURE.md` as the authoritative repo-level test catalog/procedure;
  - prefer the repo-level runner where applicable: `./scripts/run-test-suite.sh baseline|voice|full`;
  - for module-local checks, use canonical module commands (`cd app && npm run test`, `npm run test:e2e`, `npm run build` or env-scoped `npm run build-dev` / `npm run build-local` when the task is explicitly env-scoped);
  - if frontend and backend are both touched, both required build/type gates are mandatory.
- Baseline eval extraction from `acp-plugin` is mandatory before automatic execution:
  - extension-host tests: `npm test`
  - shared UI unit tests: `npm run test:webview:unit`
  - shared runtime tests: `npm run test:runtime:unit`
  - Playwright/E2E smoke: `npm run test:e2e`
- After extraction, these guarantees must be normalized into a tri-host conformance matrix:
  - VS Code extension
  - browser `acp-chat`
  - `copilot /agents`
- Smoke matrix:
  - VS Code ACP panel
  - browser `acp-chat`
  - `copilot /agents`
- Browser-based acceptance requirements for UI work:
  - restart `mcp@chrome-devtools.service` before each live browser test cycle so MCP/CDP state is fresh;
  - include screenshot-level overlap/layout checks for responsive and shell-embedding work.
- Isolation checks:
  - `copilot /agents` does not use `mcp_call`, an MCP proxy client, or a legacy MCP transport path;
  - ACP-specific host surfaces do not pull voice-runtime concerns.
- Responsive checks:
  - desktop
  - iPhone XR width
  - narrower Android-class widths

## 11. Risks and Controls

### 11.1 Category Risk: package vs app
- **Risk**: `acp-ui` is re-designed as a standalone app rather than a reusable library.
- **Control**: exports/bridge/theme contract are fixed as library-first; host-specific concerns stay outside the package core.

### 11.2 React Duplication Risk
- **Risk**: the package pulls its own React and breaks consumer runtime.
- **Control**: `peerDependencies` + library bundling discipline + explicit verification.

### 11.3 Bridge Drift Risk
- **Risk**: VS Code, websocket, and Copilot host adapters drift semantically.
- **Control**: one aggregate bridge contract decomposed into host ports + adapter tests + no host-specific logic inside the package core; bridge evolution flows through versioned contract governance rather than local consumer overrides or a specific install channel.

### 11.3a Install-Lane Ambiguity Risk
- **Risk**: cross-repo integration works locally but fails in CI / clean consumer environments because the prerelease install boundary is not defined separately from the public publish lane.
- **Control**: isolate `T7a` as the internal prerelease consumption boundary; explicitly document the `file:` / workspace / equivalent install mode and validate it before GitHub Packages publication.

### 11.4 ACP/MCP Boundary Drift Risk
- **Risk**: `copilot /agents` starts using the MCP runtime path again as the transport substrate for an ACP surface.
- **Control**: the ACP-only transport contract is fixed in the spec, acceptance criteria, and isolation checks.

### 11.5 Eval-Baseline Drift Risk
- **Risk**: guarantees remain tied to only one host surface and never become a shared tri-host eval substrate, causing the automatic execution cycle to treat local successes as cross-host correctness.
- **Control**: `T4` must extract canonical guarantees from existing `acp-plugin` tests/e2e and reclassify them into shared-kernel, host-specific, and cross-host conformance checks.

### 11.6 Theme Drift Risk
- **Risk**: shared ACP UI visually conflicts with the Copilot shell.
- **Control**: host-level CSS variable mapping and an explicit theme contract.

### 11.7 Tooling Distraction Risk
- **Risk**: the execution wave expands into unrelated toolchain upgrades.
- **Control**: pinned `bd 0.49.6` and other deliberate constraints remain in force for this wave unless a separate approved spec replaces them.

### 11.8 Deduplication Failure Risk
- **Risk**: `acp-plugin` retains legacy duplicate surfaces and never truly reaches a thin-host boundary despite package extraction.
- **Control**: the separate deduplication phases D1/D2/D3 are mandatory parts of execution; legacy `acp-chat/web/main.ts` and other non-canonical duplicate paths must either be eliminated or explicitly removed from the canonical runtime.

### 11.9 Ontology Drift Risk
- **Risk**: the `/agents` UI silently starts pretending to be the surface for `executor_routing` / `task_execution_run`, even though the ontology separates the runtime agent surface from execution-layer decision objects.
- **Control**: in this wave, `/agents` is fixed as the runtime interaction surface over `coding_agent`; execution-layer ontology remains a separate contract family and is not reduced to ACP chat UI.
