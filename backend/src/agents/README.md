# VoiceBot Agents

This directory contains agent configurations for the voicebot.

## Overview

VoiceBot uses fast-agent for AI agent orchestration. Agents are defined as "AgentCards" in Markdown format with YAML frontmatter.

## Current Status

**Agents run as a separate Python service.**

The copilot backend does NOT run agents directly. Instead:

1. The MCP proxy in `src/services/mcp/` provides a bridge
2. Agents are served via fast-agent's MCP server
3. The backend communicates with agents via HTTP transport

## Agent Cards

Located in `agent-cards/`:

- **create_tasks.md** - Creates tasks from voicebot session analysis
- **generate_session_title.md** - Generates titles for sessions

## Starting Agents

On the voicebot server:

\`\`\`bash
cd /srv/voicebot/agents
./pm2-agents.sh start
\`\`\`

Or with Docker:

\`\`\`bash
docker-compose up -d
\`\`\`

## Configuration

See the voicebot repository for full agent setup:
- `fastagent.config.yaml` - Agent endpoints and MCP server config
- `fastagent.secrets.yaml` - API keys (not committed)
- `ecosystem.config.cjs` - PM2 configuration

## Integration with Copilot Backend

The copilot backend connects to agents via:

1. **Environment Variables**:
   - `MCP_SERVER_URL` - URL of the fast-agent MCP server
   - `MCP_SESSION_TIMEOUT` - Session timeout in ms

2. **MCP Proxy Service**:
   - `src/services/mcp/proxyClient.ts` - HTTP client
   - `src/services/mcp/sessionManager.ts` - Session management
   - `src/services/mcp/index.ts` - Setup and initialization

3. **Socket.IO Integration**:
   - Agents can be invoked via Socket.IO from the frontend
   - Results are broadcast to subscribed clients

## Developing Agents

For local development, copy agent cards to this directory and update the MCP config.

See voicebot AGENTS.md for detailed agent development guidelines.
