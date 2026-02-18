# Copilot VoiceBot API Code Examples

Date: 2026-02-18

## Create session

```bash
curl -X POST "https://copilot.stratospace.fun/api/voicebot/create_session" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=<jwt-cookie>" \
  -d '{
    "session_name": "Morning Session",
    "session_type": "multiprompt_voice_session"
  }'
```

## Add text to session

```bash
curl -X POST "https://copilot.stratospace.fun/api/voicebot/add_text" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=<jwt-cookie>" \
  -d '{
    "session_id": "6994ae109d4d36a850c87809",
    "text": "Короткий update по проекту",
    "speaker": "vp"
  }'
```

## Trigger summarize notify event

```bash
curl -X POST "https://copilot.stratospace.fun/api/voicebot/trigger_session_ready_to_summarize" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=<jwt-cookie>" \
  -d '{
    "session_id": "6994ae109d4d36a850c87809"
  }'
```

Expected response:

```json
{
  "success": true,
  "project_id": "6992dcaac6f09f04ec43f6d7",
  "project_assigned": false,
  "event_oid": "evt_...",
  "notify_event": "session_ready_to_summarize"
}
```

## Upload audio chunk

```bash
curl -X POST "https://copilot.stratospace.fun/api/voicebot/upload_audio" \
  -H "Cookie: token=<jwt-cookie>" \
  -F "session_id=6994ae109d4d36a850c87809" \
  -F "audio=@./chunk.webm;type=audio/webm"
```

Expected payload includes probed duration:

```json
{
  "success": true,
  "session_id": "6994ae109d4d36a850c87809",
  "file_info": {
    "duration": 123.456,
    "file_size": 1234567,
    "mime_type": "audio/webm",
    "original_filename": "chunk.webm"
  },
  "processing_status": "queued"
}
```
