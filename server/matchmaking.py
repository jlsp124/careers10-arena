from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Set, Tuple


QueueKey = Tuple[str, str]  # (kind, mode)


@dataclass(frozen=True)
class QueueRule:
    players_needed: int


QUEUE_RULES: Dict[QueueKey, QueueRule] = {
    ("arena", "duel"): QueueRule(players_needed=2),
    ("arena", "teams"): QueueRule(players_needed=4),
    ("arena", "ffa"): QueueRule(players_needed=4),
    ("arena", "boss"): QueueRule(players_needed=2),  # optional quick-play mode
    ("typing", "1v1"): QueueRule(players_needed=2),
    ("pong", "1v1"): QueueRule(players_needed=2),
    ("reaction", "1v1"): QueueRule(players_needed=2),
    ("chess", "1v1"): QueueRule(players_needed=2),
}


def normalize_queue(kind: str, mode: str) -> QueueKey:
    k = (kind or "").strip().lower()
    m = (mode or "").strip().lower()
    if k in {"typing", "pong", "reaction", "chess"} and m in {"", "default"}:
        m = "1v1"
    if k == "arena" and m in {"", "default"}:
        m = "duel"
    return (k, m)


class Matchmaker:
    """In-memory LAN queue manager. WSHub handles room creation and message fanout."""

    def __init__(self):
        self.queues: Dict[QueueKey, Deque[int]] = defaultdict(deque)
        self.user_queue: Dict[int, QueueKey] = {}

    def queue_snapshot(self) -> Dict[str, dict]:
        out: Dict[str, dict] = {}
        for (kind, mode), q in self.queues.items():
            if not q:
                continue
            out[f"{kind}:{mode}"] = {"kind": kind, "mode": mode, "size": len(q)}
        return out

    def get_user_queue(self, user_id: int) -> Optional[QueueKey]:
        return self.user_queue.get(int(user_id))

    def queue_position(self, user_id: int, key: QueueKey) -> Optional[int]:
        q = self.queues.get(key)
        if not q:
            return None
        try:
            return list(q).index(int(user_id)) + 1
        except ValueError:
            return None

    def join(self, user_id: int, kind: str, mode: str) -> dict:
        uid = int(user_id)
        key = normalize_queue(kind, mode)
        if key not in QUEUE_RULES:
            return {"ok": False, "error": "unsupported_queue"}

        updates: Set[QueueKey] = set()
        matches: List[dict] = []

        # Only one active queue per user to keep UX simple.
        current = self.user_queue.get(uid)
        if current:
            if current == key:
                return {
                    "ok": True,
                    "kind": key[0],
                    "mode": key[1],
                    "left": None,
                    "updates": self._queue_update_payloads({key}),
                    "matches": [],
                }
            self._remove_from_queue(uid, current)
            updates.add(current)

        q = self.queues[key]
        if uid not in q:
            q.append(uid)
        self.user_queue[uid] = key
        updates.add(key)

        rule = QUEUE_RULES[key]
        while len(q) >= rule.players_needed:
            user_ids = [q.popleft() for _ in range(rule.players_needed)]
            for matched_uid in user_ids:
                self.user_queue.pop(int(matched_uid), None)
            matches.append({"kind": key[0], "mode": key[1], "user_ids": user_ids})
            updates.add(key)

        return {
            "ok": True,
            "kind": key[0],
            "mode": key[1],
            "left": current,
            "updates": self._queue_update_payloads(updates),
            "matches": matches,
        }

    def leave(self, user_id: int, kind: Optional[str] = None, mode: Optional[str] = None) -> dict:
        uid = int(user_id)
        current = self.user_queue.get(uid)
        if not current:
            return {"ok": True, "left": None, "updates": []}
        if kind is not None or mode is not None:
            target = normalize_queue(kind or current[0], mode or current[1])
            if current != target:
                return {"ok": True, "left": None, "updates": []}
        self._remove_from_queue(uid, current)
        self.user_queue.pop(uid, None)
        return {"ok": True, "left": current, "updates": self._queue_update_payloads({current})}

    def remove_user(self, user_id: int) -> dict:
        return self.leave(user_id)

    def _remove_from_queue(self, user_id: int, key: QueueKey) -> None:
        q = self.queues.get(key)
        if not q:
            return
        uid = int(user_id)
        try:
            q.remove(uid)
        except ValueError:
            pass
        if not q:
            self.queues.pop(key, None)

    def _queue_update_payloads(self, keys: Set[QueueKey]) -> List[dict]:
        payloads = []
        for key in sorted(keys):
            q = self.queues.get(key, deque())
            size = len(q)
            for idx, uid in enumerate(q, start=1):
                payloads.append(
                    {
                        "type": "queue_status",
                        "to_user": int(uid),
                        "kind": key[0],
                        "mode": key[1],
                        "position": idx,
                        "size": size,
                        "active": True,
                    }
                )
            # When queue becomes empty, previously queued users receive queue_left separately.
        return payloads

    def queue_left_payload(self, user_id: int, left_key: Optional[QueueKey]) -> Optional[dict]:
        if not left_key:
            return None
        return {
            "type": "queue_status",
            "to_user": int(user_id),
            "kind": left_key[0],
            "mode": left_key[1],
            "position": None,
            "size": 0,
            "active": False,
        }

