from __future__ import annotations

import hashlib
import json
from typing import Any

VOLATILE_FIELDS = {"context_id", "created_at", "updated_at", "ready_at"}

def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)

def business_content(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: business_content(item) for key, item in value.items() if key not in VOLATILE_FIELDS}
    if isinstance(value, list):
        return [business_content(item) for item in value]
    return value

def content_hash(value: Any) -> str:
    return hashlib.sha256(stable_json(business_content(value)).encode("utf-8")).hexdigest()
