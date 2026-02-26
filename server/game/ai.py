import math
import random


class HanniganBossAI:
    def __init__(self):
        self._retarget_in = 0.0
        self._burst_in = random.uniform(1.0, 2.5)
        self._target_id = None
        self._strafe_sign = 1

    def pick_inputs(self, boss, targets, dt: float) -> dict:
        alive_targets = [t for t in targets if t.alive]
        if not alive_targets:
            return {"up": False, "down": False, "left": False, "right": False, "dash": False, "basic": False, "special": False, "ult": False}

        self._retarget_in -= dt
        self._burst_in -= dt
        if self._retarget_in <= 0 or self._target_id not in {t.user_id for t in alive_targets}:
            target = min(alive_targets, key=lambda t: (t.x - boss.x) ** 2 + (t.y - boss.y) ** 2)
            self._target_id = target.user_id
            self._retarget_in = random.uniform(0.5, 1.3)
            self._strafe_sign = random.choice([-1, 1])
        else:
            target = next((t for t in alive_targets if t.user_id == self._target_id), alive_targets[0])

        dx = target.x - boss.x
        dy = target.y - boss.y
        dist = math.hypot(dx, dy) or 1.0
        nx, ny = dx / dist, dy / dist
        strafe_x = -ny * self._strafe_sign
        strafe_y = nx * self._strafe_sign

        move_x = nx * 0.8 + strafe_x * 0.4
        move_y = ny * 0.8 + strafe_y * 0.4
        # Pulse attacks instead of holding the button, so edge-triggered server actions fire repeatedly.
        attack_basic = dist < 70 and random.random() < 0.2
        attack_special = dist < 110 and random.random() < 0.03
        attack_ult = dist < 130 and boss.ult_charge >= 100 and random.random() < 0.02
        dash = dist > 150 and random.random() < 0.03
        if self._burst_in <= 0:
            dash = True
            self._burst_in = random.uniform(1.8, 3.0)
        return {
            "up": move_y < -0.15,
            "down": move_y > 0.15,
            "left": move_x < -0.15,
            "right": move_x > 0.15,
            "dash": dash,
            "basic": attack_basic,
            "special": attack_special,
            "ult": attack_ult,
        }
