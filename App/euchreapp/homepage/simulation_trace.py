import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional


@dataclass
class TraceConfig:
    enabled: bool = False
    path: str = "simulation_trace.jsonl"
    flush_each_hand: bool = False


class JSONLTraceLogger:
    """
    Writes one JSON object per line (JSONL). Easy to grep and post-process.
    """
    def __init__(self, config: TraceConfig):
        self.config = config
        self._fh = None

    def __enter__(self):
        if not self.config.enabled:
            return self
        os.makedirs(os.path.dirname(self.config.path) or ".", exist_ok=True)
        self._fh = open(self.config.path, "a", encoding="utf-8")
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._fh:
            self._fh.close()
            self._fh = None

    def log_hand(self, record: Dict[str, Any]) -> None:
        if not self.config.enabled:
            return
        if not self._fh:
            # Allow use without context manager (fallback)
            os.makedirs(os.path.dirname(self.config.path) or ".", exist_ok=True)
            self._fh = open(self.config.path, "a", encoding="utf-8")

        record = dict(record)
        record.setdefault("ts", datetime.utcnow().isoformat() + "Z")

        self._fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        if self.config.flush_each_hand:
            self._fh.flush()