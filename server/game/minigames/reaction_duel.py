import random
from typing import Dict, List, Optional, Set


class ReactionDuelRoom:
    mode = "reaction"

    def __init__(self, room_id: str, db):
        self.room_id = room_id
        self.db = db
        self.members: Set[int] = set()
        self.players: List[int] = []
        self.spectators: Set[int] = set()
        self.outbox: List[dict] = []
        self.state = "waiting"
        self.phase = "idle"
        self.phase_timer = 0.0
        self.round_number = 0
        self.best_of = 5
        self.score: Dict[int, int] = {}
        self.false_start_user: Optional[int] = None
        self.ended = False
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
            self._start_next_round()
        self.outbox.append({"type": "reaction_roster", "room_id": self.room_id, "players": self.players, "spectators": list(self.spectators)})
        return {"state": self.state}

    def leave(self, user_id: int) -> None:
        self.members.discard(user_id)
        self.spectators.discard(user_id)
        if user_id in self.players:
            self.players.remove(user_id)
            if self.state == "running" and not self.ended:
                self.finish("player_left")

    def handle(self, user_id: int, msg: dict) -> None:
        t = msg.get("type")
        if t == "reaction_press":
            if self.state != "running" or self.ended or user_id not in self.players:
                return
            if self.phase == "wait":
                # false start awards point to opponent
                opp = next((p for p in self.players if p != user_id), None)
                if opp is not None:
                    self.score[opp] = self.score.get(opp, 0) + 1
                self.false_start_user = user_id
                self.phase = "round_end"
                self.phase_timer = 1.2
                self.outbox.append({"type": "reaction_false_start", "room_id": self.room_id, "user_id": user_id, "score": self.score})
            elif self.phase == "go":
                self.score[user_id] = self.score.get(user_id, 0) + 1
                self.phase = "round_end"
                self.phase_timer = 1.0
                self.outbox.append({"type": "reaction_round_win", "room_id": self.room_id, "user_id": user_id, "score": self.score})
                self._check_end()
        elif t == "reaction_restart" and self.ended:
            members = list(self.members)
            self.__init__(self.room_id, self.db)
            for uid in members:
                self.join(uid)

    def _start_next_round(self) -> None:
        self.round_number += 1
        self.phase = "wait"
        self.phase_timer = random.uniform(1.0, 5.0)
        self.false_start_user = None
        self.outbox.append({"type": "reaction_round_start", "room_id": self.room_id, "round": self.round_number})

    def _check_end(self) -> None:
        need = self.best_of // 2 + 1
        for uid, points in self.score.items():
            if points >= need:
                self.finish("score")
                return
        if self.round_number >= self.best_of and self.phase == "round_end":
            self.finish("round_limit")

    def tick(self, dt: float) -> None:
        if self.state != "running" or self.ended:
            return
        self._snapshot_accum += dt
        self.phase_timer -= dt
        if self.phase == "wait" and self.phase_timer <= 0:
            self.phase = "go"
            self.phase_timer = 2.0
            self.outbox.append({"type": "reaction_go", "room_id": self.room_id, "round": self.round_number})
        elif self.phase == "go" and self.phase_timer <= 0:
            self.phase = "round_end"
            self.phase_timer = 1.0
            self.outbox.append({"type": "reaction_timeout", "room_id": self.room_id, "round": self.round_number})
        elif self.phase == "round_end" and self.phase_timer <= 0 and not self.ended:
            self._check_end()
            if not self.ended:
                self._start_next_round()
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
        self.outbox.append({"type": "reaction_end", "room_id": self.room_id, "reason": reason, "score": self.score})

    def snapshot(self) -> dict:
        return {
            "type": "reaction_state",
            "room_id": self.room_id,
            "state": self.state,
            "phase": self.phase,
            "phase_timer": round(max(self.phase_timer, 0.0), 2),
            "round": self.round_number,
            "players": self.players,
            "score": self.score,
        }

    def drain_outbox(self) -> List[dict]:
        out = self.outbox[:]
        self.outbox.clear()
        return out
