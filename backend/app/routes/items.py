from fastapi import APIRouter, HTTPException

from app.schemas import Item, ItemCreate, ItemUpdate
from app.storage import store

router = APIRouter(prefix="/api/items", tags=["items"])


@router.get("/", response_model=list[Item])
async def list_items():
    return store.list()


@router.post("/", response_model=Item)
async def create_item(payload: ItemCreate):
    return store.create(payload.model_dump())


@router.get("/{item_id}", response_model=Item)
async def get_item(item_id: int):
    item = store.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.put("/{item_id}", response_model=Item)
async def update_item(item_id: int, payload: ItemUpdate):
    item = store.update(item_id, payload.model_dump(exclude_unset=True))
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.delete("/{item_id}")
async def delete_item(item_id: int):
    item = store.delete(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"status": "deleted", "id": item_id}
