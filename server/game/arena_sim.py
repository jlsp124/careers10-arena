from __future__ import annotations

import json
import math
import random
from typing import Dict, List, Optional, Set

from game.arena_defs import CHARACTERS, DEFAULT_STAGE_ID, MOVE_LIBRARY, STAGES
from game.constants import (
    AIR_ACCEL,
    AIR_DRAG,
    ARENA_HEIGHT,
    ARENA_SNAPSHOT_RATE,
    ARENA_WIDTH,
    BASIC_COOLDOWN_SECONDS,
    CHARACTER_SELECT_SECONDS,
    COIN_MATCH_REWARD_CAP,
    COYOTE_TIME_SECONDS,
    DASH_COOLDOWN_SECONDS,
    DASH_DURATION_SECONDS,
    DASH_SPEED,
    DEFAULT_BEST_OF,
    DEFAULT_MATCH_SECONDS,
    DEFAULT_ROUND_KO_TARGET,
    DEFAULT_ROUND_SECONDS,
    DEFAULT_STOCKS,
    FAST_FALL_GRAVITY,
    GRAVITY,
    GROUND_ACCEL,
    GROUND_DRAG,
    GROUND_TURN_BOOST,
    JUMP_BUFFER_SECONDS,
    LANDING_LAG_SECONDS,
    LOADING_SECONDS,
    MAX_FALL_SPEED,
    PRACTICE_BOT_NAME,
    PRACTICE_BOT_USER_ID,
    PRACTICE_BOT_USERNAME,
    RESPAWN_INVULN_SECONDS,
    RESPAWN_SECONDS,
    ROUND_INTERMISSION_SECONDS,
    ROUND_START_COUNTDOWN_SECONDS,
    SPECIAL_COOLDOWN_SECONDS,
    TEAM_COLORS,
    ULT_CHARGE_MAX,
    ULT_COOLDOWN_SECONDS,
)
from game.entities import Fighter
from util import clamp


def _norm(dx: float, dy: float) -> tuple[float, float, float]:
    dist = math.hypot(dx, dy)
    if dist <= 0.0001:
        return 0.0, 0.0, 0.0001
    return dx / dist, dy / dist, dist


def _copy_stage(stage_id: str) -> dict:
    stage = STAGES.get(stage_id) or STAGES[DEFAULT_STAGE_ID]
    return json.loads(json.dumps(stage))


def _team_for(mode: str, idx: int) -> int:
    return idx % 2 if mode == "teams" else idx


class SparringBotAI:
    def __init__(self, rng: random.Random):
        self._rng = rng
        self._jump_cd = 0.0
        self._attack_cd = 0.0

    def pick_inputs(self, room: "ArenaRoom", fighter: Fighter, dt: float) -> dict:
        self._jump_cd = max(0.0, self._jump_cd - dt)
        self._attack_cd = max(0.0, self._attack_cd - dt)
        targets = [room.fighters[uid] for uid in room.players if uid > 0 and uid in room.fighters and room.fighters[uid].stocks > 0]
        if not targets:
            return {"up": False, "down": False, "left": False, "right": False, "dash": False, "basic": False, "special": False, "ult": False}
        target = min(targets, key=lambda item: ((item.x - fighter.x) ** 2) + ((item.y - fighter.y) ** 2))
        dx = target.x - fighter.x
        dy = target.y - fighter.y
        out = {"up": False, "down": False, "left": False, "right": False, "dash": False, "basic": False, "special": False, "ult": False}
        if dx < -18:
            out["left"] = True
        elif dx > 18:
            out["right"] = True
        if fighter.grounded and fighter.y - target.y > 90 and self._jump_cd <= 0:
            out["up"] = True
            self._jump_cd = 0.32
        elif not fighter.grounded and dy > 120:
            out["down"] = True
        if fighter.grounded and abs(dx) > 300 and fighter.dash_cd <= 0 and self._rng.random() < 0.03:
            out["dash"] = True
        if self._attack_cd <= 0 and abs(dx) < 110 and abs(dy) < 96:
            out["basic"] = True
            self._attack_cd = 0.24
        elif self._attack_cd <= 0 and abs(dx) < 170 and abs(dy) < 130 and self._rng.random() < 0.12:
            out["special"] = True
            self._attack_cd = 0.46
        elif fighter.ult_charge >= ULT_CHARGE_MAX and abs(dx) < 188 and abs(dy) < 140 and self._rng.random() < 0.08:
            out["ult"] = True
            self._attack_cd = 0.60
        return out


