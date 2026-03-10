let catalogPromise = null;

async function loadJson(path, fallback = []) {
  try {
    const res = await fetch(path);
    if (!res.ok) return fallback;
    const payload = await res.json();
    return Array.isArray(payload) ? payload : fallback;
  } catch {
    return fallback;
  }
}

export async function loadArenaCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all([
      loadJson("/assets/characters.json", []),
      loadJson("/assets/maps.json", []),
    ]).then(([characters, maps]) => ({
      characters,
      maps,
      charactersById: Object.fromEntries(characters.map((item) => [item.id, item])),
      mapsById: Object.fromEntries(maps.map((item) => [item.id, item])),
    }));
  }
  return catalogPromise;
}
