import random
from typing import Dict, List, Optional, Set


PHRASES = [
    "resume bullets not paragraphs",
    "practice interview eye contact",
    "career fair speedrun any percent",
    "brainstorm first then draft",
    "lock in and cite sources",
    "sigma cover letter but polite",
    "cortisol stable submit early",
]


class TypingDuelRoom:
    mode = "typing"

    def __init__(self, room_id: str, db):
        self.room_id = room_id
        self.db = db
        self.members: Set[int] = set()
        self.players: List[int] = []
        self.spectators: Set[int] = set()
        self.outbox: List[dict] = []
        self.state = "waiting"
        self.best_of = 3
        self.round_number = 0
        self.score: Dict[int, int] = {}
        self.current_phrase = ""
        self.round_open = False
        self.ended = False
        self.round_timeout = 18.0
        self._snapshot_accum = 0.0

    def join(self, user_id: int) -> dict:
        self.members.add(user_id)
        if user_id not in self.players and len(self.players) < 2:
            self.players.append(user_id)
            self.score.setdefault(user_id, 0)
        else:
            self.spectators.add(user_id)
        if len(self.players) == 2 and self.state == "waiting":
            self.state = "running"
            self._start_round()
        self.outbox.append({"type": "typing_roster", "room_id": self.room_id, "players": self.players, "spectators": list(self.spectators)})
        return {"state": self.state}

    def leave(self, user_id: int) -> None:
        self.members.discard(user_id)
        self.spectators.discard(user_id)
        if user_id in self.players:
            self.players.remove(user_id)
            if self.state == "running" and not self.ended:
                self.finish("player_left")

    def _start_round(self) -> None:
        self.round_number += 1
        self.current_phrase = random.choice(PHRASES)
        self.round_open = True
        self.round_timeout = 18.0
        self.outbox.append({"type": "typing_round", "room_id": self.room_id, "round": self.round_number, "phrase": self.current_phrase})

    def handle(self, user_id: int, msg: dict) -> None:
        t = msg.get("type")
        if t == "typing_submit" and self.round_open and user_id in self.players and not self.ended:
            text = str(msg.get("text", ""))
            if text.strip() == self.current_phrase:
                self.round_open = False
                self.score[user_id] = self.score.get(user_id, 0) + 1
                self.outbox.append({"type": "typing_round_win", "room_id": self.room_id, "user_id": user_id, "score": self.score})
                self._maybe_finish_or_next()
            else:
                self.outbox.append({"type": "typing_incorrect", "room_id": self.room_id, "user_id": user_id})
        elif t == "typing_restart" and self.ended:
            members = list(self.members)
            self.__init__(self.room_id, self.db)
            for uid in members:
                self.join(uid)

    def _maybe_finish_or_next(self) -> None:
        need = self.best_of // 2 + 1
        if any(points >= need for points in self.score.values()):
            self.finish("score")
            return
        if self.round_number >= self.best_of:
            self.finish("round_limit")
            return
        self._start_round()

    def tick(self, dt: float) -> None:
        if self.state != "running" or self.ended or not self.round_open:
            return
        self._snapshot_accum += dt
        self.round_timeout -= dt
        if self.round_timeout <= 0:
            self.round_open = False
            self.outbox.append({"type": "typing_round_timeout", "room_id": self.room_id, "round": self.round_number})
            if self.round_number >= self.best_of:
                self.finish("time")
            else:
                self._start_round()
        if self._snapshot_accum >= 0.2:
            self._snapshot_accum = 0.0
            self.outbox.append(self.snapshot())

    def finish(self, reason: str) -> None:
        if self.ended:
            return
        self.ended = True
        self.state = "ended"
        if len(self.players) == 2:
            a, b = self.players
            sa = self.score.get(a, 0)
            sb = self.score.get(b, 0)
            if sa != sb:
                winner = a if sa > sb else b
                loser = b if winner == a else a
                self.db.apply_match_result(winner, win=True)
                self.db.apply_match_result(loser, win=False)
        self.outbox.append({"type": "typing_end", "room_id": self.room_id, "reason": reason, "score": self.score})

    def snapshot(self) -> dict:
        return {
            "type": "typing_state",
            "room_id": self.room_id,
            "state": self.state,
            "round": self.round_number,
            "players": self.players,
            "score": self.score,
            "round_open": self.round_open,
            "timeout": round(max(self.round_timeout, 0.0), 2),
            "phrase": self.current_phrase if not self.ended else self.current_phrase,
        }

    def drain_outbox(self) -> List[dict]:
        out, self.outbox = self.outbox, []
        return out
