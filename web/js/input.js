export function createKeyInput() {
  const state = { w: false, a: false, s: false, d: false, shift: false, j: false, k: false, e: false };
  const pressed = new Set();

  const isEditableTarget = (target) => {
    if (!target || typeof target !== "object") return false;
    if (target.isContentEditable) return true;
    if (typeof target.closest !== "function") return false;
    return !!target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']");
  };

  const mapKey = (key) => {
    const k = String(key || "").toLowerCase();
    if (["w", "a", "s", "d", "j", "k", "e"].includes(k)) return k;
    if (k === "shift") return "shift";
    if (k === "arrowup") return "w";
    if (k === "arrowleft") return "a";
    if (k === "arrowdown") return "s";
    if (k === "arrowright") return "d";
    return null;
  };

  const onDown = (ev) => {
    if (isEditableTarget(ev.target)) return;
    const k = mapKey(ev.key);
    if (!k) return;
    if (!state[k]) pressed.add(k);
    state[k] = true;
    ev.preventDefault();
  };
  const onUp = (ev) => {
    if (isEditableTarget(ev.target)) return;
    const k = mapKey(ev.key);
    if (!k) return;
    state[k] = false;
    ev.preventDefault();
  };

  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  window.addEventListener("blur", () => {
    Object.keys(state).forEach((k) => { state[k] = false; });
    pressed.clear();
  });

  return {
    state,
    consumePressed() { const out = [...pressed]; pressed.clear(); return out; },
    dispose() { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); }
  };
}

export function toArenaInputPayload(keys, seq) {
  return {
    type: "arena_input",
    seq,
    up: !!keys.w,
    down: !!keys.s,
    left: !!keys.a,
    right: !!keys.d,
    dash: !!keys.shift,
    basic: !!keys.j,
    special: !!keys.k,
    ult: !!keys.e
  };
}
