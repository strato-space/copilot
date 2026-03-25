# Copilot OPENAI_API_KEY Runtime State

Date: 2026-03-17  
Scope: current effective key routing for OpenAI-backed Copilot services and agent runtime.

## Summary

- Copilot production runtime is currently split across two credential mechanisms:
  - OpenAI API key for backend/workers/tgbot/miniapp.
  - Codex OAuth for `agents/` Fast-Agent runtime.
- The effective runtime OpenAI API key now matches the key stored in `backend/.env.production`.
- Registry source for OpenAI API key aliases is `/home/tools/server/.production/production.md`.

## Effective Runtime State

### OpenAI API key-backed services

The following PM2 services currently use the same runtime `OPENAI_API_KEY`:

- `copilot-backend-prod`
- `copilot-voicebot-workers-prod`
- `copilot-voicebot-tgbot-prod`
- `copilot-miniapp-backend-prod`

Masked runtime key:

- `sk-proj-eNsO...9b4A`

Registry alias match:

- `tony`
- registry mask: `sk-...9b4A`

Operational consequence:

- Whisper/transcription runs on alias `tony`.
- Backend summarize/categorize/questions/custom-prompt paths also inherit the same `OPENAI_API_KEY` runtime.

### File-configured key in `backend/.env.production`

Current file value (masked):

- `sk-proj-eNsO...9b4A`

Registry alias match:

- `tony`
- registry mask: `sk-...9b4A`

Operational consequence:

- `backend/.env.production` matches the live PM2 runtime for OpenAI API key-backed services.

### Agents / Fast-Agent runtime

Agents do not currently use the OpenAI API key above for task/title card execution.  
They run through Codex OAuth state:

- auth copy: `agents/.codex/auth.json`
- default model: `codexplan`

Current runtime account id:

- `3e532a79-4ab1-4dd7-95a7-6598855dc395`

Source auth file currently differs from the agents runtime copy:

- source: `/root/.codex/auth.json`
- runtime copy: `agents/.codex/auth.json`

Operational consequence:

- `AI title` and other agent-card flows are governed by Codex OAuth state and `agents/fastagent.config.yaml`, not by the backend `OPENAI_API_KEY`.

## Code References

- Whisper key source:
  - `backend/src/workers/voicebot/handlers/transcribeHandler.ts`
  - environment source list is restricted to `OPENAI_API_KEY`
  - transcription model is `whisper-1`
- Shared worker OpenAI client:
  - `backend/src/workers/voicebot/handlers/shared/sharedRuntime.ts`
- Backend summarize handler:
  - `backend/src/workers/voicebot/handlers/summarizeHandler.ts`
- Agents runtime recovery/model sync:
  - `backend/src/services/voicebot/agentsRuntimeRecovery.ts`

## Verification Commands

Use these read-only commands to re-check the state:

```bash
pm2 env 0 | rg '^OPENAI_API_KEY:'
pm2 env 1 | rg '^OPENAI_API_KEY:'
pm2 env 2 | rg '^OPENAI_API_KEY:'
pm2 env 3 | rg '^OPENAI_API_KEY:'
rg '^OPENAI_API_KEY=' /home/strato-space/copilot/backend/.env.production
python3 - <<'PY'
import json
for path in ['/root/.codex/auth.json', '/home/strato-space/copilot/agents/.codex/auth.json']:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    account = (data.get('tokens') or {}).get('account_id') or data.get('account_id')
    print(path, account)
PY
rg '^default_model:' /home/strato-space/copilot/agents/fastagent.config.yaml
```

## Current Answer in One Line

- Backend/workers/tgbot/miniapp: alias `tony`
- `backend/.env.production`: alias `tony`
- `agents/`: Codex OAuth + `codexplan`
