import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
WORKSPACE_DIR = BACKEND_DIR.parent.parent

DATA_DIR = APP_DIR / "data"
DEFAULT_HOST_CSV_DIR = WORKSPACE_DIR / "voicebot" / "downloads"
CSV_DIR = Path(os.environ.get("COPILOT_CSV_DIR", str(DEFAULT_HOST_CSV_DIR)))
INTAKE_DIR = Path(os.environ.get("COPILOT_INTAKE_DIR", str(CSV_DIR)))

DEFAULT_CRM_SNAPSHOT = os.environ.get("COPILOT_DEFAULT_CRM_SNAPSHOT", "")

CRM_API_BASE_URL = os.environ.get("CRM_API_BASE_URL")
CRM_API_TOKEN = os.environ.get("CRM_API_TOKEN")
