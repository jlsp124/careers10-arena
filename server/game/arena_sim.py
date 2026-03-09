from __future__ import annotations

import json
import math
import random
from typing import Dict, List, Optional, Set

from game.ai import HanniganBossAI
from game.constants import (
    ARENA_HEIGHT,
    ARENA_SNAPSHOT_RATE,
    ARENA_WIDTH,
    BASIC_COOLDOWN_SECONDS,
    BASIC_DAMAGE,
    BASIC_KB,
    BASIC_RANGE,
    CHARACTER_SELECT_SECONDS,
    COIN_MATCH_REWARD_CAP,
    COIN_MAX_ACTIVE,
    COIN_SPAWN_INTERVAL_SECONDS,
    COIN_SPAWN_VALUE_MAX,
    COIN_SPAWN_VALUE_MIN,
    DASH_COOLDOWN_SECONDS,
    DASH_DURATION_SECONDS,
    DASH_SPEED,
    DEFAULT_BEST_OF,
    DEFAULT_MATCH_SECONDS,
    DEFAULT_ROUND_KO_TARGET,
    DEFAULT_ROUND_SECONDS,
    RESPAWN_INVULN_SECONDS,
    RESPAWN_SECONDS,
    ROUND_INTERMISSION_SECONDS,
    ROUND_START_COUNTDOWN_SECONDS,
    SPECIAL_COOLDOWN_SECONDS,
    STUN_ON_HIT_SECONDS,
    TEAM_COLORS,
    ULT_CHARGE_MAX,
    ULT_COOLDOWN_SECONDS,
)
from game.entities import Fighter
from util import WEB_ROOT, clamp


OUT_OF_BOUNDS_MARGIN = 64


def _fallback_characters() -> Dict[str, dict]:
    return {
        "jovan": {
            "id": "jovan",
            "display_name": "Jovan",
            "color": "#4cc9f0",
            "archetype": "smart/utility",
            "stats": {"hp": 100, "speed": 185, "damage": 1.0, "knockback_resist": 1.0, "hitbox_scale": 1.0},
            "move_names": {"basic": "Notebook Jab", "special": "Study Slow", "ult": "Lock In"},
        },
        "big_t": {
            "id": "big_t",
            "display_name": "Big T",
            "color": "#ff7b54",
            "archetype": "bruiser",
            "stats": {"hp": 130, "speed": 160, "damage": 1.2, "knockback_resist": 1.25, "hitbox_scale": 1.18},
            "move_names": {"basic": "Reach Check", "special": "Hallway Shove", "ult": "Desk Slam"},
        },
        "simon": {
            "id": "simon",
            "display_name": "Simon",
            "color": "#06d6a0",
            "archetype": "speedster",
            "stats": {"hp": 90, "speed": 225, "damage": 0.9, "knockback_resist": 0.9, "hitbox_scale": 0.95},
            "move_names": {"basic": "Zoom Tap", "special": "Dash Mix", "ult": "Frame Advantage"},
        },
        "edward": {
            "id": "edward",
            "display_name": "Edward",
            "color": "#ffd166",
            "archetype": "tricky",
            "stats": {"hp": 92, "speed": 195, "damage": 0.95, "knockback_resist": 0.92, "hitbox_scale": 0.82},
            "move_names": {"basic": "Feint Flick", "special": "Low Profile", "ult": "Tiny Hitbox Arc"},
        },
        "griffin": {
            "id": "griffin",
            "display_name": "Griffin",
            "color": "#9b5de5",
            "archetype": "heavy hitter",
            "stats": {"hp": 115, "speed": 155, "damage": 1.28, "knockback_resist": 1.05, "hitbox_scale": 1.05},
            "move_names": {"basic": "Patch Notes", "special": "Cast Nerf", "ult": "Emergency Balance Patch"},
        },
        "hannigan": {
            "id": "hannigan",
            "display_name": "Mr. Hannigan",
            "color": "#ef476f",
            "archetype": "tank",
            "stats": {"hp": 180, "speed": 145, "damage": 1.15, "knockback_resist": 1.45, "hitbox_scale": 1.22},
            "move_names": {"basic": "Clipboard Bonk", "special": "Attendance Aura", "ult": "Engagement Intervention"},
        },
    }


def load_character_defs() -> Dict[str, dict]:
    path = WEB_ROOT / "assets" / "characters.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            out = {c["id"]: c for c in data if isinstance(c, dict) and c.get("id")}
            if out:
                return out
    except Exception:
        pass
    return _fallback_characters()


CHARACTERS = load_character_defs()


def _norm(dx: float, dy: float) -> tuple[float, float, float]:
    dist = math.hypot(dx, dy)
    if dist <= 0.0001:
        return 0.0, 0.0, 0.0001
    return dx / dist, dy / dist, dist


def _team_for(mode: str, idx: int) -> int:
    if mode == "teams":
        return idx % 2
    return idx


