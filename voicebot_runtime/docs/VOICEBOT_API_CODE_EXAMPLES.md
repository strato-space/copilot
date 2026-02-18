# VoiceBot API - Code Examples

All examples below assume:
- Base URL: `https://<your-host>`
- Endpoints prefix: `/voicebot`
- JWT is passed via `Authorization: Bearer <token>` (or `x-authorization`)

## curl

### Create session
```bash
curl -sS -X POST "https://<your-host>/voicebot/create_session" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_name":"Demo session"}'
```

### Add text
```bash
curl -sS -X POST "https://<your-host>/voicebot/add_text" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"507f1f77bcf86cd799439011","text":"Hello","speaker":"Ivan"}'
```

### Add attachment
```bash
curl -sS -X POST "https://<your-host>/voicebot/add_attachment" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id":"507f1f77bcf86cd799439011",
    "kind":"screenshot",
    "text":"Optional caption",
    "attachments":[
      {
        "kind":"screenshot",
        "source":"web",
        "uri":"https://example.com/image.jpg",
        "name":"image.jpg",
        "mimeType":"image/jpeg",
        "caption":"Optional caption"
      }
    ]
  }'
```

### Fetch session attachments + download Telegram screenshot via proxy
```bash
# 1) Fetch session and inspect derived session_attachments[] (Screenshort tab model)
curl -sS -X POST "https://<your-host>/voicebot/session" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"507f1f77bcf86cd799439011"}'

# 2) Download a Telegram attachment via backend proxy
curl -sS -L \
  -H "Authorization: Bearer $TOKEN" \
  -o screenshot.jpg \
  "https://<your-host>/voicebot/message_attachment/507f1f77bcf86cd7994390aa/0"

# 3) Download Telegram attachment via stable public link (no auth, stable URL)
curl -sS -L \
  -o screenshot.jpg \
  "https://<your-host>/voicebot/public_attachment/698c6bc84d8af0e866f832e3/UNIQ_ABC123"
```

### Trigger summarize (session_ready_to_summarize)
```bash
curl -sS -X POST "https://<your-host>/voicebot/trigger_session_ready_to_summarize" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"507f1f77bcf86cd799439011"}'
```

## JavaScript (fetch)

```js
const BASE_URL = 'https://<your-host>';
const TOKEN = '<jwt>';

async function post(endpoint, body) {
  const res = await fetch(`${BASE_URL}/voicebot/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status}: ${data.error || 'Unknown error'}`);
  }
  return data;
}

async function demo() {
  const { session_id } = await post('create_session', { session_name: 'Demo' });
  await post('add_text', { session_id, text: 'Hello', speaker: 'Ivan' });
  await post('add_attachment', {
    session_id,
    kind: 'screenshot',
    text: 'Optional caption',
    attachments: [
      { kind: 'screenshot', source: 'web', uri: 'https://example.com/image.jpg', name: 'image.jpg' },
    ],
  });
  await post('trigger_session_ready_to_summarize', { session_id });
}

demo().catch(console.error);
```

## Python (requests)

```python
import requests

BASE_URL = "https://<your-host>"
TOKEN = "<jwt>"

def post(endpoint: str, payload: dict):
    r = requests.post(
        f"{BASE_URL}/voicebot/{endpoint}",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()

session = post("create_session", {"session_name": "Demo"})
session_id = session["session_id"]

post("add_text", {"session_id": session_id, "text": "Hello", "speaker": "Ivan"})
post("trigger_session_ready_to_summarize", {"session_id": session_id})
```
