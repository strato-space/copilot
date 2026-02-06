# Copilot Agents

Fast-Agent based AI agents for intelligent dialogue processing.

## Overview

This directory contains the Fast-Agent configuration and AgentCards for Copilot's AI-powered features:
- **create_tasks** - Extract actionable tasks from transcripts
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
uv pip install -e .

# Copy and configure secrets
cp fastagent.secrets.yaml.example fastagent.secrets.yaml
# Edit fastagent.secrets.yaml with your API keys
```

### Running Locally

```bash
# Activate virtual environment
source .venv/bin/activate

# Run with fast-agent CLI
fast-agent serve \
  --config-path fastagent.config.yaml \
  --agent-cards agent-cards \
  --name copilot-agent-services \
  --transport http \
  --host 0.0.0.0 \
  --port 8722
```

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
- **Model:** gpt-4.1
- **Purpose:** Extract actionable tasks from full transcripts
- **Output:** JSON array of tasks with priority, assignee, deadline, etc.

### generate_session_title.md
- **Model:** gpt-4.1-mini
- **Purpose:** Generate concise session titles (3-8 words)
- **Output:** Single string with the title

## MCP Servers

The agents connect to StratoSpace MCP servers:
- `images-mcp.stratospace.fun` - Image processing
- `fs-mcp.stratospace.fun` - File system
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
uv venv && uv pip install -e .
```

### Permission denied on pm2-agents.sh
```bash
chmod +x pm2-agents.sh
```

### MCP server connection issues
Check that MCP servers are accessible and `fastagent.config.yaml` has correct URLs.
