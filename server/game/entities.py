from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Vec2:
    x: float = 0.0
    y: float = 0.0

    def copy(self) -> "Vec2":
        return Vec2(self.x, self.y)

    def add(self, other: "Vec2") -> "Vec2":
        self.x += other.x
        self.y += other.y
        return self

    def scale(self, s: float) -> "Vec2":
        self.x *= s
        self.y *= s
        return self


@dataclass
class InputState:
    up: bool = False
    down: bool = False
    left: bool = False
    right: bool = False
    dash: bool = False
    basic: bool = False
    special: bool = False
    ult: bool = False
    seq: int = 0


@dataclass
class Fighter:
    user_id: int
    username: str
    display_name: str
    character_id: str
    color: str
    team: int = 0
    x: float = 0.0
    y: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    hp: float = 100.0
    max_hp: float = 100.0
    move_speed: float = 180.0
    damage_scale: float = 1.0
    kb_resist: float = 1.0
    hitbox_scale: float = 1.0
    dash_cd: float = 0.0
    dash_timer: float = 0.0
    basic_cd: float = 0.0
    special_cd: float = 0.0
    ult_cd: float = 0.0
    stun_timer: float = 0.0
    respawn_timer: float = 0.0
    ult_charge: float = 0.0
    ult_buff_timer: float = 0.0
    slow_timer: float = 0.0
    slow_mult: float = 1.0
    alive: bool = True
    last_input_seq: int = 0
    score_kos: int = 0
    score_deaths: int = 0
    last_hit_by: Optional[int] = None
    hit_latch: Dict[str, bool] = field(default_factory=lambda: {"dash": False, "basic": False, "special": False, "ult": False})
    recent_events: List[dict] = field(default_factory=list)

    def radius(self) -> float:
        return 16.0 * self.hitbox_scale

    def to_public(self) -> dict:
        return {
            "user_id": self.user_id,
            "username": self.username,
            "display_name": self.display_name,
            "character_id": self.character_id,
            "color": self.color,
            "team": self.team,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "vx": round(self.vx, 2),
            "vy": round(self.vy, 2),
            "hp": round(self.hp, 1),
            "max_hp": round(self.max_hp, 1),
            "alive": self.alive,
            "dash_cd": round(self.dash_cd, 2),
            "special_cd": round(self.special_cd, 2),
            "ult_cd": round(self.ult_cd, 2),
            "stun": round(self.stun_timer, 2),
            "respawn": round(self.respawn_timer, 2),
            "ult_charge": round(self.ult_charge, 1),
            "score_kos": self.score_kos,
            "score_deaths": self.score_deaths,
            "last_input_seq": self.last_input_seq,
            "ult_buff": round(self.ult_buff_timer, 2),
            "slow": round(self.slow_timer, 2),
        }

