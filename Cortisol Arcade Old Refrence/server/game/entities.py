from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set


@dataclass
class Fighter:
    user_id: int
    username: str
    display_name: str
    character_id: str
    color: str
    team: int = 0
    accent_color: str = "#ffffff"
    x: float = 0.0
    y: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    move_speed: float = 320.0
    air_speed: float = 270.0
    jump_speed: float = 820.0
    weight: float = 1.0
    hitbox_scale: float = 1.0
    max_jumps: int = 2
    max_air_dashes: int = 1
    facing: int = 1
    damage_scale: float = 1.0
    kb_resist: float = 1.0
    damage: float = 0.0
    stocks: int = 3
    max_stocks: int = 3
    grounded: bool = False
    jumps_used: int = 0
    air_dashes_used: int = 0
    dash_cd: float = 0.0
    dash_timer: float = 0.0
    basic_cd: float = 0.0
    special_cd: float = 0.0
    ult_cd: float = 0.0
    stun_timer: float = 0.0
    landing_lag: float = 0.0
    respawn_timer: float = 0.0
    invuln_timer: float = 0.0
    coyote_timer: float = 0.0
    jump_buffer: float = 0.0
    ult_charge: float = 0.0
    alive: bool = True
    attack_key: str = ""
    attack_name: str = ""
    attack_timer: float = 0.0
    attack_seq: int = 0
    attack_hit_ids: Set[int] = field(default_factory=set)
    last_input_seq: int = 0
    score_kos: int = 0
    score_deaths: int = 0
    round_wins: int = 0
    damage_dealt: float = 0.0
    round_cc: int = 0
    match_cc: int = 0
    last_hit_by: Optional[int] = None
    ai_controlled: bool = False
    hit_latch: Dict[str, bool] = field(
        default_factory=lambda: {
            "jump": False,
            "dash": False,
            "basic": False,
            "special": False,
            "ult": False,
        }
    )
    recent_events: List[dict] = field(default_factory=list)

    def radius(self) -> float:
        return 24.0 * self.hitbox_scale

    def hurtbox_width(self) -> float:
        return 42.0 * self.hitbox_scale

    def hurtbox_height(self) -> float:
        return 72.0 * self.hitbox_scale

    def left(self) -> float:
        return self.x - (self.hurtbox_width() / 2)

    def right(self) -> float:
        return self.x + (self.hurtbox_width() / 2)

    def top(self) -> float:
        return self.y - self.hurtbox_height()

    def bottom(self) -> float:
        return self.y

    def clear_for_spawn(self) -> None:
        self.vx = 0.0
        self.vy = 0.0
        self.grounded = False
        self.jumps_used = 0
        self.air_dashes_used = 0
        self.dash_timer = 0.0
        self.stun_timer = 0.0
        self.landing_lag = 0.0
        self.attack_key = ""
        self.attack_name = ""
        self.attack_timer = 0.0
        self.attack_seq = 0
        self.attack_hit_ids.clear()
        self.hit_latch = {key: False for key in self.hit_latch}

    def to_public(self) -> dict:
        return {
            "user_id": self.user_id,
            "username": self.username,
            "display_name": self.display_name,
            "character_id": self.character_id,
            "color": self.color,
            "accent_color": self.accent_color,
            "team": self.team,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "vx": round(self.vx, 2),
            "vy": round(self.vy, 2),
            "alive": self.alive,
            "grounded": self.grounded,
            "damage": round(self.damage, 1),
            "stocks": self.stocks,
            "max_stocks": self.max_stocks,
            "facing": self.facing,
            "jump_speed": round(self.jump_speed, 1),
            "move_speed": round(self.move_speed, 1),
            "air_speed": round(self.air_speed, 1),
            "dash_cd": round(self.dash_cd, 2),
            "dash_timer": round(self.dash_timer, 2),
            "special_cd": round(self.special_cd, 2),
            "ult_cd": round(self.ult_cd, 2),
            "basic_cd": round(self.basic_cd, 2),
            "stun": round(self.stun_timer, 2),
            "landing_lag": round(self.landing_lag, 2),
            "respawn": round(self.respawn_timer, 2),
            "invuln": round(self.invuln_timer, 2),
            "ult_charge": round(self.ult_charge, 1),
            "score_kos": self.score_kos,
            "score_deaths": self.score_deaths,
            "round_wins": self.round_wins,
            "damage_dealt": round(self.damage_dealt, 1),
            "round_cc": self.round_cc,
            "match_cc": self.match_cc,
            "last_input_seq": self.last_input_seq,
            "attack_key": self.attack_key,
            "attack_name": self.attack_name,
            "attack_timer": round(self.attack_timer, 3),
            "hitbox_scale": round(self.hitbox_scale, 3),
            "weight": round(self.weight, 2),
            "ai_controlled": self.ai_controlled,
        }
