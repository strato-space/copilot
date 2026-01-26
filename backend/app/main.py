from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routes.auth import router as auth_router
from app.routes.items import router as items_router
from app.routes.ops import router as ops_router
from app.routes.uploads import router as uploads_router
from app.config import DATA_DIR

APP_VERSION = "0.1.1"

app = FastAPI(title="Copilot API", version=APP_VERSION)
app.include_router(auth_router)
app.include_router(items_router)
app.include_router(ops_router)
app.include_router(uploads_router)

uploads_dir = DATA_DIR / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/hello")
async def hello():
    return {"message": "Hello from FastAPI"}
