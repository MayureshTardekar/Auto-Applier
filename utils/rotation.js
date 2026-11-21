const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');

function stateFile(key) {
  return path.join(DATA_DIR, `rotation_${key}.json`);
}

/** Loads a persisted list offset, wrapped into range [0, total). */
function loadOffset(key, total) {
  if (!total || total < 1) return 0;
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(key), 'utf8'));
    const offset = Number(raw.offset) || 0;
    return ((offset % total) + total) % total;
  } catch {
    return 0;
  }
}

/** Persists a list offset (wrapped into range) for the next run. */
function saveOffset(key, offset, total) {
  if (!total || total < 1) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const next = ((offset % total) + total) % total;
    fs.writeFileSync(
      stateFile(key),
      JSON.stringify({ offset: next, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch {
    // Rotation state is best-effort; never fail a run over it.
  }
}

/** Returns the list rotated so it starts at `offset`, wrapping around. */
function rotate(list, offset) {
  if (!list.length) return [];
  const start = ((offset % list.length) + list.length) % list.length;
  return list.map((_, i) => list[(start + i) % list.length]);
}

module.exports = { loadOffset, saveOffset, rotate };