class ArenaRoom:
    mode = "arena"

    def __init__(self, room_id: str, db, mode_name: str = "duel", match_seconds: int = DEFAULT_MATCH_SECONDS, best_of: int = DEFAULT_BEST_OF, round_seconds: int = DEFAULT_ROUND_SECONDS, round_ko_target: Optional[int] = None, stage_id: Optional[str] = None):
        self.room_id = room_id
        self.db = db
        self.mode_name = mode_name if mode_name in {"duel", "teams", "ffa", "practice"} else "duel"
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
        safe_best = int(clamp(best_of, 1, 7))
        self.best_of = safe_best if safe_best % 2 == 1 else safe_best + 1
        self.wins_required = self.best_of // 2 + 1
        self.match_seconds = int(clamp(match_seconds, 60, 240))
        self.round_seconds = int(clamp(round_seconds, 45, 150))
        self.round_ko_target = int(clamp(round_ko_target or DEFAULT_ROUND_KO_TARGET, 1, 5))
        self.stocks_per_round = int(clamp(round_ko_target or DEFAULT_STOCKS, 1, 5))
        self.round_index = 0
        self.character_select_left = 0.0
        self.loading_left = 0.0
        self.round_start_left = 0.0
        self.round_time_left = float(self.round_seconds)
        self.round_end_left = 0.0
        self.time_left = self.round_time_left
        self.tick_seq = 0
        self._snapshot_accum = 0.0
        self._event_accum: List[dict] = []
        self._rng = random.Random(f"{room_id}:{mode_name}")
        self.round_kos: Dict[int, int] = {}
        self.round_damage: Dict[int, float] = {}
        self.selected_stage_id = stage_id if stage_id in STAGES else None
        self.stage = _copy_stage(self.selected_stage_id or DEFAULT_STAGE_ID)
        self.coins: List[dict] = []
        self.bot_ai = SparringBotAI(self._rng)
        self.ended = False
        self._results_applied = False
        self.last_result_summary: Dict[int, dict] = {}

    def _human_players(self) -> List[int]:
        return [uid for uid in self.players if uid > 0]

    def _player_ids_for_match(self) -> List[int]:
        return [uid for uid in self.players if uid in self.fighters]

    def _max_players(self) -> int:
        return {"duel": 2, "teams": 4, "ffa": 4, "practice": 1}.get(self.mode_name, 2)

    def _min_players(self) -> int:
        return {"duel": 2, "teams": 4, "ffa": 2, "practice": 1}.get(self.mode_name, 1)

    def _default_char(self) -> str:
        return next(iter(CHARACTERS.keys()))

    def _pick_stage_id(self) -> str:
        if self.selected_stage_id in STAGES:
            return self.selected_stage_id
        ids = list(STAGES.keys())
        return ids[self._rng.randrange(len(ids))] if ids else DEFAULT_STAGE_ID

    def _apply_stage(self, stage_id: Optional[str] = None) -> None:
        if stage_id and stage_id in STAGES:
            self.selected_stage_id = stage_id
        elif self.selected_stage_id not in STAGES:
            self.selected_stage_id = self._pick_stage_id()
        self.stage = _copy_stage(self.selected_stage_id or DEFAULT_STAGE_ID)
        self.width = int(self.stage.get("arena", {}).get("w", ARENA_WIDTH))
        self.height = int(self.stage.get("arena", {}).get("h", ARENA_HEIGHT))

    def join(self, user: dict) -> dict:
        user_id = int(user["id"])
        self.members.add(user_id)
        if user_id not in self.players and user_id not in self.spectators:
            if len(self._human_players()) < self._max_players() and self.state != "match_end":
                self.players.append(user_id)
                self._spawn_or_create_fighter(user)
                if self.mode_name == "practice":
                    self._ensure_practice_bot()
            else:
                self.spectators.add(user_id)
        self._assign_teams()
        if self.state == "lobby" and len(self._human_players()) >= self._min_players():
            self._enter_character_select()
        self.outbox.append(self.roster_message())
        return {"state": self.state, "mode_name": self.mode_name, "stage_id": self.selected_stage_id}

    def leave(self, user_id: int) -> None:
        self.members.discard(user_id)
        self.ready.discard(user_id)
        self.spectators.discard(user_id)
        self.inputs.pop(user_id, None)
        self.round_kos.pop(user_id, None)
        self.round_damage.pop(user_id, None)
        self.fighters.pop(user_id, None)
        if user_id in self.players:
            self.players.remove(user_id)
        if self.mode_name == "practice" and not self._human_players():
            self.players = [uid for uid in self.players if uid > 0]
            self.fighters.pop(PRACTICE_BOT_USER_ID, None)
            self.inputs.pop(PRACTICE_BOT_USER_ID, None)
        self._assign_teams()
        if not self._human_players():
            self._return_to_lobby("empty")
        elif len(self._human_players()) < self._min_players() and self.state in {"character_select", "loading", "round_start", "in_round", "round_end"}:
            self._return_to_lobby("not_enough_players")
        self.outbox.append(self.roster_message())

    def _spawn_or_create_fighter(self, user: dict) -> Fighter:
        user_id = int(user["id"])
        fighter = self.fighters.get(user_id)
        if fighter is None:
            default_char = self._default_char()
            fighter = Fighter(user_id=user_id, username=user["username"], display_name=user.get("display_name") or user["username"], character_id=default_char, color=CHARACTERS.get(default_char, {}).get("color", TEAM_COLORS[user_id % len(TEAM_COLORS)]), accent_color=CHARACTERS.get(default_char, {}).get("accent_color", "#ffffff"))
            self.fighters[user_id] = fighter
        self._apply_character_stats(fighter, fighter.character_id)
        self._respawn_fighter(fighter, full_reset=True)
        return fighter

    def _ensure_practice_bot(self) -> None:
        if PRACTICE_BOT_USER_ID in self.players:
            return
        self.players.append(PRACTICE_BOT_USER_ID)
        bot = Fighter(user_id=PRACTICE_BOT_USER_ID, username=PRACTICE_BOT_USERNAME, display_name=PRACTICE_BOT_NAME, character_id="atlas", color=CHARACTERS.get("atlas", {}).get("color", TEAM_COLORS[1]), accent_color=CHARACTERS.get("atlas", {}).get("accent_color", "#ffffff"), ai_controlled=True)
        self.fighters[PRACTICE_BOT_USER_ID] = bot
        self._apply_character_stats(bot, "atlas")
        self._respawn_fighter(bot, full_reset=True)

    def _assign_teams(self) -> None:
        human_idx = 0
        for uid in self._player_ids_for_match():
            fighter = self.fighters.get(uid)
            if not fighter:
                continue
            if self.mode_name == "practice" and uid == PRACTICE_BOT_USER_ID:
                fighter.team = 1
                continue
            fighter.team = _team_for(self.mode_name, human_idx)
            human_idx += 1
            if self.mode_name == "teams":
                fighter.color = TEAM_COLORS[fighter.team % len(TEAM_COLORS)]
            else:
                char = CHARACTERS.get(fighter.character_id, {})
                fighter.color = char.get("color", fighter.color)
                fighter.accent_color = char.get("accent_color", fighter.accent_color)

    def _apply_character_stats(self, fighter: Fighter, char_id: str) -> None:
        char = CHARACTERS.get(char_id) or CHARACTERS[self._default_char()]
        stats = char.get("stats", {})
        fighter.character_id = char["id"]
        fighter.move_speed = float(stats.get("move_speed", 320))
        fighter.air_speed = float(stats.get("air_speed", fighter.move_speed * 0.88))
        fighter.jump_speed = float(stats.get("jump_speed", 820))
        fighter.weight = float(stats.get("weight", 1.0))
        fighter.damage_scale = float(stats.get("damage", 1.0))
        fighter.kb_resist = float(stats.get("knockback_resist", 1.0))
        fighter.hitbox_scale = float(stats.get("hitbox_scale", 1.0))
        fighter.max_jumps = int(stats.get("max_jumps", 2))
        fighter.max_air_dashes = int(stats.get("max_air_dashes", 1))
        fighter.color = char.get("color", fighter.color)
        fighter.accent_color = char.get("accent_color", fighter.accent_color)
        fighter.max_stocks = self.stocks_per_round
        fighter.stocks = min(fighter.stocks or self.stocks_per_round, self.stocks_per_round)

    def _reset_for_new_match(self) -> None:
        self.round_index = 0
        self.round_kos = {uid: 0 for uid in self._player_ids_for_match()}
        self.round_damage = {uid: 0.0 for uid in self._player_ids_for_match()}
        self.coins = []
        self.tick_seq = 0
        self._snapshot_accum = 0.0
        self._event_accum = []
        self.last_result_summary = {}
        self.ended = False
        self._results_applied = False
        self._apply_stage(self._pick_stage_id())
        for uid in self._player_ids_for_match():
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
            fighter.damage = 0.0
            fighter.stocks = self.stocks_per_round
            fighter.dash_cd = fighter.basic_cd = fighter.special_cd = fighter.ult_cd = 0.0
            self._respawn_fighter(fighter, full_reset=True)

    def _enter_character_select(self) -> None:
        if len(self._human_players()) < self._min_players():
            return
        self._reset_for_new_match()
        self.state = "character_select"
        self.character_select_left = CHARACTER_SELECT_SECONDS
        self.loading_left = 0.0
        self.round_start_left = 0.0
        self.round_time_left = float(self.round_seconds)
        self.time_left = self.round_time_left
        self.round_end_left = 0.0
        self.ready = set()
        self.outbox.append({"type": "arena_state_change", "room_id": self.room_id, "state": self.state, "seconds": self.character_select_left})
        self.outbox.append(self.roster_message())

    def _enter_loading(self) -> None:
        self.state = "loading"
        self.loading_left = LOADING_SECONDS
        self.outbox.append({"type": "arena_loading", "room_id": self.room_id, "seconds": self.loading_left, "stage_id": self.selected_stage_id})

    def _enter_round_start(self) -> None:
        self.state = "round_start"
        self.round_index += 1
        self.round_start_left = ROUND_START_COUNTDOWN_SECONDS
        self.round_time_left = float(self.round_seconds)
        self.time_left = self.round_time_left
        self.round_end_left = 0.0
        self.round_kos = {uid: 0 for uid in self._player_ids_for_match()}
        self.round_damage = {uid: 0.0 for uid in self._player_ids_for_match()}
        for uid in self._player_ids_for_match():
            fighter = self.fighters.get(uid)
            if not fighter:
                continue
            fighter.round_cc = 0
            fighter.damage = 0.0
            fighter.stocks = self.stocks_per_round
            fighter.dash_cd = fighter.basic_cd = fighter.special_cd = fighter.ult_cd = 0.0
            fighter.ult_charge = min(fighter.ult_charge, ULT_CHARGE_MAX)
            self._respawn_fighter(fighter, full_reset=True)
        self.outbox.append({"type": "arena_round_start", "room_id": self.room_id, "round": self.round_index, "best_of": self.best_of, "wins_required": self.wins_required, "seconds": self.round_start_left, "stage_id": self.selected_stage_id})

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
        self.outbox.append({"type": "arena_round_end", "room_id": self.room_id, "reason": reason, "round": self.round_index, "winners": sorted(winners), "scores": self._round_score_rows(), "next_in": self.round_end_left})

    def _return_to_lobby(self, reason: str) -> None:
        self.state = "lobby"
        self.character_select_left = 0.0
        self.loading_left = 0.0
        self.round_start_left = 0.0
        self.round_time_left = float(self.round_seconds)
        self.time_left = self.round_time_left
        self.round_end_left = 0.0
        self.ready = set()
        self.coins = []
        self.outbox.append({"type": "arena_state_change", "room_id": self.room_id, "state": "lobby", "reason": reason})

    def roster_message(self) -> dict:
        return {"type": "arena_roster", "room_id": self.room_id, "mode_name": self.mode_name, "state": self.state, "players": self._player_ids_for_match(), "spectators": list(self.spectators), "ready": list(self.ready), "round": self.round_index, "best_of": self.best_of, "wins_required": self.wins_required, "stage_id": self.selected_stage_id, "stage": self.stage, "fighters": {uid: self._fighter_meta(fighter) for uid, fighter in self.fighters.items() if uid in self.players}}

    def _fighter_meta(self, fighter: Fighter) -> dict:
        char = CHARACTERS.get(fighter.character_id, {})
        return {"user_id": fighter.user_id, "username": fighter.username, "display_name": fighter.display_name, "character_id": fighter.character_id, "character_name": char.get("display_name", fighter.character_id), "move_names": char.get("move_names", {}), "move_summary": char.get("move_summary", {}), "team": fighter.team, "color": fighter.color, "accent_color": fighter.accent_color, "title": char.get("title", ""), "archetype": char.get("archetype", ""), "ai_controlled": fighter.ai_controlled}

    def handle(self, user_id: int, msg: dict) -> None:
        t = msg.get("type")
        if t == "arena_select":
            char_id = str(msg.get("character_id", "")).strip().lower()
            if user_id in self.fighters and char_id in CHARACTERS and self.state in {"character_select", "lobby"}:
                self._apply_character_stats(self.fighters[user_id], char_id)
                self.outbox.append(self.roster_message())
        elif t == "arena_ready":
            if user_id in self._human_players() and self.state == "character_select":
                if bool(msg.get("ready", True)):
                    self.ready.add(user_id)
                else:
                    self.ready.discard(user_id)
                self.outbox.append(self.roster_message())
        elif t == "arena_input":
            if user_id in self.players:
                self.inputs[user_id] = {"seq": int(msg.get("seq", 0)), "dt": float(msg.get("dt", 0.0) or 0.0), "up": bool(msg.get("up")), "down": bool(msg.get("down")), "left": bool(msg.get("left")), "right": bool(msg.get("right")), "dash": bool(msg.get("dash")), "basic": bool(msg.get("basic")), "special": bool(msg.get("special")), "ult": bool(msg.get("ult"))}
        elif t == "arena_start":
            if self.state == "lobby":
                self._enter_character_select()
            elif self.state == "character_select":
                self.character_select_left = min(self.character_select_left, 0.2)
            elif self.state == "loading":
                self.loading_left = min(self.loading_left, 0.2)
        elif t == "arena_restart" and self.state in {"match_end", "lobby"}:
            self._enter_character_select()

    def _spawn_points(self) -> List[tuple[float, float]]:
        raw = self.stage.get("spawn_points") or [[560, 640], [1040, 640], [460, 520], [1140, 520]]
        points = [(float(item[0]), float(item[1])) for item in raw]
        return points or [(560.0, 640.0), (1040.0, 640.0)]

    def _spawn_point_for(self, fighter: Fighter) -> tuple[float, float]:
        points = self._spawn_points()
        if self.mode_name in {"duel", "practice"}:
            return points[(0 if fighter.team == 0 else 1) % len(points)]
        if self.mode_name == "teams":
            same_team = [uid for uid in self.players if uid in self.fighters and self.fighters[uid].team == fighter.team]
            idx = same_team.index(fighter.user_id) if fighter.user_id in same_team else 0
            group = points[:2] if fighter.team == 0 else points[2:4] or points[2:]
            return group[idx % len(group)]
        idx = self.players.index(fighter.user_id) if fighter.user_id in self.players else 0
        return points[idx % len(points)]

    def _respawn_fighter(self, fighter: Fighter, *, full_reset: bool) -> None:
        fighter.x, fighter.y = self._spawn_point_for(fighter)
        fighter.clear_for_spawn()
        fighter.alive = True
        fighter.invuln_timer = RESPAWN_INVULN_SECONDS
        fighter.respawn_timer = 0.0
        fighter.last_hit_by = None
        fighter.damage = 0.0 if full_reset else fighter.damage
        fighter.coyote_timer = 0.0
        fighter.jump_buffer = 0.0

    def _ko_fighter(self, victim: Fighter, killer_id: Optional[int]) -> None:
        if victim.stocks <= 0:
            return
        victim.stocks = max(0, victim.stocks - 1)
        victim.score_deaths += 1
        victim.alive = False
        victim.vx = 0.0
        victim.vy = 0.0
        victim.attack_key = ""
        victim.attack_name = ""
        victim.attack_timer = 0.0
        victim.attack_hit_ids.clear()
        victim.damage = 0.0
        victim.invuln_timer = 0.0
        if killer_id is not None and killer_id in self.fighters and killer_id != victim.user_id:
            killer = self.fighters[killer_id]
            killer.score_kos += 1
            self.round_kos[killer_id] = self.round_kos.get(killer_id, 0) + 1
            killer.ult_charge = min(ULT_CHARGE_MAX, killer.ult_charge + 24.0)
        if victim.stocks > 0:
            victim.respawn_timer = RESPAWN_SECONDS
        self._event_accum.append({"kind": "ko", "victim": victim.user_id, "killer": killer_id, "stocks_left": victim.stocks})

    def _enemy_targets(self, attacker: Fighter) -> List[Fighter]:
        out: List[Fighter] = []
        for uid in self._player_ids_for_match():
            fighter = self.fighters.get(uid)
            if not fighter or fighter.user_id == attacker.user_id or fighter.stocks <= 0 or not fighter.alive or fighter.invuln_timer > 0:
                continue
            if self.mode_name == "teams" and attacker.team == fighter.team:
                continue
            out.append(fighter)
        return out

    def _attack_for(self, fighter: Fighter, button: str):
        char_id = fighter.character_id if fighter.character_id in MOVE_LIBRARY else "relay"
        return MOVE_LIBRARY[char_id][f"{'ground' if fighter.grounded else 'air'}_{button}"]

    def _begin_attack(self, fighter: Fighter, button: str) -> None:
        attack = self._attack_for(fighter, button)
        fighter.attack_key = attack.key
        fighter.attack_name = attack.label
        fighter.attack_timer = attack.total
        fighter.attack_seq += 1
        fighter.attack_hit_ids.clear()
        if attack.self_vx:
            fighter.vx += fighter.facing * attack.self_vx
        if attack.self_vy:
            fighter.vy += attack.self_vy
            fighter.grounded = False
        self._event_accum.append({"kind": "attack", "user_id": fighter.user_id, "attack": attack.key})

    def _resolve_attack_hits(self, fighter: Fighter, attack) -> None:
        center_x = fighter.x + (attack.offset_x * fighter.facing)
        center_y = fighter.y + attack.offset_y - (fighter.hurtbox_height() * 0.55)
        for target in self._enemy_targets(fighter):
            if target.user_id in fighter.attack_hit_ids:
                continue
            dx = abs(target.x - center_x)
            dy = abs((target.y - (target.hurtbox_height() * 0.55)) - center_y)
            if dx > (attack.range_x + target.hurtbox_width() * 0.38) or dy > (attack.range_y + target.hurtbox_height() * 0.30):
                continue
            fighter.attack_hit_ids.add(target.user_id)
            damage = max(1.0, attack.damage * fighter.damage_scale)
            target.damage += damage
            target.last_hit_by = fighter.user_id
            target.ult_charge = min(ULT_CHARGE_MAX, target.ult_charge + damage * 0.42)
            fighter.damage_dealt += damage
            self.round_damage[fighter.user_id] = self.round_damage.get(fighter.user_id, 0.0) + damage
            fighter.ult_charge = min(ULT_CHARGE_MAX, fighter.ult_charge + attack.ult_gain + damage * 0.30)
            launch = (attack.knockback + (target.damage * attack.growth)) / max(0.75, target.weight * target.kb_resist)
            angle = attack.angle_deg if fighter.facing >= 0 else 180.0 - attack.angle_deg
            radians = math.radians(angle)
            target.vx = math.cos(radians) * launch
            target.vy = -math.sin(radians) * launch
            target.stun_timer = max(target.stun_timer, attack.hitstun + (target.damage * 0.0012))
            target.grounded = False
            self._event_accum.append({"kind": "hit", "attacker": fighter.user_id, "target": target.user_id, "attack": attack.key, "damage": round(damage, 1), "knockback": round(launch, 1)})

    def _update_attack_state(self, fighter: Fighter, dt: float) -> None:
        if not fighter.attack_key:
            return
        attack = MOVE_LIBRARY.get(fighter.character_id, MOVE_LIBRARY["relay"]).get(fighter.attack_key)
        if attack is None:
            fighter.attack_key = ""
            fighter.attack_name = ""
            fighter.attack_timer = 0.0
            return
        fighter.attack_timer = max(0.0, fighter.attack_timer - dt)
        elapsed = attack.total - fighter.attack_timer
        if attack.startup <= elapsed <= attack.startup + attack.active:
            self._resolve_attack_hits(fighter, attack)
        if fighter.attack_timer <= 0:
            fighter.attack_key = ""
            fighter.attack_name = ""
            fighter.attack_hit_ids.clear()

    def _apply_horizontal_input(self, fighter: Fighter, dt: float, inp: dict) -> None:
        move_dir = (1 if inp.get("right") else 0) - (1 if inp.get("left") else 0)
        if move_dir:
            fighter.facing = 1 if move_dir > 0 else -1
        if fighter.dash_timer > 0 or fighter.stun_timer > 0:
            return
        accel = GROUND_ACCEL if fighter.grounded else AIR_ACCEL
        max_speed = fighter.move_speed if fighter.grounded else fighter.air_speed
        if fighter.grounded and move_dir and ((fighter.vx > 0 and move_dir < 0) or (fighter.vx < 0 and move_dir > 0)):
            accel *= GROUND_TURN_BOOST
        if move_dir:
            fighter.vx = clamp(fighter.vx + (move_dir * accel * dt), -max_speed, max_speed)
        elif fighter.grounded:
            drag = GROUND_DRAG * dt
            if abs(fighter.vx) <= drag:
                fighter.vx = 0.0
            else:
                fighter.vx -= math.copysign(drag, fighter.vx)
        else:
            fighter.vx *= max(0.0, 1.0 - (AIR_DRAG * dt / max(240.0, fighter.air_speed)))

    def _apply_jump_edge(self, fighter: Fighter, inp: dict) -> None:
        pressed = bool(inp.get("up"))
        was = fighter.hit_latch.get("jump", False)
        fighter.hit_latch["jump"] = pressed
        if pressed and not was:
            fighter.jump_buffer = JUMP_BUFFER_SECONDS

    def _consume_jump(self, fighter: Fighter) -> bool:
        if fighter.jump_buffer <= 0:
            return False
        if fighter.grounded or fighter.coyote_timer > 0:
            fighter.jump_buffer = 0.0
            fighter.grounded = False
            fighter.coyote_timer = 0.0
            fighter.jumps_used = 1
            fighter.vy = -fighter.jump_speed
            self._event_accum.append({"kind": "jump", "user_id": fighter.user_id, "air": False})
            return True
        if fighter.jumps_used < fighter.max_jumps:
            fighter.jump_buffer = 0.0
            fighter.grounded = False
            fighter.jumps_used += 1
            fighter.vy = -fighter.jump_speed * 0.94
            self._event_accum.append({"kind": "jump", "user_id": fighter.user_id, "air": True})
            return True
        return False

    def _handle_action_edges(self, fighter: Fighter, inp: dict) -> None:
        self._apply_jump_edge(fighter, inp)
        for key in ("dash", "basic", "special", "ult"):
            pressed = bool(inp.get(key))
            was = fighter.hit_latch.get(key, False)
            fighter.hit_latch[key] = pressed
            if not pressed or was or not fighter.alive or fighter.stun_timer > 0 or fighter.landing_lag > 0:
                continue
            if key == "dash" and fighter.dash_cd <= 0:
                if fighter.grounded or fighter.air_dashes_used < fighter.max_air_dashes:
                    dash_x = (1 if inp.get("right") else 0) - (1 if inp.get("left") else 0)
                    dash_y = (1 if inp.get("down") else 0) - (1 if inp.get("up") else 0)
                    if dash_x == 0 and dash_y == 0:
                        dash_x = fighter.facing
                    nx, ny, _ = _norm(float(dash_x), float(dash_y))
                    fighter.dash_cd = DASH_COOLDOWN_SECONDS
                    fighter.dash_timer = DASH_DURATION_SECONDS
                    fighter.vx = nx * DASH_SPEED
                    fighter.vy = ny * DASH_SPEED * (0.68 if not fighter.grounded else 0.42)
                    was_grounded = fighter.grounded
                    fighter.grounded = False
                    if not was_grounded:
                        fighter.air_dashes_used += 1
                    self._event_accum.append({"kind": "dash", "user_id": fighter.user_id})
            elif key == "basic" and fighter.basic_cd <= 0 and fighter.attack_timer <= 0:
                fighter.basic_cd = BASIC_COOLDOWN_SECONDS
                self._begin_attack(fighter, "basic")
            elif key == "special" and fighter.special_cd <= 0 and fighter.attack_timer <= 0:
                fighter.special_cd = SPECIAL_COOLDOWN_SECONDS
                self._begin_attack(fighter, "special")
            elif key == "ult" and fighter.ult_cd <= 0 and fighter.attack_timer <= 0 and fighter.ult_charge >= ULT_CHARGE_MAX:
                fighter.ult_cd = ULT_COOLDOWN_SECONDS
                fighter.ult_charge = 0.0
                self._begin_attack(fighter, "ult")

    def _platforms(self) -> List[dict]:
        return list(self.stage.get("platforms") or [])

    def _resolve_platform_collision(self, fighter: Fighter, prev_bottom: float) -> bool:
        landed_on = None
        for platform in self._platforms():
            px = float(platform.get("x", 0))
            py = float(platform.get("y", 0))
            pw = float(platform.get("w", 0))
            if fighter.right() < px + 10 or fighter.left() > px + pw - 10:
                continue
            if prev_bottom <= py <= fighter.bottom():
                if landed_on is None or py < landed_on["y"]:
                    landed_on = {"y": py}
        if landed_on is None:
            return False
        was_grounded = fighter.grounded
        fighter.y = float(landed_on["y"])
        fighter.vy = 0.0
        fighter.grounded = True
        fighter.coyote_timer = COYOTE_TIME_SECONDS
        fighter.jumps_used = 0
        fighter.air_dashes_used = 0
        if not was_grounded:
            fighter.landing_lag = max(fighter.landing_lag, LANDING_LAG_SECONDS)
            self._event_accum.append({"kind": "land", "user_id": fighter.user_id})
        return True

    def _outside_blast_zone(self, fighter: Fighter) -> bool:
        blast = self.stage.get("blast_zone") or {}
        left = float(blast.get("left", -220))
        right = float(blast.get("right", self.width + 220))
        top = float(blast.get("top", -260))
        bottom = float(blast.get("bottom", self.height + 240))
        return fighter.x < left or fighter.x > right or fighter.y < top or fighter.y > bottom

    def _tick_fighter(self, fighter: Fighter, dt: float, inp: dict) -> None:
        if fighter.respawn_timer > 0:
            fighter.respawn_timer = max(0.0, fighter.respawn_timer - dt)
            if fighter.respawn_timer <= 0 and fighter.stocks > 0:
                self._respawn_fighter(fighter, full_reset=False)
                self._event_accum.append({"kind": "respawn", "user_id": fighter.user_id, "stocks_left": fighter.stocks})
            return
        fighter.invuln_timer = max(0.0, fighter.invuln_timer - dt)
        fighter.last_input_seq = int(inp.get("seq", fighter.last_input_seq))
        fighter.dash_cd = max(0.0, fighter.dash_cd - dt)
        fighter.basic_cd = max(0.0, fighter.basic_cd - dt)
        fighter.special_cd = max(0.0, fighter.special_cd - dt)
        fighter.ult_cd = max(0.0, fighter.ult_cd - dt)
        fighter.stun_timer = max(0.0, fighter.stun_timer - dt)
        fighter.landing_lag = max(0.0, fighter.landing_lag - dt)
        fighter.jump_buffer = max(0.0, fighter.jump_buffer - dt)
        fighter.coyote_timer = max(0.0, fighter.coyote_timer - dt)
        fighter.ult_charge = min(ULT_CHARGE_MAX, fighter.ult_charge + dt * 6.0)
        if not fighter.alive:
            return
        self._handle_action_edges(fighter, inp)
        if self._consume_jump(fighter):
            fighter.attack_key = ""
            fighter.attack_name = ""
            fighter.attack_timer = 0.0
            fighter.attack_hit_ids.clear()
        self._apply_horizontal_input(fighter, dt, inp)
        if fighter.dash_timer > 0:
            fighter.dash_timer = max(0.0, fighter.dash_timer - dt)
        elif fighter.stun_timer > 0:
            fighter.vx *= 0.985
        elif fighter.attack_key and fighter.grounded:
            fighter.vx *= 0.94
        gravity = FAST_FALL_GRAVITY if (not fighter.grounded and inp.get("down") and fighter.vy >= 0) else GRAVITY
        fighter.vy = min(MAX_FALL_SPEED, fighter.vy + (gravity * dt))
        prev_bottom = fighter.bottom()
        was_grounded = fighter.grounded
        fighter.x += fighter.vx * dt
        fighter.y += fighter.vy * dt
        fighter.grounded = False
        landed = self._resolve_platform_collision(fighter, prev_bottom)
        if not landed and was_grounded:
            fighter.coyote_timer = COYOTE_TIME_SECONDS
        self._update_attack_state(fighter, dt)
        if self._outside_blast_zone(fighter):
            self._ko_fighter(fighter, fighter.last_hit_by)

    def _combatant_groups(self) -> Dict[int, List[Fighter]]:
        groups: Dict[int, List[Fighter]] = {}
        for uid in self._player_ids_for_match():
            fighter = self.fighters.get(uid)
            if not fighter:
                continue
            groups.setdefault(fighter.team if self.mode_name == "teams" else fighter.user_id, []).append(fighter)
        return groups

    def _living_group_keys(self) -> Set[int]:
        return {key for key, fighters in self._combatant_groups().items() if any(fighter.stocks > 0 for fighter in fighters)}

    def _round_score_rows(self) -> List[dict]:
        rows = []
        for uid in self._player_ids_for_match():
            fighter = self.fighters.get(uid)
            if fighter:
                rows.append({"user_id": uid, "display_name": fighter.display_name, "team": fighter.team, "round_wins": fighter.round_wins, "round_kos": self.round_kos.get(uid, 0), "match_kos": fighter.score_kos, "deaths": fighter.score_deaths, "stocks": fighter.stocks, "damage": round(fighter.damage, 1), "round_cc": fighter.round_cc, "match_cc": fighter.match_cc})
        rows.sort(key=lambda row: (-row["round_wins"], -row["stocks"], row["damage"], row["display_name"]))
        return rows

    def _round_winners(self) -> Set[int]:
        groups = self._combatant_groups()
        if not groups:
            return set()
        if self.mode_name == "teams":
            ranked = []
            for team, fighters in groups.items():
                ranked.append((team, sum(max(0, fighter.stocks) for fighter in fighters), sum(max(0.0, fighter.damage) for fighter in fighters if fighter.stocks > 0)))
            ranked.sort(key=lambda item: (-item[1], item[2], item[0]))
            if len(ranked) > 1 and ranked[0][1:] == ranked[1][1:]:
                return set()
            return {fighter.user_id for fighter in groups[ranked[0][0]]}
        ranked = [fighter for fighters in groups.values() for fighter in fighters]
        ranked.sort(key=lambda fighter: (-fighter.stocks, fighter.damage, fighter.score_deaths, fighter.display_name))
        if len(ranked) > 1:
            first, second = ranked[0], ranked[1]
            if (first.stocks, round(first.damage, 1), first.score_deaths) == (second.stocks, round(second.damage, 1), second.score_deaths):
                return set()
        return {ranked[0].user_id}

    def _match_winners(self) -> Set[int]:
        if self.mode_name == "teams":
            team_scores: Dict[int, int] = {}
            for uid in self._player_ids_for_match():
                fighter = self.fighters.get(uid)
                if fighter:
                    team_scores[fighter.team] = max(team_scores.get(fighter.team, 0), fighter.round_wins)
            if not team_scores:
                return set()
            top = max(team_scores.values())
            winners = [team for team, score in team_scores.items() if score == top]
            if len(winners) != 1:
                return set()
            return {uid for uid in self._player_ids_for_match() if self.fighters[uid].team == winners[0]}
        ranked = [self.fighters[uid] for uid in self._player_ids_for_match()]
        ranked.sort(key=lambda fighter: (-fighter.round_wins, -fighter.score_kos, fighter.score_deaths, fighter.display_name))
        if len(ranked) > 1:
            first, second = ranked[0], ranked[1]
            if (first.round_wins, first.score_kos, first.score_deaths) == (second.round_wins, second.score_kos, second.score_deaths):
                return set()
        return {ranked[0].user_id} if ranked else set()

    def _round_should_end(self) -> Optional[str]:
        if self.round_time_left <= 0:
            return "time"
        if len(self._living_group_keys()) <= 1:
            return "stock_out"
        return None

    def _maybe_finish_match(self) -> bool:
        for uid in self._player_ids_for_match():
            fighter = self.fighters.get(uid)
            if fighter and fighter.round_wins >= self.wins_required:
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
            if len(self._human_players()) >= self._min_players():
                self._enter_character_select()
        elif self.state == "character_select":
            everyone_ready = bool(self._human_players()) and all(uid in self.ready for uid in self._human_players())
            self.character_select_left = max(0.0, self.character_select_left - dt)
            if everyone_ready or self.character_select_left <= 0:
                self._enter_loading()
        elif self.state == "loading":
            self.loading_left = max(0.0, self.loading_left - dt)
            if self.loading_left <= 0:
                self._enter_round_start()
        elif self.state == "round_start":
            self.round_start_left = max(0.0, self.round_start_left - dt)
            if self.round_start_left <= 0:
                self._enter_in_round()
        elif self.state == "in_round":
            self.round_time_left = max(0.0, self.round_time_left - dt)
            self.time_left = self.round_time_left
            bot = self.fighters.get(PRACTICE_BOT_USER_ID)
            if bot and self.mode_name == "practice" and bot.stocks > 0:
                self.inputs[PRACTICE_BOT_USER_ID] = self.bot_ai.pick_inputs(self, bot, dt)
            for uid in self._player_ids_for_match():
                fighter = self.fighters.get(uid)
                if fighter:
                    self._tick_fighter(fighter, dt, self.inputs.get(uid, {}))
            reason = self._round_should_end()
            if reason:
                self._finish_round(reason)
        elif self.state == "round_end":
            self.round_end_left = max(0.0, self.round_end_left - dt)
            self.time_left = self.round_end_left
            if self.round_end_left <= 0 and not self._maybe_finish_match():
                self._enter_round_start()
        elif self.state == "match_end":
            self.time_left = 0.0
        self._snapshot_accum += dt
        if self._snapshot_accum >= 1 / ARENA_SNAPSHOT_RATE:
            self._snapshot_accum = 0.0
            self.outbox.append(self.snapshot())

    def _scoreboard(self) -> List[dict]:
        rows = []
        for uid in self._player_ids_for_match():
            fighter = self.fighters.get(uid)
            if fighter:
                rows.append({"user_id": uid, "username": fighter.username, "display_name": fighter.display_name, "team": fighter.team, "round_wins": fighter.round_wins, "kos": fighter.score_kos, "deaths": fighter.score_deaths, "damage": round(fighter.damage_dealt, 1), "character_id": fighter.character_id, "cc_earned": fighter.match_cc, "ai_controlled": fighter.ai_controlled})
        rows.sort(key=lambda row: (-row["round_wins"], -row["kos"], row["deaths"], row["display_name"]))
        return rows

    def _apply_stats_results(self) -> None:
        humans = [uid for uid in self._human_players() if uid in self.fighters]
        if self.mode_name == "practice" or not humans:
            return
        winners = self._match_winners()
        payload = []
        for uid in humans:
            fighter = self.fighters.get(uid)
            if not fighter:
                continue
            win = uid in winners
            perf_bonus = max(0, fighter.score_kos * 2 - fighter.score_deaths) + (12 if win else 0)
            payload.append({"user_id": uid, "win": win, "kos": int(fighter.score_kos), "deaths": int(fighter.score_deaths), "damage": float(fighter.damage_dealt), "cc_earned": int(min(COIN_MATCH_REWARD_CAP, fighter.match_cc + perf_bonus))})
        summary: Dict[int, dict] = {}
        if hasattr(self.db, "apply_arena_match_results"):
            summary = self.db.apply_arena_match_results(payload)
        else:
            for row in payload:
                stats = self.db.apply_match_result(row["user_id"], win=row["win"], kos_delta=row["kos"], deaths_delta=row["deaths"])
                summary[int(row["user_id"])] = {"cc_credited": int(row["cc_earned"]), "cortisol_after": int(stats.get("cortisol", 0))}
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
        self.outbox.append({"type": "arena_end", "room_id": self.room_id, "reason": reason, "winners": winners, "scoreboard": scoreboard, "mode_name": self.mode_name, "best_of": self.best_of, "wins_required": self.wins_required, "stage_id": self.selected_stage_id})

    def snapshot(self) -> dict:
        fighters_public = {uid: self.fighters[uid].to_public() for uid in self._player_ids_for_match()}
        active_time = self.round_time_left if self.state == "in_round" else self.time_left
        return {"type": "arena_state", "room_id": self.room_id, "mode_name": self.mode_name, "state": self.state, "tick": self.tick_seq, "round": self.round_index, "best_of": self.best_of, "wins_required": self.wins_required, "stocks_per_round": self.stocks_per_round, "round_ko_target": self.round_ko_target, "time_left": round(active_time, 2), "character_select_left": round(self.character_select_left, 2), "loading_left": round(self.loading_left, 2), "round_start_left": round(self.round_start_left, 2), "round_end_left": round(self.round_end_left, 2), "players": self._player_ids_for_match(), "spectators": list(self.spectators), "ready": list(self.ready), "fighters": fighters_public, "coins": self.coins, "round_kos": self.round_kos, "events": self._event_accum[-32:], "arena": {"w": self.width, "h": self.height}, "stage_id": self.selected_stage_id, "stage": self.stage}

    def drain_outbox(self) -> List[dict]:
        out, self.outbox = self.outbox, []
        return out
