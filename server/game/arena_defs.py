from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Dict

from game.constants import ARENA_HEIGHT, ARENA_WIDTH
from util import WEB_ROOT


@dataclass(frozen=True)
class AttackDef:
    key: str
    label: str
    startup: float
    active: float
    total: float
    damage: float
    knockback: float
    growth: float
    angle_deg: float
    hitstun: float
    range_x: float
    range_y: float
    offset_x: float
    offset_y: float = 0.0
    self_vx: float = 0.0
    self_vy: float = 0.0
    ult_gain: float = 12.0


def _atk(key: str, label: str, **kwargs) -> AttackDef:
    return AttackDef(key=key, label=label, **kwargs)


MOVE_LIBRARY: Dict[str, Dict[str, AttackDef]] = {
    "relay": {
        "ground_basic": _atk("ground_basic", "Signal Jab", startup=0.05, active=0.08, total=0.22, damage=7.0, knockback=320.0, growth=4.2, angle_deg=24.0, hitstun=0.14, range_x=102.0, range_y=58.0, offset_x=58.0),
        "air_basic": _atk("air_basic", "Orbit Flick", startup=0.04, active=0.10, total=0.24, damage=6.0, knockback=300.0, growth=4.4, angle_deg=38.0, hitstun=0.14, range_x=92.0, range_y=78.0, offset_x=44.0, offset_y=-18.0, self_vx=30.0),
        "ground_special": _atk("ground_special", "Vector Burst", startup=0.12, active=0.09, total=0.38, damage=12.5, knockback=420.0, growth=5.3, angle_deg=30.0, hitstun=0.18, range_x=126.0, range_y=66.0, offset_x=74.0, self_vx=130.0),
        "air_special": _atk("air_special", "Arc Flip", startup=0.10, active=0.10, total=0.40, damage=11.5, knockback=430.0, growth=5.5, angle_deg=56.0, hitstun=0.18, range_x=112.0, range_y=94.0, offset_x=40.0, offset_y=-42.0, self_vx=70.0, self_vy=-180.0),
        "ground_ult": _atk("ground_ult", "Static Crash", startup=0.18, active=0.14, total=0.56, damage=18.0, knockback=560.0, growth=6.4, angle_deg=32.0, hitstun=0.26, range_x=164.0, range_y=92.0, offset_x=88.0, self_vx=180.0),
        "air_ult": _atk("air_ult", "Sky Static", startup=0.16, active=0.14, total=0.58, damage=17.0, knockback=550.0, growth=6.2, angle_deg=70.0, hitstun=0.25, range_x=138.0, range_y=128.0, offset_x=42.0, offset_y=-54.0, self_vy=-260.0),
    },
    "atlas": {
        "ground_basic": _atk("ground_basic", "Anchor Hook", startup=0.08, active=0.09, total=0.28, damage=8.5, knockback=345.0, growth=4.7, angle_deg=18.0, hitstun=0.16, range_x=110.0, range_y=62.0, offset_x=62.0),
        "air_basic": _atk("air_basic", "Shoulder Check", startup=0.06, active=0.09, total=0.30, damage=7.0, knockback=320.0, growth=4.5, angle_deg=35.0, hitstun=0.15, range_x=98.0, range_y=84.0, offset_x=48.0, offset_y=-12.0, self_vx=40.0),
        "ground_special": _atk("ground_special", "Breaker Step", startup=0.14, active=0.12, total=0.44, damage=14.0, knockback=455.0, growth=5.7, angle_deg=24.0, hitstun=0.22, range_x=136.0, range_y=74.0, offset_x=82.0, self_vx=160.0),
        "air_special": _atk("air_special", "Downline Press", startup=0.12, active=0.12, total=0.46, damage=12.0, knockback=470.0, growth=5.8, angle_deg=78.0, hitstun=0.22, range_x=108.0, range_y=118.0, offset_x=26.0, offset_y=-26.0, self_vy=-120.0),
        "ground_ult": _atk("ground_ult", "Foundry Slam", startup=0.22, active=0.14, total=0.66, damage=20.0, knockback=610.0, growth=6.8, angle_deg=26.0, hitstun=0.30, range_x=176.0, range_y=104.0, offset_x=96.0, self_vx=210.0),
        "air_ult": _atk("air_ult", "Meteor Stamp", startup=0.20, active=0.14, total=0.68, damage=18.5, knockback=600.0, growth=6.7, angle_deg=84.0, hitstun=0.29, range_x=128.0, range_y=140.0, offset_x=28.0, offset_y=-34.0, self_vy=-150.0),
    },
    "nyx": {
        "ground_basic": _atk("ground_basic", "Shade Slice", startup=0.04, active=0.08, total=0.20, damage=6.5, knockback=300.0, growth=4.1, angle_deg=22.0, hitstun=0.13, range_x=98.0, range_y=56.0, offset_x=56.0),
        "air_basic": _atk("air_basic", "Ghost Heel", startup=0.04, active=0.09, total=0.22, damage=6.2, knockback=305.0, growth=4.3, angle_deg=46.0, hitstun=0.14, range_x=94.0, range_y=86.0, offset_x=46.0, offset_y=-22.0, self_vx=35.0),
        "ground_special": _atk("ground_special", "Drift Pierce", startup=0.10, active=0.10, total=0.34, damage=10.5, knockback=405.0, growth=5.1, angle_deg=28.0, hitstun=0.18, range_x=128.0, range_y=58.0, offset_x=82.0, self_vx=220.0),
        "air_special": _atk("air_special", "Crossfade", startup=0.08, active=0.11, total=0.34, damage=9.5, knockback=390.0, growth=5.0, angle_deg=52.0, hitstun=0.17, range_x=112.0, range_y=106.0, offset_x=36.0, offset_y=-46.0, self_vx=120.0, self_vy=-210.0),
        "ground_ult": _atk("ground_ult", "Afterimage Drive", startup=0.16, active=0.13, total=0.50, damage=17.0, knockback=545.0, growth=6.3, angle_deg=24.0, hitstun=0.25, range_x=170.0, range_y=82.0, offset_x=102.0, self_vx=300.0),
        "air_ult": _atk("air_ult", "Mooncut", startup=0.16, active=0.14, total=0.52, damage=16.0, knockback=530.0, growth=6.1, angle_deg=64.0, hitstun=0.24, range_x=146.0, range_y=126.0, offset_x=52.0, offset_y=-58.0, self_vy=-300.0),
    },
    "sol": {
        "ground_basic": _atk("ground_basic", "Flare Palm", startup=0.05, active=0.08, total=0.22, damage=7.2, knockback=315.0, growth=4.2, angle_deg=26.0, hitstun=0.14, range_x=100.0, range_y=60.0, offset_x=58.0),
        "air_basic": _atk("air_basic", "Burn Kick", startup=0.05, active=0.09, total=0.24, damage=6.3, knockback=310.0, growth=4.4, angle_deg=42.0, hitstun=0.14, range_x=92.0, range_y=84.0, offset_x=42.0, offset_y=-20.0, self_vx=24.0),
        "ground_special": _atk("ground_special", "Rise Break", startup=0.11, active=0.11, total=0.38, damage=11.5, knockback=415.0, growth=5.2, angle_deg=34.0, hitstun=0.19, range_x=122.0, range_y=70.0, offset_x=68.0, self_vx=110.0),
        "air_special": _atk("air_special", "Thermal Arc", startup=0.09, active=0.12, total=0.40, damage=10.8, knockback=425.0, growth=5.3, angle_deg=68.0, hitstun=0.19, range_x=118.0, range_y=118.0, offset_x=34.0, offset_y=-54.0, self_vy=-220.0),
        "ground_ult": _atk("ground_ult", "Corona Wall", startup=0.18, active=0.15, total=0.56, damage=18.4, knockback=565.0, growth=6.5, angle_deg=28.0, hitstun=0.26, range_x=170.0, range_y=92.0, offset_x=88.0, self_vx=160.0),
        "air_ult": _atk("air_ult", "Sunfall", startup=0.18, active=0.15, total=0.58, damage=17.2, knockback=555.0, growth=6.4, angle_deg=76.0, hitstun=0.26, range_x=136.0, range_y=144.0, offset_x=30.0, offset_y=-52.0, self_vy=-280.0),
    },
}


