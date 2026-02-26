import random
from typing import Dict, List, Optional, Set


class PongRoom:
    mode = "pong"

    def __init__(self, room_id: str, db, duration_seconds: int = 60):
        self.room_id = room_id
        self.db = db
        self.members: Set[int] = set()
        self.players: List[int] = []
        self.spectators: Set[int] = set()
        self.outbox: List[dict] = []
        self.inputs: Dict[int, Dict[str, bool]] = {}
        self.state = "waiting"
        self.width = 800
        self.height = 450
        self.ball_x = self.width / 2
        self.ball_y = self.height / 2
        self.ball_vx = random.choice([-1, 1]) * 260.0
        self.ball_vy = random.uniform(-160, 160)
        self.paddle_h = 90
        self.paddle_speed = 330.0
        self.left_y = self.height / 2
        self.right_y = self.height / 2
        self.score = {0: 0, 1: 0}
        self.time_left = float(duration_seconds)
        self.ended = False
        self._snapshot_accum = 0.0
        self._tick_seq = 0
        self.last_result: Optional[dict] = None

    def join(self, user_id: int) -> dict:
        self.members.add(user_id)
        if user_id not in self.players and len(self.players) < 2:
            self.players.append(user_id)
            slot = self.players.index(user_id)
        else:
            self.spectators.add(user_id)
            slot = None
        if len(self.players) == 2 and self.state == "waiting":
            self.state = "running"
        self.outbox.append({"type": "pong_roster", "room_id": self.room_id, "players": self.players, "spectators": list(self.spectators)})
        return {"slot": slot, "state": self.state}

    def leave(self, user_id: int) -> None:
        self.members.discard(user_id)
        self.spectators.discard(user_id)
        if user_id in self.players:
            idx = self.players.index(user_id)
            self.players.remove(user_id)
            self.score[1 - idx] = max(self.score.get(1 - idx, 0), 5)
            if self.state == "running":
                self.finish(reason="player_left")
        self.inputs.pop(user_id, None)
        self.outbox.append({"type": "pong_roster", "room_id": self.room_id, "players": self.players, "spectators": list(self.spectators)})

    def handle(self, user_id: int, msg: dict) -> None:
        if msg.get("type") == "pong_input":
            self.inputs[user_id] = {
                "up": bool(msg.get("up")),
                "down": bool(msg.get("down")),
            }
        elif msg.get("type") == "pong_restart" and self.ended:
            members = list(self.members)
            self.__init__(self.room_id, self.db)
            for uid in members:
                self.join(uid)

    def _move_paddle(self, y: float, inp: Dict[str, bool], dt: float) -> float:
        dy = 0.0
        if inp.get("up"):
            dy -= self.paddle_speed * dt
        if inp.get("down"):
            dy += self.paddle_speed * dt
        y = max(self.paddle_h / 2, min(self.height - self.paddle_h / 2, y + dy))
        return y

    def tick(self, dt: float) -> None:
        if self.state != "running" or self.ended:
            return
        self._tick_seq += 1
        self.time_left = max(0.0, self.time_left - dt)
        left_uid = self.players[0] if len(self.players) > 0 else None
        right_uid = self.players[1] if len(self.players) > 1 else None
        self.left_y = self._move_paddle(self.left_y, self.inputs.get(left_uid or -1, {}), dt)
        self.right_y = self._move_paddle(self.right_y, self.inputs.get(right_uid or -1, {}), dt)

        self.ball_x += self.ball_vx * dt
        self.ball_y += self.ball_vy * dt
        if self.ball_y <= 8 or self.ball_y >= self.height - 8:
            self.ball_vy *= -1
            self.ball_y = max(8, min(self.height - 8, self.ball_y))

        if self.ball_x <= 30 and abs(self.ball_y - self.left_y) <= self.paddle_h / 2:
            self.ball_x = 30
            self.ball_vx = abs(self.ball_vx) * 1.03
            self.ball_vy += (self.ball_y - self.left_y) * 2.4
        elif self.ball_x >= self.width - 30 and abs(self.ball_y - self.right_y) <= self.paddle_h / 2:
            self.ball_x = self.width - 30
            self.ball_vx = -abs(self.ball_vx) * 1.03
            self.ball_vy += (self.ball_y - self.right_y) * 2.4

        if self.ball_x < 0:
            self.score[1] += 1
            self._reset_ball(direction=1)
        elif self.ball_x > self.width:
            self.score[0] += 1
            self._reset_ball(direction=-1)

        if self.score[0] >= 5 or self.score[1] >= 5 or self.time_left <= 0:
            self.finish(reason="score_or_time")

        self._snapshot_accum += dt
        if self._snapshot_accum >= 1 / 20:
            self._snapshot_accum = 0.0
            self.outbox.append(self.snapshot())

    def _reset_ball(self, direction: int) -> None:
        self.ball_x = self.width / 2
        self.ball_y = self.height / 2
        self.ball_vx = direction * random.uniform(240, 320)
        self.ball_vy = random.uniform(-180, 180)

    def finish(self, reason: str) -> None:
        if self.ended:
            return
        self.ended = True
        self.state = "ended"
        winner_idx = None
        if self.score[0] != self.score[1]:
            winner_idx = 0 if self.score[0] > self.score[1] else 1
        if winner_idx is not None and len(self.players) == 2:
            winner_uid = self.players[winner_idx]
            loser_uid = self.players[1 - winner_idx]
            self.db.apply_match_result(winner_uid, win=True)
            self.db.apply_match_result(loser_uid, win=False)
            self.last_result = {"winner_user_id": winner_uid, "loser_user_id": loser_uid}
        self.outbox.append({"type": "pong_end", "room_id": self.room_id, "reason": reason, "score": self.score, "result": self.last_result})

    def snapshot(self) -> dict:
        return {
            "type": "pong_state",
            "room_id": self.room_id,
            "state": self.state,
            "players": self.players,
            "score": self.score,
            "ball": {"x": round(self.ball_x, 2), "y": round(self.ball_y, 2)},
            "paddles": {"left_y": round(self.left_y, 2), "right_y": round(self.right_y, 2)},
            "time_left": round(self.time_left, 2),
            "tick": self._tick_seq,
            "width": self.width,
            "height": self.height,
        }

    def drain_outbox(self) -> List[dict]:
        out, self.outbox = self.outbox, []
        return out
