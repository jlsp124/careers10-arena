from __future__ import annotations

import json
import math
import random
from pathlib import Path
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
    DASH_COOLDOWN_SECONDS,
    DASH_DURATION_SECONDS,
    DASH_SPEED,
    DEFAULT_MATCH_SECONDS,
    RESPAWN_SECONDS,
    SPECIAL_COOLDOWN_SECONDS,
    STUN_ON_HIT_SECONDS,
    TEAM_COLORS,
    ULT_CHARGE_MAX,
    ULT_COOLDOWN_SECONDS,
)
from game.entities import Fighter
from util import WEB_ROOT, clamp


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
            return {c["id"]: c for c in data if isinstance(c, dict) and c.get("id")}
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

    def __init__(self, room_id: str, db, mode_name: str = "ffa", match_seconds: int = DEFAULT_MATCH_SECONDS):
        self.room_id = room_id
        self.db = db
        self.mode_name = mode_name
        self.width = ARENA_WIDTH
        self.height = ARENA_HEIGHT
        self.members: Set[int] = set()
        self.players: List[int] = []
        self.spectators: Set[int] = set()
        self.ready: Set[int] = set()
        self.fighters: Dict[int, Fighter] = {}
        self.inputs: Dict[int, dict] = {}
        self.outbox: List[dict] = []
        self.state = "waiting"
        self.match_seconds = int(clamp(match_seconds, 60, 120))
        self.time_left = float(self.match_seconds)
        self.target_kos = self._default_target_kos()
        self.tick_seq = 0
        self._snapshot_accum = 0.0
        self._event_accum: List[dict] = []
        self.boss_fighter: Optional[Fighter] = None
        self.boss_ai: Optional[HanniganBossAI] = None
        self._rng = random.Random()
        self.ended = False
        self._results_applied = False

    def _max_players(self) -> int:
        return {
            "duel": 2,
            "teams": 4,
            "ffa": 6,
            "boss": 6,
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

    def _default_target_kos(self) -> int:
        return {
            "duel": 5,
            "teams": 7,
            "ffa": 6,
            "boss": 10,
            "practice": 999,
        }.get(self.mode_name, 6)

    def join(self, user: dict) -> dict:
        user_id = int(user["id"])
        self.members.add(user_id)
        if user_id not in self.players and user_id not in self.spectators:
            if len(self.players) < self._max_players():
                self.players.append(user_id)
                self._spawn_or_create_fighter(user)
            else:
                self.spectators.add(user_id)
        self._assign_teams()
        self.outbox.append(self.roster_message())
        return {"state": self.state, "mode_name": self.mode_name}

    def leave(self, user_id: int) -> None:
        self.members.discard(user_id)
        self.ready.discard(user_id)
        self.spectators.discard(user_id)
        self.inputs.pop(user_id, None)
        self.fighters.pop(user_id, None)
        if user_id in self.players:
            self.players.remove(user_id)
            self._assign_teams()
            if self.state == "running" and self.mode_name != "practice":
                if len(self.players) < self._min_players():
                    self.finish_match("not_enough_players")
        self.outbox.append(self.roster_message())

    def _spawn_or_create_fighter(self, user: dict) -> Fighter:
        user_id = int(user["id"])
        if user_id in self.fighters:
            fighter = self.fighters[user_id]
        else:
            default_char = next(iter(CHARACTERS.keys()))
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
            if user_id in self.fighters:
                fighter = self.fighters[user_id]
                fighter.team = _team_for(self.mode_name, idx)
                if self.mode_name == "teams":
                    fighter.color = TEAM_COLORS[fighter.team % len(TEAM_COLORS)]
                else:
                    c = CHARACTERS.get(fighter.character_id, {})
                    fighter.color = c.get("color", TEAM_COLORS[idx % len(TEAM_COLORS)])

    def _apply_character_stats(self, fighter: Fighter, char_id: str) -> None:
        char = CHARACTERS.get(char_id) or next(iter(CHARACTERS.values()))
        fighter.character_id = char["id"]
        stats = char.get("stats", {})
        fighter.max_hp = float(stats.get("hp", 100))
        fighter.hp = min(fighter.hp or fighter.max_hp, fighter.max_hp)
        fighter.move_speed = float(stats.get("speed", 180))
        fighter.damage_scale = float(stats.get("damage", 1.0))
        fighter.kb_resist = float(stats.get("knockback_resist", 1.0))
        fighter.hitbox_scale = float(stats.get("hitbox_scale", 1.0))
        fighter.color = char.get("color", fighter.color)

    def roster_message(self) -> dict:
        return {
            "type": "arena_roster",
            "room_id": self.room_id,
            "mode_name": self.mode_name,
            "state": self.state,
            "players": self.players,
            "spectators": list(self.spectators),
            "ready": list(self.ready),
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
            if user_id in self.fighters and char_id in CHARACTERS and self.state != "running":
                self._apply_character_stats(self.fighters[user_id], char_id)
                self.outbox.append(self.roster_message())
        elif t == "arena_ready":
            if user_id in self.players:
                if bool(msg.get("ready", True)):
                    self.ready.add(user_id)
                else:
                    self.ready.discard(user_id)
                self.outbox.append(self.roster_message())
        elif t == "arena_input":
            if user_id in self.players:
                self.inputs[user_id] = {
                    "seq": int(msg.get("seq", 0)),
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
            if self.state in {"waiting", "ended"}:
                self._try_start(force=True)
        elif t == "arena_restart" and self.state == "ended":
            self._reset_match(preserve_scores=False)
            self.state = "waiting"
            self.ended = False
            self._results_applied = False
            self.ready = set([uid for uid in self.players]) if self.mode_name == "practice" else set()
            self.outbox.append(self.roster_message())

    def _try_start(self, force: bool = False) -> None:
        if self.state == "running":
            return
        enough = len(self.players) >= self._min_players()
        ready_ok = self.mode_name == "practice" or (len(self.players) > 0 and all(uid in self.ready for uid in self.players))
        if force:
            ready_ok = True
        if enough and ready_ok:
            self._reset_match(preserve_scores=False)
            self.state = "running"
            self.ended = False
            self._results_applied = False
            self.time_left = float(self.match_seconds)
            if self.mode_name == "boss":
                self._spawn_boss()
            else:
                self.boss_fighter = None
                self.boss_ai = None
            self.outbox.append({"type": "arena_start", "room_id": self.room_id, "mode_name": self.mode_name, "time_left": self.time_left})

    def _spawn_boss(self) -> None:
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

    def _reset_match(self, preserve_scores: bool) -> None:
        self.tick_seq = 0
        self._snapshot_accum = 0.0
        self._event_accum = []
        for uid in self.players:
            fighter = self.fighters.get(uid)
            if not fighter:
                continue
            if not preserve_scores:
                fighter.score_kos = 0
                fighter.score_deaths = 0
            fighter.ult_charge = 0.0
            fighter.ult_buff_timer = 0.0
            fighter.slow_timer = 0.0
            fighter.slow_mult = 1.0
            fighter.dash_cd = fighter.basic_cd = fighter.special_cd = fighter.ult_cd = 0.0
            self._respawn_fighter(fighter, full_heal=True)
        self.boss_fighter = None
        self.boss_ai = None

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
            killer.ult_charge = min(ULT_CHARGE_MAX, killer.ult_charge + 20)
        self._event_accum.append({"kind": "ko", "victim": victim.user_id, "killer": killer_id})
        if self.mode_name == "boss" and victim.user_id == 0:
            self.finish_match("boss_down")

    def _enemy_targets(self, attacker: Fighter) -> List[Fighter]:
        humans = [self.fighters[uid] for uid in self.players if uid in self.fighters]
        targets: List[Fighter] = []
        for f in humans + ([self.boss_fighter] if self.boss_fighter else []):
            if not f or f.user_id == attacker.user_id or not f.alive:
                continue
            if self.mode_name == "teams" and attacker.user_id != 0 and f.user_id != 0:
                if attacker.team == f.team:
                    continue
            if self.mode_name == "boss":
                if attacker.user_id == 0:
                    if f.user_id == 0:
                        continue
                else:
                    if f.user_id != 0:
                        continue
            targets.append(f)
        return targets

    def _attack(self, attacker: Fighter, kind: str) -> None:
        if not attacker.alive:
            return
        base_range = BASIC_RANGE
        base_damage = BASIC_DAMAGE * attacker.damage_scale
        kb = BASIC_KB
        stun = STUN_ON_HIT_SECONDS

        # Character flavor / move tuning
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
            elif char == "big_t":
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
            attacker.ult_charge = min(ULT_CHARGE_MAX, attacker.ult_charge + damage * 0.8)

            # Jovan special also slows/soft disables
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

    def tick(self, dt: float) -> None:
        self.tick_seq += 1
        if self.state in {"waiting", "ended"}:
            if self.state == "waiting":
                self._try_start(force=False)
            self._snapshot_accum += dt
            if self._snapshot_accum >= 1 / ARENA_SNAPSHOT_RATE:
                self._snapshot_accum = 0.0
                self.outbox.append(self.snapshot())
            return

        self.time_left = max(0.0, self.time_left - dt)
        self._event_accum = []

        # Boss AI input
        if self.boss_fighter and self.boss_ai and self.boss_fighter.alive:
            ai_input = self.boss_ai.pick_inputs(self.boss_fighter, [self.fighters[uid] for uid in self.players if uid in self.fighters], dt)
        else:
            ai_input = None

        # Update timers and movement
        everyone: List[Fighter] = [self.fighters[uid] for uid in self.players if uid in self.fighters]
        if self.boss_fighter:
            everyone.append(self.boss_fighter)

        for fighter in everyone:
            if fighter.respawn_timer > 0:
                fighter.respawn_timer = max(0.0, fighter.respawn_timer - dt)
                if fighter.respawn_timer <= 0:
                    fighter.hp = fighter.max_hp
                    self._respawn_fighter(fighter, full_heal=True)
                continue
            fighter.last_input_seq = int(self.inputs.get(fighter.user_id, {}).get("seq", fighter.last_input_seq))
            fighter.dash_cd = max(0.0, fighter.dash_cd - dt)
            fighter.basic_cd = max(0.0, fighter.basic_cd - dt)
            fighter.special_cd = max(0.0, fighter.special_cd - dt)
            fighter.ult_cd = max(0.0, fighter.ult_cd - dt)
            fighter.stun_timer = max(0.0, fighter.stun_timer - dt)
            fighter.ult_buff_timer = max(0.0, fighter.ult_buff_timer - dt)
            fighter.slow_timer = max(0.0, fighter.slow_timer - dt)
            if fighter.slow_timer <= 0:
                fighter.slow_mult = 1.0
                # restore character hitbox baseline after Edward buffs expire
                self._apply_character_stats(fighter, fighter.character_id)
                fighter.hp = min(fighter.hp, fighter.max_hp)
            if not fighter.alive:
                continue

            inp = ai_input if fighter.user_id == 0 and ai_input is not None else self.inputs.get(fighter.user_id, {})
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

            fighter.x = clamp(fighter.x + fighter.vx * dt, 18, self.width - 18)
            fighter.y = clamp(fighter.y + fighter.vy * dt, 18, self.height - 18)
            fighter.ult_charge = min(ULT_CHARGE_MAX, fighter.ult_charge + dt * 2.2)

        # Win conditions
        if self.mode_name != "practice":
            if self.mode_name == "boss" and self.boss_fighter and self.boss_fighter.alive:
                if self.time_left <= 0:
                    self.finish_match("time")
            else:
                if self._highest_score() >= self.target_kos or self.time_left <= 0:
                    self.finish_match("score_or_time")

        self._snapshot_accum += dt
        if self._snapshot_accum >= 1 / ARENA_SNAPSHOT_RATE:
            self._snapshot_accum = 0.0
            self.outbox.append(self.snapshot())

    def _highest_score(self) -> int:
        if not self.players:
            return 0
        if self.mode_name == "teams":
            return max(self._team_scores().values()) if self._team_scores() else 0
        return max((self.fighters[uid].score_kos for uid in self.players if uid in self.fighters), default=0)

    def _team_scores(self) -> Dict[int, int]:
        scores: Dict[int, int] = {}
        for uid in self.players:
            f = self.fighters.get(uid)
            if not f:
                continue
            scores[f.team] = scores.get(f.team, 0) + f.score_kos
        return scores

    def finish_match(self, reason: str) -> None:
        if self.state == "ended":
            return
        self.state = "ended"
        self.ended = True
        if not self._results_applied:
            self._apply_stats_results()
            self._results_applied = True
        self.outbox.append({"type": "arena_end", "room_id": self.room_id, "reason": reason, "scoreboard": self._scoreboard()})

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
                    "kos": f.score_kos,
                    "deaths": f.score_deaths,
                    "character_id": f.character_id,
                }
            )
        if self.mode_name == "teams":
            rows.sort(key=lambda r: (-(self._team_scores().get(r["team"], 0)), -r["kos"], r["username"]))
        else:
            rows.sort(key=lambda r: (-r["kos"], r["deaths"], r["username"]))
        return rows

    def _apply_stats_results(self) -> None:
        if self.mode_name == "practice":
            return
        if not self.players:
            return
        if self.mode_name == "boss":
            players_alive = [self.fighters[uid] for uid in self.players if uid in self.fighters]
            humans_win = bool(self.boss_fighter) and not self.boss_fighter.alive
            if humans_win:
                for f in players_alive:
                    self.db.apply_match_result(f.user_id, win=True, kos_delta=f.score_kos, deaths_delta=f.score_deaths)
            else:
                for f in players_alive:
                    self.db.apply_match_result(f.user_id, win=False, kos_delta=f.score_kos, deaths_delta=f.score_deaths)
            return

        winners: Set[int] = set()
        if self.mode_name == "teams":
            team_scores = self._team_scores()
            if team_scores:
                best_team = max(team_scores, key=lambda t: team_scores[t])
                tied = [t for t, s in team_scores.items() if s == team_scores[best_team]]
                if len(tied) == 1:
                    for uid in self.players:
                        f = self.fighters.get(uid)
                        if f and f.team == best_team:
                            winners.add(uid)
        else:
            max_k = max((self.fighters[uid].score_kos for uid in self.players if uid in self.fighters), default=0)
            leaders = [uid for uid in self.players if uid in self.fighters and self.fighters[uid].score_kos == max_k]
            if len(leaders) == 1:
                winners.add(leaders[0])

        for uid in self.players:
            f = self.fighters.get(uid)
            if not f:
                continue
            if not winners:
                continue  # tie: no cortisol changes
            self.db.apply_match_result(uid, win=(uid in winners), kos_delta=f.score_kos, deaths_delta=f.score_deaths)

    def snapshot(self) -> dict:
        fighters_public = {uid: self.fighters[uid].to_public() for uid in self.players if uid in self.fighters}
        boss = self.boss_fighter.to_public() if self.boss_fighter else None
        return {
            "type": "arena_state",
            "room_id": self.room_id,
            "mode_name": self.mode_name,
            "state": self.state,
            "tick": self.tick_seq,
            "time_left": round(self.time_left, 2),
            "target_kos": self.target_kos,
            "players": self.players,
            "spectators": list(self.spectators),
            "ready": list(self.ready),
            "fighters": fighters_public,
            "boss": boss,
            "team_scores": self._team_scores() if self.mode_name == "teams" else None,
            "events": self._event_accum[-20:],
            "arena": {"w": self.width, "h": self.height},
        }

    def drain_outbox(self) -> List[dict]:
        out, self.outbox = self.outbox, []
        return out