def _load_json_array(name: str):
    path = WEB_ROOT / "assets" / name
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception:
        return None
    return None


def _fallback_characters() -> Dict[str, dict]:
    return {
        "relay": {"id": "relay", "display_name": "Relay", "title": "Signal Runner", "color": "#6dc5ff", "accent_color": "#b8ebff", "archetype": "balanced initiator", "stats": {"move_speed": 328, "air_speed": 286, "jump_speed": 840, "weight": 0.98, "damage": 1.0, "knockback_resist": 0.98, "hitbox_scale": 1.0, "max_jumps": 2}, "move_names": {"basic": "Signal Jab", "special": "Vector Burst", "ult": "Static Crash"}, "move_summary": {"basic": "Fast forward poke.", "special": "Burst dash launcher.", "ult": "Charged finisher with strong horizontal launch."}},
        "atlas": {"id": "atlas", "display_name": "Atlas", "title": "Heavy Anchor", "color": "#ff8b66", "accent_color": "#ffd7c8", "archetype": "heavy bruiser", "stats": {"move_speed": 284, "air_speed": 240, "jump_speed": 780, "weight": 1.24, "damage": 1.12, "knockback_resist": 1.2, "hitbox_scale": 1.1, "max_jumps": 2}, "move_names": {"basic": "Anchor Hook", "special": "Breaker Step", "ult": "Foundry Slam"}, "move_summary": {"basic": "Short heavy swing.", "special": "Armored burst step into launch.", "ult": "Big commitment, big ring-out power."}},
        "nyx": {"id": "nyx", "display_name": "Nyx", "title": "Drift Blade", "color": "#9d8cff", "accent_color": "#d7d2ff", "archetype": "agile skirmisher", "stats": {"move_speed": 350, "air_speed": 318, "jump_speed": 860, "weight": 0.88, "damage": 0.96, "knockback_resist": 0.9, "hitbox_scale": 0.94, "max_jumps": 2}, "move_names": {"basic": "Shade Slice", "special": "Drift Pierce", "ult": "Afterimage Drive"}, "move_summary": {"basic": "Quick disjoint slash.", "special": "Long reach whiff punisher.", "ult": "Fast traveling super for edge closes."}},
        "sol": {"id": "sol", "display_name": "Sol", "title": "Arc Striker", "color": "#f5d36d", "accent_color": "#fff0bf", "archetype": "air pressure", "stats": {"move_speed": 314, "air_speed": 302, "jump_speed": 880, "weight": 1.02, "damage": 1.02, "knockback_resist": 1.0, "hitbox_scale": 1.0, "max_jumps": 2}, "move_names": {"basic": "Flare Palm", "special": "Rise Break", "ult": "Corona Wall"}, "move_summary": {"basic": "Safe aerial starter.", "special": "Launches at steeper angles.", "ult": "Wide wall of force with strong finish."}},
    }


