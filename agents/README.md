# Copilot Agents

Fast-Agent based AI agents for intelligent dialogue processing.

## Overview

This directory contains the Fast-Agent configuration and AgentCards for Copilot's AI-powered features:
- **create_tasks** - Extract actionable tasks from compact session envelopes
- **generate_session_title** - Generate concise session titles from transcript segments

## Quick Start

### Prerequisites
- Python 3.13+
- [uv](https://github.com/astral-sh/uv) package manager
- PM2 (for production deployment)

### Setup

```bash
cd agents

# Create virtual environment and install dependencies
uv venv
uv sync

# Copy and configure secrets
cp fastagent.secrets.yaml.example fastagent.secrets.yaml
# Edit fastagent.secrets.yaml with your API keys
```

### Running Locally

```bash
# Run with fast-agent CLI via uv
uv run --directory "$(pwd)" fast-agent serve \
  --config-path fastagent.config.yaml \
  --agent-cards agent-cards \
  --name copilot-agent-services \
  --transport http \
  --host 127.0.0.1 \
  --port 8722
```

Repo-local bootstrap variant:

```bash
uv run --directory "$(pwd)" python run_fast_agent.py serve \
  --config-path fastagent.config.yaml \
  --agent-cards agent-cards \
  --name copilot-agent-services \
  --transport http \
  --host 127.0.0.1 \
  --port 8722
```

Security note: keep the agent service bound to loopback (`127.0.0.1`) and access it through backend proxy/SSH tunnel when needed.

## Runtime Notes

- `create_tasks` inherits the runtime model from `fastagent.config.yaml` unless you override it explicitly via `--model`. Current config default is `codexspark`.
- `run_fast_agent.py` is the repo-local bootstrap entrypoint for runtime model registrations. It currently registers `gpt-5.4` as a large-window Codex model (`context_window=950000`) without patching site-packages directly.
- Preferred `create_tasks` input is a compact structured envelope with modes `raw_text`, `session_id`, or `session_url`.
- A plain string is still treated as legacy `raw_text` input for backward compatibility.
- Session-backed task extraction enriches context directly through MCP `voice`.
- Session-backed `create_tasks` requests do not ship full transcript/categorization/material blocks over Socket.IO anymore; the prompt rehydrates context from MCP `voice` by `session_id/session_url`.
- `create_tasks` must not route through StratoProject execution; enrichment is direct MCP `voice`.
- `create_tasks` treats current-session draft possible tasks as the editable baseline: same-scope rows should be returned with the same `row_id/id` and improved wording instead of being suppressed as duplicates.
- `voice.fetch(..., mode="transcript")` is the canonical metadata source for session-backed task extraction and now carries a frontmatter block with `session-id`, `session-name`, `session-url`, `project-id`, `project-name`, and `routing-topic`.
- If transcript metadata includes `project-id`, `create_tasks` must read exactly one project card through `voice.project(project_id)`; it should not rehydrate project context through `voice.search` or a full project list.
- `create_tasks` still excludes finance noise, but must keep explicit finance-adjacent operational documents (`счёт`, `invoice`, `акт`, `смета`, `КП`, `договор`) when they are directly поручены как рабочий deliverable.

### Production Deployment (PM2)

```bash
# Start services
./pm2-agents.sh start

# Check status
./pm2-agents.sh status

# View logs
./pm2-agents.sh logs

# Stop services
./pm2-agents.sh stop
```

## Configuration Files

| File | Description |
|------|-------------|
| `fastagent.config.yaml` | Main configuration (MCP servers, logging, models) |
| `fastagent.secrets.yaml` | API keys (never commit!) |
| `fastagent.secrets.yaml.example` | Template for secrets |
| `ecosystem.config.cjs` | PM2 configuration |
| `pm2-agents.sh` | PM2 management script |
| `pyproject.toml` | Python project configuration |
| `docker-compose.yaml` | Optional Jaeger tracing |

## Agent Cards

Agent cards are located in `agent-cards/` directory:

### create_tasks.md
- **Model:** inherited from runtime/config default
- **Purpose:** Extract actionable tasks from compact session envelopes
- **Input modes:** `raw_text`, `session_id`, `session_url` (plain string remains a legacy alias for `raw_text`)
- **Enrichment:** direct MCP `voice` reads
- **Session path:** `voice.fetch(..., mode="transcript")` -> `voice.project(project_id)` -> `voice.session_task_counts(...)` -> `voice.session_tasks(..., bucket="Draft")` -> `voice.crm_tickets(session_id)` -> `voice.crm_tickets(project_id)`
- **Output:** canonical JSON array with `id/name/description/priority/performer_id/project_id/task_type_id/dialogue_tag/task_id_from_ai/dependencies_from_ai/dialogue_reference`
- **Guardrails:** executor-ready descriptions, no finance/evaluative noise, no StratoProject execution hop, mutable same-scope draft rewrite in place

### generate_session_title.md
- **Model:** inherited from runtime/config
- **Purpose:** Generate concise session titles (3-8 words)
- **Output:** Single string with the title

## MCP Servers

The agents connect to StratoSpace MCP servers:
- `images-mcp.stratospace.fun` - Image processing
- `fs-mcp.stratospace.fun` - File system
- `gsh-mcp.stratospace.fun` - Google Sheets access
- `seq-mcp.stratospace.fun` - Sequence operations
- `tm-mcp.stratospace.fun` - Task management
- `tg-ro-mcp.stratospace.fun` - Telegram read-only
- `tgbot-mcp.stratospace.fun` - Telegram bot
- `voice-mcp.stratospace.fun` - Voice processing
- `call-mcp.stratospace.fun` - Call processing

## Ports

| Service | Port |
|---------|------|
| Copilot Agents | 8722 |
| Voicebot Agents (legacy) | 8721 |
| Jaeger UI | 16686 |
| OTLP HTTP | 4318 |

## Environment Variables

Set in `fastagent.secrets.yaml` or as environment variables:
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key (optional)

## Logs

Logs are stored in `./logs/`:
- `copilot-agents-services.log` - PM2 service logs
- `fastagent-execution.jsonl` - Detailed execution logs (JSONL format)

## Troubleshooting

### fast-agent not found
```bash
uv sync
```

### Permission denied on pm2-agents.sh
```bash
chmod +x pm2-agents.sh
```

### MCP server connection issues
Check that MCP servers are accessible and `fastagent.config.yaml` has correct URLs.
