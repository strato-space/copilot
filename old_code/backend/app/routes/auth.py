import json
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.config import VOICEBOT_API_URL, VOICEBOT_TRY_LOGIN_URL

router = APIRouter(prefix="/api", tags=["auth"])


class LoginPayload(BaseModel):
    login: str
    password: str


def _resolve_voicebot_url() -> str:
    if VOICEBOT_TRY_LOGIN_URL:
        return VOICEBOT_TRY_LOGIN_URL
    if VOICEBOT_API_URL:
        return VOICEBOT_API_URL.rstrip("/") + "/try_login"
    return ""


def _parse_json_body(raw_body: bytes) -> dict:
    if not raw_body:
        return {}
    try:
        return json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError:
        return {"detail": raw_body.decode("utf-8", errors="replace")}


@router.post("/try_login")
async def try_login(payload: LoginPayload):
    endpoint = _resolve_voicebot_url()
    if not endpoint:
        raise HTTPException(
            status_code=500, detail="VOICEBOT_API_URL is not configured"
        )

    request_body = json.dumps(payload.model_dump()).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=request_body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read()
            return JSONResponse(
                status_code=response.getcode(),
                content=_parse_json_body(body),
            )
    except urllib.error.HTTPError as err:
        body = err.read() if err.fp else b""
        return JSONResponse(
            status_code=err.code,
            content=_parse_json_body(body) or {"error": "Login failed"},
        )
    except urllib.error.URLError as err:
        raise HTTPException(
            status_code=502, detail="Voicebot auth unavailable"
        ) from err
