from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, UploadFile, File, HTTPException

from app.config import DATA_DIR

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

UPLOAD_DIR = DATA_DIR / "uploads" / "expenses"


def ensure_upload_dir() -> Path:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return UPLOAD_DIR


@router.post("/expense-attachments")
async def upload_expense_attachment(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    upload_dir = ensure_upload_dir()
    safe_name = file.filename.replace("/", "-")
    file_id = uuid4().hex
    stored_name = f"{file_id}-{safe_name}"
    target_path = upload_dir / stored_name

    contents = await file.read()
    if contents is None:
        raise HTTPException(status_code=400, detail="Empty file")

    target_path.write_bytes(contents)

    return {
        "id": file_id,
        "name": safe_name,
        "path": f"/uploads/expenses/{stored_name}",
    }
