from typing import Any, Dict


def ok_message(kind: str, **payload: Any) -> Dict[str, Any]:
    data = {"type": kind}
    data.update(payload)
    return data


def room_key(mode: str, room_id: str) -> str:
    return f"{mode}:{room_id}"


def parse_input_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    keys = payload.get("keys") or {}
    return {
        "seq": int(payload.get("seq", 0)),
        "up": bool(keys.get("w") or keys.get("up")),
        "down": bool(keys.get("s") or keys.get("down")),
        "left": bool(keys.get("a") or keys.get("left")),
        "right": bool(keys.get("d") or keys.get("right")),
        "dash": bool(keys.get("shift") or keys.get("dash")),
        "basic": bool(keys.get("j") or keys.get("basic")),
        "special": bool(keys.get("k") or keys.get("special")),
        "ult": bool(keys.get("e") or keys.get("ult")),
    }