class ArenaRoom:
    mode = "arena"

    def __init__(
        self,
        room_id: str,
        db,
        mode_name: str = "ffa",
        match_seconds: int = DEFAULT_MATCH_SECONDS,
        best_of: int = DEFAULT_BEST_OF,
        round_seconds: int = DEFAULT_ROUND_SECONDS,
        round_ko_target: Optional[int] = None,
    ):
        self.room_id = room_id
        self.db = db
        self.mode_name = mode_name if mode_name in {"duel", "teams", "ffa", "boss", "practice"} else "ffa"
        self.width = ARENA_WIDTH
        self.height = ARENA_HEIGHT
        self.members: Set[int] = set()
        self.players: List[int] = []
        self.spectators: Set[int] = set()
        self.ready: Set[int] = set()
        self.fighters: Dict[int, Fighter] = {}
        self.inputs: Dict[int, dict] = {}
        self.outbox: List[dict] = []
        self.state = "lobby"
        self.match_seconds = int(clamp(match_seconds, 45, 240))
        safe_best = int(clamp(best_of, 1, 7))
        self.best_of = safe_best if safe_best % 2 == 1 else safe_best + 1
        self.wins_required = self.best_of // 2 + 1
        self.round_seconds = int(clamp(round_seconds, 30, 120))
        self.round_ko_target = int(clamp(round_ko_target or self._default_round_ko_target(), 1, 12))
        self.round_index = 0

        self.character_select_left = 0.0
        self.round_start_left = 0.0
        self.round_time_left = float(self.round_seconds)
        self.round_end_left = 0.0

        self.tick_seq = 0
        self._snapshot_accum = 0.0
        self._event_accum: List[dict] = []
        self._rng = random.Random()

        self.round_kos: Dict[int, int] = {}
        self.round_damage: Dict[int, float] = {}

        self.coins: List[dict] = []
        self.coin_seq = 0
        self.coin_spawn_accum = 0.0

        self.boss_fighter: Optional[Fighter] = None
        self.boss_ai: Optional[HanniganBossAI] = None
        self.ended = False
        self._results_applied = False
        self.last_result_summary: Dict[int, dict] = {}

    def _max_players(self) -> int:
        return {
            "duel": 2,
            "teams": 4,
            "ffa": 6,
            "boss": 4,
            "practice": 1,
        }.get(self.mode_name, 6)

    def _min_players(self) -> int:
        return {
            "duel": 2,
            "teams": 4,
            "ffa": 2,
            "boss": 1,
            "practice": 1,
        }.get(self.mode_name, 1)

    def _default_round_ko_target(self) -> int:
        return {
            "duel": 3,
            "teams": 5,
            "ffa": 4,
            "boss": 1,
            "practice": 50,
        }.get(self.mode_name, DEFAULT_ROUND_KO_TARGET)

    def _default_char(self) -> str:
        return next(iter(CHARACTERS.keys()))

    def join(self, user: dict) -> dict:
        user_id = int(user["id"])
        self.members.add(user_id)
        if user_id not in self.players and user_id not in self.spectators:
            if len(self.players) < self._max_players() and self.state != "match_end":
                self.players.append(user_id)
                self._spawn_or_create_fighter(user)
            else:
                self.spectators.add(user_id)
        self._assign_teams()
        if self.state == "lobby" and len(self.players) >= self._min_players():
            self._enter_character_select()
        self.outbox.append(self.roster_message())
        return {"state": self.state, "mode_name": self.mode_name}

    def leave(self, user_id: int) -> None:
        self.members.discard(user_id)
        self.ready.discard(user_id)
        self.spectators.discard(user_id)
        self.inputs.pop(user_id, None)
        self.fighters.pop(user_id, None)
        self.round_kos.pop(user_id, None)
        self.round_damage.pop(user_id, None)
        if user_id in self.players:
            self.players.remove(user_id)
            self._assign_teams()
        if not self.players:
            self._return_to_lobby("empty")
        elif len(self.players) < self._min_players() and self.state in {"character_select", "round_start", "in_round", "round_end"}:
            self._return_to_lobby("not_enough_players")
        self.outbox.append(self.roster_message())

    def _spawn_or_create_fighter(self, user: dict) -> Fighter:
        user_id = int(user["id"])
        fighter = self.fighters.get(user_id)
        if fighter is None:
            default_char = self._default_char()
            fighter = Fighter(
                user_id=user_id,
                username=user["username"],
                display_name=user.get("display_name") or user["username"],
                character_id=default_char,
                color=CHARACTERS.get(default_char, {}).get("color", TEAM_COLORS[user_id % len(TEAM_COLORS)]),
            )
            self.fighters[user_id] = fighter
        self._apply_character_stats(fighter, fighter.character_id)
        self._respawn_fighter(fighter, full_heal=True)
        return fighter

    def _assign_teams(self) -> None:
        for idx, user_id in enumerate(self.players):
            fighter = self.fighters.get(user_id)
            if not fighter:
                continue
            fighter.team = _team_for(self.mode_name, idx)
            if self.mode_name == "teams":
                fighter.color = TEAM_COLORS[fighter.team % len(TEAM_COLORS)]
            else:
                c = CHARACTERS.get(fighter.character_id, {})
                fighter.color = c.get("color", TEAM_COLORS[idx % len(TEAM_COLORS)])

    def _apply_character_stats(self, fighter: Fighter, char_id: str) -> None:
        char = CHARACTERS.get(char_id)
        if not char:
            char = CHARACTERS[self._default_char()]
        fighter.character_id = char["id"]
        stats = char.get("stats", {})
        fighter.max_hp = float(stats.get("hp", 100))
        fighter.hp = min(fighter.hp or fighter.max_hp, fighter.max_hp)
        fighter.move_speed = float(stats.get("speed", 180))
        fighter.damage_scale = float(stats.get("damage", 1.0))
        fighter.kb_resist = float(stats.get("knockback_resist", 1.0))
        fighter.hitbox_scale = float(stats.get("hitbox_scale", 1.0))
        fighter.color = char.get("color", fighter.color)
    def _reset_for_new_match(self) -> None:
        self.round_index = 0
        self.round_kos = {uid: 0 for uid in self.players}
        self.round_damage = {uid: 0.0 for uid in self.players}
        self.coins = []
        self.coin_seq = 0
        self.coin_spawn_accum = 0.0
        self.tick_seq = 0
        self._snapshot_accum = 0.0
        self._event_accum = []
        self.last_result_summary = {}
        self.ended = False
        self._results_applied = False
        for uid in self.players:
            fighter = self.fighters.get(uid)
            if not fighter:
                continue
            fighter.score_kos = 0
            fighter.score_deaths = 0
            fighter.round_wins = 0
            fighter.damage_dealt = 0.0
            fighter.round_cc = 0
            fighter.match_cc = 0
            fighter.ult_charge = 0.0
            fighter.ult_buff_timer = 0.0
            fighter.slow_timer = 0.0
            fighter.slow_mult = 1.0
            fighter.dash_cd = fighter.basic_cd = fighter.special_cd = fighter.ult_cd = 0.0
            self._respawn_fighter(fighter, full_heal=True)

    def _spawn_boss(self) -> None:
        if self.mode_name != "boss":
            self.boss_fighter = None
            self.boss_ai = None
            return
        boss = Fighter(
            user_id=0,
            username="boss",
            display_name="Mr. Hannigan",
            character_id="hannigan",
            color=CHARACTERS.get("hannigan", {}).get("color", "#ef476f"),
            team=999,
        )
        self._apply_character_stats(boss, "hannigan")
        boss.max_hp *= 2.2
        boss.hp = boss.max_hp
        boss.move_speed *= 0.92
        boss.x = self.width / 2
        boss.y = self.height / 2
        boss.ult_charge = 100.0
        self.boss_fighter = boss
        self.boss_ai = HanniganBossAI()

    def _enter_character_select(self) -> None:
        if len(self.players) < self._min_players():
            return
        self._reset_for_new_match()
        self.state = "character_select"
        self.character_select_left = CHARACTER_SELECT_SECONDS
        self.round_start_left = 0.0
        self.round_time_left = float(self.round_seconds)
        self.round_end_left = 0.0
        self.ready = set()
        self.outbox.append({"type": "arena_state_change", "room_id": self.room_id, "state": self.state, "seconds": self.character_select_left})
        self.outbox.append(self.roster_message())

    def _enter_round_start(self) -> None:
        self.state = "round_start"
        self.round_index += 1
        self.round_start_left = ROUND_START_COUNTDOWN_SECONDS
        self.round_time_left = float(self.round_seconds)
        self.round_end_left = 0.0
        self.round_kos = {uid: 0 for uid in self.players}
        self.round_damage = {uid: 0.0 for uid in self.players}
        self.coins = []
        self.coin_spawn_accum = 0.0
        for uid in self.players:
            fighter = self.fighters.get(uid)
            if not fighter:
                continue
            fighter.round_cc = 0
            fighter.ult_charge = min(fighter.ult_charge, ULT_CHARGE_MAX)
            fighter.dash_cd = fighter.basic_cd = fighter.special_cd = fighter.ult_cd = 0.0
            fighter.ult_buff_timer = 0.0
            fighter.slow_timer = 0.0
            fighter.slow_mult = 1.0
            self._respawn_fighter(fighter, full_heal=True)
        self._spawn_boss()
        self.outbox.append(
            {
                "type": "arena_round_start",
                "room_id": self.room_id,
                "round": self.round_index,
                "best_of": self.best_of,
                "wins_required": self.wins_required,
                "seconds": self.round_start_left,
            }
        )

    def _enter_in_round(self) -> None:
        self.state = "in_round"
        self.outbox.append({"type": "arena_start", "room_id": self.room_id, "mode_name": self.mode_name, "round": self.round_index, "time_left": self.round_time_left})

    def _finish_round(self, reason: str) -> None:
        if self.state != "in_round":
            return
        self.state = "round_end"
        self.round_end_left = ROUND_INTERMISSION_SECONDS
        winners = self._round_winners()
        for uid in winners:
            fighter = self.fighters.get(uid)
            if fighter:
                fighter.round_wins += 1
        self.outbox.append(
            {
                "type": "arena_round_end",
                "room_id": self.room_id,
                "reason": reason,
                "round": self.round_index,
                "winners": sorted(winners),
                "scores": self._round_score_rows(),
                "next_in": self.round_end_left,
            }
        )

    def _return_to_lobby(self, reason: str) -> None:
        self.state = "lobby"
        self.character_select_left = 0.0
        self.round_start_left = 0.0
        self.round_time_left = float(self.round_seconds)
        self.round_end_left = 0.0
        self.ready = set()
        self.coins = []
        self.boss_fighter = None
        self.boss_ai = None
        self.outbox.append({"type": "arena_state_change", "room_id": self.room_id, "state": "lobby", "reason": reason})

    def roster_message(self) -> dict:
        return {
            "type": "arena_roster",
            "room_id": self.room_id,
            "mode_name": self.mode_name,
            "state": self.state,
            "players": self.players,
            "spectators": list(self.spectators),
            "ready": list(self.ready),
            "round": self.round_index,
            "best_of": self.best_of,
            "wins_required": self.wins_required,
            "fighters": {uid: self._fighter_meta(f) for uid, f in self.fighters.items() if uid in self.players},
        }

    def _fighter_meta(self, f: Fighter) -> dict:
        char = CHARACTERS.get(f.character_id, {})
        return {
            "user_id": f.user_id,
            "username": f.username,
            "display_name": f.display_name,
            "character_id": f.character_id,
            "character_name": char.get("display_name", f.character_id),
            "move_names": char.get("move_names", {}),
            "team": f.team,
            "color": f.color,
        }

    def handle(self, user_id: int, msg: dict) -> None:
        t = msg.get("type")
        if t == "arena_select":
            char_id = str(msg.get("character_id", "")).strip().lower()
            if user_id in self.fighters and char_id in CHARACTERS and self.state in {"character_select", "lobby"}:
                self._apply_character_stats(self.fighters[user_id], char_id)
                self.outbox.append(self.roster_message())
        elif t == "arena_ready":
            if user_id in self.players and self.state == "character_select":
                if bool(msg.get("ready", True)):
                    self.ready.add(user_id)
                else:
                    self.ready.discard(user_id)
                self.outbox.append(self.roster_message())
        elif t == "arena_input":
            if user_id in self.players:
                self.inputs[user_id] = {
                    "seq": int(msg.get("seq", 0)),
                    "dt": float(msg.get("dt", 0.0) or 0.0),
                    "up": bool(msg.get("up")),
                    "down": bool(msg.get("down")),
                    "left": bool(msg.get("left")),
                    "right": bool(msg.get("right")),
                    "dash": bool(msg.get("dash")),
                    "basic": bool(msg.get("basic")),
                    "special": bool(msg.get("special")),
                    "ult": bool(msg.get("ult")),
                }
        elif t == "arena_start":
            if self.state == "lobby":
                self._enter_character_select()
            elif self.state == "character_select":
                self.character_select_left = min(self.character_select_left, 0.2)
        elif t == "arena_restart" and self.state in {"match_end", "lobby"}:
            self._enter_character_select()

    def _spawn_points(self) -> List[tuple[float, float]]:
        pts = [
            (110, 110),
            (self.width - 110, self.height - 110),
            (self.width - 110, 110),
            (110, self.height - 110),
            (self.width / 2, 100),
            (self.width / 2, self.height - 100),
        ]
        self._rng.shuffle(pts)
        return pts

    def _respawn_fighter(self, fighter: Fighter, full_heal: bool = True) -> None:
        idx = self.players.index(fighter.user_id) if fighter.user_id in self.players else 0
        pts = self._spawn_points()
        fighter.x, fighter.y = pts[idx % len(pts)]
        fighter.vx = fighter.vy = 0.0
        fighter.alive = True
        fighter.respawn_timer = 0.0
        fighter.stun_timer = 0.0
        fighter.invuln_timer = RESPAWN_INVULN_SECONDS
        if full_heal:
            fighter.hp = fighter.max_hp

    def _ko_fighter(self, victim: Fighter, killer_id: Optional[int]) -> None:
        victim.alive = False
        victim.respawn_timer = RESPAWN_SECONDS
        victim.score_deaths += 1
        victim.hp = 0.0
        victim.vx = victim.vy = 0.0
        if killer_id and killer_id in self.fighters:
            killer = self.fighters[killer_id]
            killer.score_kos += 1
            self.round_kos[killer_id] = self.round_kos.get(killer_id, 0) + 1
            killer.ult_charge = min(ULT_CHARGE_MAX, killer.ult_charge + 18)
        self._event_accum.append({"kind": "ko", "victim": victim.user_id, "killer": killer_id})
    def _enemy_targets(self, attacker: Fighter) -> List[Fighter]:
        humans = [self.fighters[uid] for uid in self.players if uid in self.fighters]
        targets: List[Fighter] = []
        for f in humans + ([self.boss_fighter] if self.boss_fighter else []):
            if not f or f.user_id == attacker.user_id or not f.alive:
                continue
            if f.invuln_timer > 0:
                continue
            if self.mode_name == "teams" and attacker.user_id != 0 and f.user_id != 0 and attacker.team == f.team:
                continue
            if self.mode_name == "boss":
                if attacker.user_id == 0 and f.user_id == 0:
                    continue
                if attacker.user_id != 0 and f.user_id != 0:
                    continue
            targets.append(f)
        return targets

    def _attack(self, attacker: Fighter, kind: str) -> None:
        if not attacker.alive or attacker.invuln_timer > 0:
            return
        base_range = BASIC_RANGE
        base_damage = BASIC_DAMAGE * attacker.damage_scale
        kb = BASIC_KB
        stun = STUN_ON_HIT_SECONDS

        char = attacker.character_id
        if kind == "special":
            if char == "jovan":
                base_range = 88
                base_damage = 9 * attacker.damage_scale
                kb = 110
                stun = 0.28
            elif char == "big_t":
                base_range = 92
                base_damage = 18 * attacker.damage_scale
                kb = 220
                stun = 0.24
            elif char == "simon":
                base_range = 76
                base_damage = 11 * attacker.damage_scale
                kb = 145
                attacker.vx *= 1.15
                attacker.vy *= 1.15
            elif char == "edward":
                attacker.hitbox_scale = max(0.68, attacker.hitbox_scale * 0.88)
                attacker.slow_mult = 1.12
                attacker.slow_timer = 2.6
                self._event_accum.append({"kind": "buff", "user_id": attacker.user_id, "name": "Low Profile"})
                return
            elif char == "griffin":
                base_range = 80
                base_damage = 22 * attacker.damage_scale
                kb = 240
                attacker.slow_mult = 0.88
                attacker.slow_timer = 1.1
            elif char == "hannigan":
                base_range = 110
                base_damage = 15 * attacker.damage_scale
                kb = 180
                stun = 0.26
        elif kind == "ult":
            if attacker.ult_charge < ULT_CHARGE_MAX and attacker.user_id != 0:
                return
            if char == "jovan":
                attacker.ult_buff_timer = 6.0
                attacker.ult_charge = 0.0
                self._event_accum.append({"kind": "buff", "user_id": attacker.user_id, "name": "Lock In"})
                return
            if char == "big_t":
                base_range = 120
                base_damage = 30 * attacker.damage_scale
                kb = 310
            elif char == "simon":
                attacker.ult_buff_timer = 5.0
                attacker.ult_charge = 0.0
                attacker.slow_mult = 1.35
                attacker.slow_timer = 5.0
                self._event_accum.append({"kind": "buff", "user_id": attacker.user_id, "name": "Frame Advantage"})
                return
            elif char == "edward":
                base_range = 95
                base_damage = 20 * attacker.damage_scale
                kb = 210
                attacker.hitbox_scale = 0.7
                attacker.slow_mult = 1.18
                attacker.slow_timer = 3.0
            elif char == "griffin":
                base_range = 130
                base_damage = 34 * attacker.damage_scale
                kb = 330
            elif char == "hannigan":
                base_range = 145
                base_damage = 28 * attacker.damage_scale
                kb = 290
            attacker.ult_charge = 0.0

        if attacker.ult_buff_timer > 0:
            base_damage *= 1.18
            kb *= 1.12

        hit_any = False
        for target in self._enemy_targets(attacker):
            dx = target.x - attacker.x
            dy = target.y - attacker.y
            nx, ny, dist = _norm(dx, dy)
            if dist > (base_range + target.radius()):
                continue
            hit_any = True
            damage = max(1.0, base_damage)
            target.hp -= damage
            kb_scale = max(50.0, kb / max(0.25, target.kb_resist))
            target.vx += nx * kb_scale
            target.vy += ny * kb_scale
            target.stun_timer = max(target.stun_timer, stun)
            target.last_hit_by = attacker.user_id
            attacker.damage_dealt += damage
            self.round_damage[attacker.user_id] = self.round_damage.get(attacker.user_id, 0.0) + damage
            attacker.ult_charge = min(ULT_CHARGE_MAX, attacker.ult_charge + damage * 0.8)

            if kind == "special" and char == "jovan":
                target.slow_timer = max(target.slow_timer, 1.6)
                target.slow_mult = 0.65

            if target.hp <= 0:
                self._ko_fighter(target, attacker.user_id)

            self._event_accum.append({"kind": "hit", "attacker": attacker.user_id, "target": target.user_id, "damage": round(damage, 1)})

        if not hit_any:
            self._event_accum.append({"kind": "whiff", "attacker": attacker.user_id, "move": kind})

    def _handle_action_edges(self, fighter: Fighter, inp: dict) -> None:
        for key in ("dash", "basic", "special", "ult"):
            pressed = bool(inp.get(key))
            was = fighter.hit_latch.get(key, False)
            just_pressed = pressed and not was
            fighter.hit_latch[key] = pressed
            if not just_pressed or not fighter.alive or fighter.stun_timer > 0:
                continue
            if key == "dash" and fighter.dash_cd <= 0:
                fighter.dash_cd = DASH_COOLDOWN_SECONDS
                fighter.dash_timer = DASH_DURATION_SECONDS
                dx = (1 if inp.get("right") else 0) - (1 if inp.get("left") else 0)
                dy = (1 if inp.get("down") else 0) - (1 if inp.get("up") else 0)
                nx, ny, _ = _norm(dx, dy)
                if abs(nx) < 0.01 and abs(ny) < 0.01:
                    nx, ny = 1.0, 0.0
                fighter.vx = nx * DASH_SPEED
                fighter.vy = ny * DASH_SPEED
                self._event_accum.append({"kind": "dash", "user_id": fighter.user_id})
            elif key == "basic" and fighter.basic_cd <= 0:
                fighter.basic_cd = BASIC_COOLDOWN_SECONDS
                self._attack(fighter, "basic")
            elif key == "special" and fighter.special_cd <= 0:
                fighter.special_cd = SPECIAL_COOLDOWN_SECONDS
                self._attack(fighter, "special")
            elif key == "ult" and fighter.ult_cd <= 0 and (fighter.ult_charge >= ULT_CHARGE_MAX or fighter.user_id == 0):
                fighter.ult_cd = ULT_COOLDOWN_SECONDS
                self._attack(fighter, "ult")

    def _spawn_coin(self) -> None:
        if len(self.coins) >= COIN_MAX_ACTIVE:
            return
        self.coin_seq += 1
        self.coins.append(
            {
                "id": self.coin_seq,
                "x": round(self._rng.uniform(70, self.width - 70), 2),
                "y": round(self._rng.uniform(70, self.height - 70), 2),
                "v": int(self._rng.randint(COIN_SPAWN_VALUE_MIN, COIN_SPAWN_VALUE_MAX)),
            }
        )
        self._event_accum.append({"kind": "coin_spawn", "coin_id": self.coin_seq})

    def _collect_coins(self) -> None:
        if not self.coins:
            return
        remaining = []
        for coin in self.coins:
            picked = False
            for uid in self.players:
                fighter = self.fighters.get(uid)
                if not fighter or not fighter.alive:
                    continue
                dx = fighter.x - float(coin["x"])
                dy = fighter.y - float(coin["y"])
                if math.hypot(dx, dy) > (fighter.radius() + 10):
                    continue
                picked = True
                room_left = max(0, COIN_MATCH_REWARD_CAP - fighter.match_cc)
                gain = min(room_left, int(coin["v"]))
                if gain > 0:
                    fighter.round_cc += gain
                    fighter.match_cc += gain
                    self._event_accum.append(
                        {
                            "kind": "coin_pickup",
                            "user_id": uid,
                            "coin_id": coin["id"],
                            "gain": gain,
                            "round_cc": fighter.round_cc,
                            "match_cc": fighter.match_cc,
                        }
                    )
                break
            if not picked:
                remaining.append(coin)
        self.coins = remaining

    def _tick_fighter(self, fighter: Fighter, dt: float, inp: dict) -> None:
        if fighter.respawn_timer > 0:
            fighter.respawn_timer = max(0.0, fighter.respawn_timer - dt)
            if fighter.respawn_timer <= 0:
                fighter.hp = fighter.max_hp
                self._respawn_fighter(fighter, full_heal=True)
            return

        fighter.invuln_timer = max(0.0, fighter.invuln_timer - dt)
        fighter.last_input_seq = int(inp.get("seq", fighter.last_input_seq))
        fighter.dash_cd = max(0.0, fighter.dash_cd - dt)
        fighter.basic_cd = max(0.0, fighter.basic_cd - dt)
        fighter.special_cd = max(0.0, fighter.special_cd - dt)
        fighter.ult_cd = max(0.0, fighter.ult_cd - dt)
        fighter.stun_timer = max(0.0, fighter.stun_timer - dt)
        fighter.ult_buff_timer = max(0.0, fighter.ult_buff_timer - dt)
        fighter.slow_timer = max(0.0, fighter.slow_timer - dt)

        if fighter.slow_timer <= 0:
            fighter.slow_mult = 1.0
            self._apply_character_stats(fighter, fighter.character_id)
            fighter.hp = min(fighter.hp, fighter.max_hp)

        if not fighter.alive:
            return

        self._handle_action_edges(fighter, inp)

        if fighter.stun_timer > 0:
            fighter.vx *= 0.90
            fighter.vy *= 0.90
        elif fighter.dash_timer > 0:
            fighter.dash_timer = max(0.0, fighter.dash_timer - dt)
            fighter.vx *= 0.96
            fighter.vy *= 0.96
        else:
            dx = (1 if inp.get("right") else 0) - (1 if inp.get("left") else 0)
            dy = (1 if inp.get("down") else 0) - (1 if inp.get("up") else 0)
            nx, ny, _ = _norm(dx, dy)
            speed = fighter.move_speed * fighter.slow_mult
            if fighter.ult_buff_timer > 0:
                speed *= 1.18
            fighter.vx = nx * speed
            fighter.vy = ny * speed

        fighter.x += fighter.vx * dt
        fighter.y += fighter.vy * dt
        fighter.ult_charge = min(ULT_CHARGE_MAX, fighter.ult_charge + dt * 2.2)

        if fighter.x < -OUT_OF_BOUNDS_MARGIN or fighter.x > self.width + OUT_OF_BOUNDS_MARGIN or fighter.y < -OUT_OF_BOUNDS_MARGIN or fighter.y > self.height + OUT_OF_BOUNDS_MARGIN:
            self._ko_fighter(fighter, fighter.last_hit_by)
            return

        fighter.x = clamp(fighter.x, -OUT_OF_BOUNDS_MARGIN + 1, self.width + OUT_OF_BOUNDS_MARGIN - 1)
        fighter.y = clamp(fighter.y, -OUT_OF_BOUNDS_MARGIN + 1, self.height + OUT_OF_BOUNDS_MARGIN - 1)
    def _round_score_rows(self) -> List[dict]:
        rows = []
        for uid in self.players:
            f = self.fighters.get(uid)
            if not f:
                continue
            rows.append(
                {
                    "user_id": uid,
                    "display_name": f.display_name,
                    "team": f.team,
                    "round_wins": f.round_wins,
                    "round_kos": self.round_kos.get(uid, 0),
                    "match_kos": f.score_kos,
                    "deaths": f.score_deaths,
                    "round_cc": f.round_cc,
                    "match_cc": f.match_cc,
                }
            )
        rows.sort(key=lambda r: (-r["round_wins"], -r["match_kos"], r["deaths"], r["display_name"]))
        return rows

    def _round_winners(self) -> Set[int]:
        if not self.players:
            return set()
        if self.mode_name == "boss":
            boss_alive = bool(self.boss_fighter and self.boss_fighter.alive)
            return {0} if boss_alive else {uid for uid in self.players if uid in self.fighters}
        if self.mode_name == "teams":
            team_kos: Dict[int, int] = {}
            for uid in self.players:
                f = self.fighters.get(uid)
                if not f:
                    continue
                team_kos[f.team] = team_kos.get(f.team, 0) + self.round_kos.get(uid, 0)
            if not team_kos:
                return set()
            top = max(team_kos.values())
            winners = {team for team, score in team_kos.items() if score == top}
            if len(winners) != 1:
                return set()
            team = next(iter(winners))
            return {uid for uid in self.players if uid in self.fighters and self.fighters[uid].team == team}

        max_score = max((self.round_kos.get(uid, 0) for uid in self.players), default=0)
        leaders = [uid for uid in self.players if self.round_kos.get(uid, 0) == max_score]
        if len(leaders) != 1:
            return set()
        return {leaders[0]}

    def _match_winners(self) -> Set[int]:
        if not self.players:
            return set()
        if self.mode_name == "teams":
            teams: Dict[int, int] = {}
            for uid in self.players:
                f = self.fighters.get(uid)
                if not f:
                    continue
                teams[f.team] = max(teams.get(f.team, 0), f.round_wins)
            if not teams:
                return set()
            top = max(teams.values())
            winners = [team for team, val in teams.items() if val == top]
            if len(winners) != 1:
                return set()
            team = winners[0]
            return {uid for uid in self.players if uid in self.fighters and self.fighters[uid].team == team}

        top = max((self.fighters[uid].round_wins for uid in self.players if uid in self.fighters), default=0)
        leaders = [uid for uid in self.players if uid in self.fighters and self.fighters[uid].round_wins == top]
        if len(leaders) != 1:
            return set()
        return {leaders[0]}

    def _round_should_end(self) -> Optional[str]:
        if self.mode_name == "practice":
            return None

        if self.mode_name == "boss":
            if self.boss_fighter and not self.boss_fighter.alive:
                return "boss_down"
            if self.round_time_left <= 0:
                return "time"
            return None

        if self.round_time_left <= 0:
            return "time"

        if self.mode_name == "teams":
            team_kos: Dict[int, int] = {}
            for uid in self.players:
                f = self.fighters.get(uid)
                if not f:
                    continue
                team_kos[f.team] = team_kos.get(f.team, 0) + self.round_kos.get(uid, 0)
            if team_kos and max(team_kos.values()) >= self.round_ko_target:
                return "ko_target"
            return None

        if max((self.round_kos.get(uid, 0) for uid in self.players), default=0) >= self.round_ko_target:
            return "ko_target"
        return None

    def _maybe_finish_match(self) -> bool:
        if self.mode_name == "practice":
            return False
        for uid in self.players:
            f = self.fighters.get(uid)
            if f and f.round_wins >= self.wins_required:
                self.finish_match("wins_required")
                return True
        if self.round_index >= self.best_of:
            self.finish_match("best_of_complete")
            return True
        return False

    def tick(self, dt: float) -> None:
        self.tick_seq += 1
        self._event_accum = []

        if self.state == "lobby":
            if len(self.players) >= self._min_players():
                self._enter_character_select()
        elif self.state == "character_select":
            everyone_ready = bool(self.players) and all(uid in self.ready for uid in self.players)
            self.character_select_left = max(0.0, self.character_select_left - dt)
            if everyone_ready or self.character_select_left <= 0:
                self._enter_round_start()
        elif self.state == "round_start":
            self.round_start_left = max(0.0, self.round_start_left - dt)
            if self.round_start_left <= 0:
                self._enter_in_round()
        elif self.state == "in_round":
            self.round_time_left = max(0.0, self.round_time_left - dt)

            ai_input = None
            if self.boss_fighter and self.boss_ai and self.boss_fighter.alive:
                ai_input = self.boss_ai.pick_inputs(self.boss_fighter, [self.fighters[uid] for uid in self.players if uid in self.fighters], dt)

            everyone: List[Fighter] = [self.fighters[uid] for uid in self.players if uid in self.fighters]
            if self.boss_fighter:
                everyone.append(self.boss_fighter)

            for fighter in everyone:
                inp = ai_input if fighter.user_id == 0 and ai_input is not None else self.inputs.get(fighter.user_id, {})
                self._tick_fighter(fighter, dt, inp)

            self.coin_spawn_accum += dt
            if self.coin_spawn_accum >= COIN_SPAWN_INTERVAL_SECONDS:
                self.coin_spawn_accum = 0.0
                self._spawn_coin()
            self._collect_coins()

            reason = self._round_should_end()
            if reason:
                self._finish_round(reason)
        elif self.state == "round_end":
            self.round_end_left = max(0.0, self.round_end_left - dt)
            if self.round_end_left <= 0:
                if not self._maybe_finish_match():
                    self._enter_round_start()

        self._snapshot_accum += dt
        if self._snapshot_accum >= 1 / ARENA_SNAPSHOT_RATE:
            self._snapshot_accum = 0.0
            self.outbox.append(self.snapshot())

    def _scoreboard(self) -> List[dict]:
        rows = []
        for uid in self.players:
            f = self.fighters.get(uid)
            if not f:
                continue
            rows.append(
                {
                    "user_id": uid,
                    "username": f.username,
                    "display_name": f.display_name,
                    "team": f.team,
                    "round_wins": f.round_wins,
                    "kos": f.score_kos,
                    "deaths": f.score_deaths,
                    "damage": round(f.damage_dealt, 1),
                    "character_id": f.character_id,
                    "cc_earned": f.match_cc,
                }
            )
        rows.sort(key=lambda r: (-r["round_wins"], -r["kos"], r["deaths"], r["display_name"]))
        return rows

    def _apply_stats_results(self) -> None:
        if self.mode_name == "practice" or not self.players:
            return
        winners = self._match_winners()

        payload = []
        for uid in self.players:
            fighter = self.fighters.get(uid)
            if not fighter:
                continue
            win = uid in winners
            perf_bonus = max(0, fighter.score_kos * 2 - fighter.score_deaths)
            if win:
                perf_bonus += 12
            cc_total = min(COIN_MATCH_REWARD_CAP, fighter.match_cc + perf_bonus)
            payload.append(
                {
                    "user_id": uid,
                    "win": win,
                    "kos": int(fighter.score_kos),
                    "deaths": int(fighter.score_deaths),
                    "damage": float(fighter.damage_dealt),
                    "cc_earned": int(cc_total),
                }
            )

        summary: Dict[int, dict] = {}
        if hasattr(self.db, "apply_arena_match_results"):
            summary = self.db.apply_arena_match_results(payload)
        else:
            for row in payload:
                stats = self.db.apply_match_result(row["user_id"], win=row["win"], kos_delta=row["kos"], deaths_delta=row["deaths"])
                summary[int(row["user_id"])] = {
                    "cc_credited": int(row["cc_earned"]),
                    "cortisol_after": int(stats.get("cortisol", 0)),
                }

        self.last_result_summary = summary

    def finish_match(self, reason: str) -> None:
        if self.state == "match_end":
            return
        self.state = "match_end"
        self.ended = True
        if not self._results_applied:
            self._apply_stats_results()
            self._results_applied = True
        winners = sorted(self._match_winners())
        scoreboard = self._scoreboard()
        for row in scoreboard:
            result = self.last_result_summary.get(int(row["user_id"]), {})
            row["cortisol_delta"] = int(result.get("cortisol_delta", 0))
            row["cortisol_after"] = result.get("cortisol_after")
            row["cc_credited"] = int(result.get("cc_credited", row.get("cc_earned", 0)))
        self.outbox.append(
            {
                "type": "arena_end",
                "room_id": self.room_id,
                "reason": reason,
                "winners": winners,
                "scoreboard": scoreboard,
                "mode_name": self.mode_name,
                "best_of": self.best_of,
                "wins_required": self.wins_required,
            }
        )

    def snapshot(self) -> dict:
        fighters_public = {uid: self.fighters[uid].to_public() for uid in self.players if uid in self.fighters}
        boss = self.boss_fighter.to_public() if self.boss_fighter else None
        return {
            "type": "arena_state",
            "room_id": self.room_id,
            "mode_name": self.mode_name,
            "state": self.state,
            "tick": self.tick_seq,
            "round": self.round_index,
            "best_of": self.best_of,
            "wins_required": self.wins_required,
            "round_ko_target": self.round_ko_target,
            "time_left": round(self.round_time_left, 2),
            "character_select_left": round(self.character_select_left, 2),
            "round_start_left": round(self.round_start_left, 2),
            "round_end_left": round(self.round_end_left, 2),
            "players": self.players,
            "spectators": list(self.spectators),
            "ready": list(self.ready),
            "fighters": fighters_public,
            "boss": boss,
            "coins": self.coins,
            "round_kos": self.round_kos,
            "events": self._event_accum[-20:],
            "arena": {"w": self.width, "h": self.height},
        }

    def drain_outbox(self) -> List[dict]:
        out, self.outbox = self.outbox, []
        return out
