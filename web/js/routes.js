const ROUTE_CONFIG = {
  home: { screenId: "home", group: "home" },
  play: { screenId: "play", group: "play" },
  arena: { screenId: "arena", group: "play" },
  wallets: { screenId: "wallets", group: "wallets" },
  market: { screenId: "market", group: "market" },
  "create-token": { screenId: "create-token", group: "market" },
  explorer: { screenId: "explorer", group: "explorer" },
  minigames: { screenId: "minigames", group: "minigames" },
  pong: { screenId: "minigames", group: "minigames" },
  reaction: { screenId: "minigames", group: "minigames" },
  typing: { screenId: "minigames", group: "minigames" },
  chess: { screenId: "minigames", group: "minigames" },
  messages: { screenId: "messages", group: "messages" },
  leaderboard: { screenId: "leaderboard", group: "leaderboard" },
  settings: { screenId: "settings", group: "settings" },
};

const ROUTE_ALIASES = {
  game: "play",
  wallet: "wallets",
  exchange: "wallets",
  trade: "market",
  explore: "explorer",
  mini: "minigames",
  minigame: "minigames",
  message: "messages",
  dm: "messages",
  hub: "messages",
  community: "messages",
  rankings: "leaderboard",
};

export const QUICK_ROUTE_LOOKUP = new Map([
  ["home", "home"],
  ["play", "play"],
  ["game", "play"],
  ["wallet", "wallets"],
  ["wallets", "wallets"],
  ["market", "market"],
  ["trade", "market"],
  ["explorer", "explorer"],
  ["explore", "explorer"],
  ["mini", "minigames"],
  ["minigame", "minigames"],
  ["minigames", "minigames"],
  ["messages", "messages"],
  ["message", "messages"],
  ["dm", "messages"],
  ["hub", "messages"],
  ["community", "messages"],
  ["leaderboard", "leaderboard"],
  ["rankings", "leaderboard"],
  ["settings", "settings"],
]);

export function normalizeRouteName(name) {
  const raw = String(name || "").replace(/^#?\/?/, "").toLowerCase();
  const canonical = ROUTE_ALIASES[raw] || raw;
  return ROUTE_CONFIG[canonical] ? canonical : "home";
}

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, "") || "home";
  const url = new URL(`http://x/${raw}`);
  const name = normalizeRouteName(url.pathname.replace(/^\//, "") || "home");
  const params = Object.fromEntries(url.searchParams.entries());
  return { name, params };
}

export function buildHash(route, params = {}) {
  const name = normalizeRouteName(route);
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  return `#/${name}${search.toString() ? `?${search.toString()}` : ""}`;
}

export function isKnownRoute(name) {
  return Boolean(ROUTE_CONFIG[normalizeRouteName(name)]);
}

export function routeGroup(name) {
  return ROUTE_CONFIG[normalizeRouteName(name)]?.group || "home";
}

export function screenIdForRoute(name) {
  return ROUTE_CONFIG[normalizeRouteName(name)]?.screenId || "home";
}
