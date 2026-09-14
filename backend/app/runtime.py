"""Per-process cache of loaded model adapters, shared by inference, preview and suggestions."""
import threading
from collections import OrderedDict
from .adapters import ADAPTERS

LIMIT = 4
_cache = OrderedDict()
_lock = threading.Lock()

def loaded(model):
    with _lock:
        adapter = _cache.get(model['id'])
        if adapter is None:
            adapter = ADAPTERS[model['adapter']]().load(model['path'])
            _cache[model['id']] = adapter
            while len(_cache) > LIMIT: _cache.popitem(last=False)
        else:
            _cache.move_to_end(model['id'])
        return adapter

def predict(model, raw):
    adapter = loaded(model)
    # torch/ultralytics modules are not guaranteed thread-safe for concurrent forward passes.
    with _lock: return adapter.predict(raw)

def cached(model_id): return model_id in _cache
