# Desloppify Agent Guide

This file is the repo-local overlay for Desloppify usage. The installed Desloppify skill/manual remains the authoritative workflow source; this guide exists so root `AGENTS.md` does not have to inline a tool manual.

## Core Loop

- Run `desloppify next`.
- Fix the issue it points to.
- Resolve it using the exact command/attestation shown by Desloppify.
- Rescan periodically with `desloppify scan --path .` and inspect score movement with `desloppify status`.

## Queue Shaping

Useful queue controls:

```bash
desloppify plan
desloppify plan move <pat> top
desloppify plan cluster create <name>
desloppify plan focus <cluster>
desloppify plan defer <pat>
desloppify plan skip <pat>
desloppify plan done <pat>
desloppify plan reopen <pat>
```

Useful inspection commands:

```bash
desloppify next --count 5
desloppify next --cluster <name>
desloppify show <pattern>
desloppify show --status open
desloppify scan --path . --reset-subjective
```

## Reviews

Preferred subjective-review path:

```bash
desloppify review --run-batches --runner codex --parallel --scan-after-import
```

Guidelines:

- Import first, then fix.
- Review from evidence only; do not use prior chat context or target-score anchoring.
- Keep reviewer input scoped to the immutable packet/query and the named source files.

## Codex Overlay

For Codex batch review/import flows:

1. Prefer `desloppify review --run-batches --runner codex --parallel --scan-after-import`.
2. Packet snapshots are written under `.desloppify/review_packets/holistic_packet_*.json`; use them for reproducible retries.
3. Return machine-readable JSON only for review imports.
4. `findings` must match the query/system prompt exactly; use `"findings": []` when no defects are found.
5. Retry failed batches narrowly with `desloppify review --run-batches --packet <packet.json> --only-batches <idxs>`.

## Escalation

If Desloppify itself appears wrong or inconsistent:

1. Capture a minimal repro with command, path, expected result, and actual result.
2. Open a GitHub issue in `peteromallet/desloppify`.
3. If safe, open a linked PR.

## Prerequisite

```bash
command -v desloppify >/dev/null 2>&1 && echo "desloppify: installed" || echo "NOT INSTALLED — run: pip install --upgrade git+https://github.com/peteromallet/desloppify.git"
```
