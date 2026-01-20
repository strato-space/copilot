from fastapi import FastAPI

from app.routes.items import router as items_router
from app.routes.ops import router as ops_router

app = FastAPI(title="Copilot API", version="0.1.0")
app.include_router(items_router)
app.include_router(ops_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/hello")
async def hello():
    return {"message": "Hello from FastAPI"}
