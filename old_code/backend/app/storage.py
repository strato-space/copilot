class ItemStore:
    def __init__(self):
        self._items = {}
        self._next_id = 1

    def list(self):
        return list(self._items.values())

    def create(self, data):
        item_id = self._next_id
        self._next_id += 1
        stored = {"id": item_id, **data}
        self._items[item_id] = stored
        return stored

    def get(self, item_id):
        return self._items.get(item_id)

    def update(self, item_id, data):
        item = self._items.get(item_id)
        if not item:
            return None
        item.update(data)
        return item

    def delete(self, item_id):
        return self._items.pop(item_id, None)


store = ItemStore()