def _fallback_stages() -> Dict[str, dict]:
    return {
        "skyway_split": {"id": "skyway_split", "display_name": "Skyway Split", "tagline": "Balanced tri-platform lane over the city spine.", "arena": {"w": ARENA_WIDTH, "h": ARENA_HEIGHT}, "blast_zone": {"left": -220, "right": 1820, "top": -240, "bottom": 1120}, "spawn_points": [[600, 640], [1000, 640], [460, 520], [1140, 520]], "platforms": [{"id": "main", "x": 300, "y": 760, "w": 1000, "h": 44}, {"id": "left", "x": 470, "y": 580, "w": 220, "h": 26}, {"id": "mid", "x": 670, "y": 460, "w": 260, "h": 24}, {"id": "right", "x": 910, "y": 580, "w": 220, "h": 26}], "theme": {"sky_top": "#12243e", "sky_bottom": "#223459", "fog": "#31537a", "ground": "#172335", "ground_edge": "#69c9ff", "platform": "#2a405d", "platform_edge": "#8edfff", "accent": "#6dc5ff", "shadow": "#09121d"}},
        "terminal_hub": {"id": "terminal_hub", "display_name": "Terminal Exchange", "tagline": "Long floor with split side decks and market-floor pressure.", "arena": {"w": ARENA_WIDTH, "h": ARENA_HEIGHT}, "blast_zone": {"left": -240, "right": 1840, "top": -260, "bottom": 1140}, "spawn_points": [[540, 650], [1060, 650], [400, 530], [1200, 530]], "platforms": [{"id": "main", "x": 240, "y": 780, "w": 1120, "h": 44}, {"id": "left", "x": 350, "y": 600, "w": 250, "h": 28}, {"id": "right", "x": 1000, "y": 600, "w": 250, "h": 28}, {"id": "mid", "x": 700, "y": 500, "w": 200, "h": 22}], "theme": {"sky_top": "#1d2434", "sky_bottom": "#394258", "fog": "#646d83", "ground": "#20252f", "ground_edge": "#ffc978", "platform": "#424c63", "platform_edge": "#ffe0aa", "accent": "#ffb54d", "shadow": "#11151d"}},
        "night_exchange": {"id": "night_exchange", "display_name": "Night Exchange", "tagline": "Tighter center stack for vertical launch pressure.", "arena": {"w": ARENA_WIDTH, "h": ARENA_HEIGHT}, "blast_zone": {"left": -220, "right": 1820, "top": -280, "bottom": 1120}, "spawn_points": [[620, 650], [980, 650], [520, 530], [1080, 530]], "platforms": [{"id": "main", "x": 320, "y": 780, "w": 960, "h": 44}, {"id": "left", "x": 470, "y": 610, "w": 190, "h": 24}, {"id": "right", "x": 940, "y": 610, "w": 190, "h": 24}, {"id": "upper_left", "x": 620, "y": 500, "w": 170, "h": 22}, {"id": "upper_right", "x": 810, "y": 500, "w": 170, "h": 22}], "theme": {"sky_top": "#0f1324", "sky_bottom": "#281b40", "fog": "#553d7f", "ground": "#19172a", "ground_edge": "#bd9dff", "platform": "#362d58", "platform_edge": "#deccff", "accent": "#a88cff", "shadow": "#090914"}},
    }


def load_character_defs() -> Dict[str, dict]:
    data = _load_json_array("characters.json")
    if data:
        out = {str(item["id"]): item for item in data if isinstance(item, dict) and item.get("id")}
        if out:
            return out
    return _fallback_characters()


def load_stage_defs() -> Dict[str, dict]:
    data = _load_json_array("maps.json")
    if data:
        out = {str(item["id"]): item for item in data if isinstance(item, dict) and item.get("id")}
        if out:
            return out
    return _fallback_stages()


CHARACTERS = load_character_defs()
STAGES = load_stage_defs()
DEFAULT_STAGE_ID = next(iter(STAGES.keys()))
