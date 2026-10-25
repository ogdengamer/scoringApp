// Game state: pure reducers plus a small persisted store.

export const PLAYER_COLORS = ['#e4572e', '#2e86de', '#17a589', '#f1c40f', '#8e44ad', '#e67e22', '#d6336c', '#5d6d7e'];

const STORAGE_KEY = 'scoreDial.game.v1';
const HISTORY_LIMIT = 500;

let idCounter = 0;
export function newId() {
  return `${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function initialState() {
  const a = { id: newId(), name: 'Player 1', color: PLAYER_COLORS[0], score: 0 };
  const b = { id: newId(), name: 'Player 2', color: PLAYER_COLORS[1], score: 0 };
  return { players: [a, b], activeId: a.id, history: [] };
}

function nextColor(players) {
  const used = new Set(players.map((p) => p.color));
  return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[players.length % PLAYER_COLORS.length];
}

export function addPlayer(state, name) {
  const p = { id: newId(), name: name || `Player ${state.players.length + 1}`, color: nextColor(state.players), score: 0 };
  return { ...state, players: [...state.players, p], activeId: p.id };
}

export function updatePlayer(state, id, changes) {
  return { ...state, players: state.players.map((p) => (p.id === id ? { ...p, ...changes } : p)) };
}

export function removePlayer(state, id) {
  const players = state.players.filter((p) => p.id !== id);
  const activeId = state.activeId === id ? (players[0]?.id ?? null) : state.activeId;
  return { ...state, players, activeId, history: state.history.filter((h) => h.playerId !== id) };
}

export function selectPlayer(state, id) {
  return state.players.some((p) => p.id === id) ? { ...state, activeId: id } : state;
}

export function applyDelta(state, playerId, delta) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !delta) return state;
  const entry = { id: newId(), playerId, delta, total: player.score + delta, ts: Date.now() };
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, score: p.score + delta } : p)),
    history: [entry, ...state.history].slice(0, HISTORY_LIMIT),
  };
}

/** Revert the most recent change. */
export function undo(state) {
  const [last, ...rest] = state.history;
  if (!last) return state;
  return {
    ...state,
    players: state.players.map((p) => (p.id === last.playerId ? { ...p, score: p.score - last.delta } : p)),
    history: rest,
    activeId: last.playerId,
  };
}

/** Keep the players, zero the scores, clear the history. */
export function newGame(state) {
  return { ...state, players: state.players.map((p) => ({ ...p, score: 0 })), history: [] };
}

/** Ids of the player(s) with the highest score, or none if nobody has scored. */
export function leaders(state) {
  if (!state.history.length || !state.players.length) return new Set();
  const top = Math.max(...state.players.map((p) => p.score));
  return new Set(state.players.filter((p) => p.score === top).map((p) => p.id));
}

function isValid(s) {
  return s && Array.isArray(s.players) && Array.isArray(s.history);
}

export function createStore(storage = globalThis.localStorage) {
  let state;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    state = isValid(parsed) ? parsed : initialState();
  } catch {
    state = initialState();
  }
  const listeners = new Set();

  return {
    get: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    update(reducer, ...args) {
      const next = reducer(state, ...args);
      if (next === state) return;
      state = next;
      try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
      listeners.forEach((fn) => fn(state));
    },
  };
}
