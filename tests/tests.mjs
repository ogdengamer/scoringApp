// Shared test cases; run in a browser via tests/index.html or in Node via `node tests/run.mjs`.
import { angleDiff, angleAt, gain, displayValue, formatDelta, advance, DIAL_DEFAULTS } from '../js/dial.js';
import { initialState, addPlayer, applyDelta, undo, newGame, removePlayer, leaders, createStore } from '../js/state.js';

const deg = (d) => (d * Math.PI) / 180;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Drive advance() through a circular drag of `degrees` taking `seconds`, in `steps` events. */
function drag(degrees, seconds, steps = 60, startDeg = -90) {
  let m = { acc: 0, speed: 0, lastAngle: null, lastTime: 0, sweep: 0 };
  for (let i = 0; i <= steps; i++) {
    m = advance(m, deg(startDeg + (degrees * i) / steps), (seconds * i) / steps);
  }
  return m;
}

export const tests = [
  ['angleDiff wraps across +π', () => assert(near(angleDiff(deg(175), deg(-175)), deg(10)), 'expected +10°')],
  ['angleDiff wraps across -π', () => assert(near(angleDiff(deg(-175), deg(175)), deg(-10)), 'expected -10°')],
  ['angleDiff simple cases', () => {
    assert(near(angleDiff(0, deg(30)), deg(30)), '+30°');
    assert(near(angleDiff(0, deg(-45)), deg(-45)), '-45°');
  }],
  ['angleAt: screen coords, clockwise is positive', () => {
    assert(near(angleAt(0, 0, 1, 0), 0), 'right = 0');
    assert(near(angleAt(0, 0, 0, 1), Math.PI / 2), 'down = +π/2');
  }],
  ['gain is base at rest and capped when fast', () => {
    assert(near(gain(0), DIAL_DEFAULTS.basePointsPerRad), 'base at rest');
    assert(gain(1000) === DIAL_DEFAULTS.maxPointsPerRad, 'capped');
    assert(gain(-5) === gain(5), 'symmetric');
  }],
  ['displayValue truncates toward zero and never returns -0', () => {
    assert(displayValue(0.99) === 0 && displayValue(1.01) === 1, 'positive');
    assert(displayValue(-0.4) === 0 && !Object.is(displayValue(-0.4), -0), 'no -0');
    assert(displayValue(-2.7) === -2, 'negative');
  }],
  ['formatDelta signs', () => {
    assert(formatDelta(16) === '+16' && formatDelta(-4) === '−4' && formatDelta(0) === '0', formatDelta(-4));
  }],
  ['very slow drag still accumulates fractional steps (no lost movement)', () => {
    // 30° over 3 s in 300 tiny events: each event is ~0.03 points.
    const m = drag(30, 3, 300);
    assert(displayValue(m.acc) === 1, `expected +1, got ${m.acc.toFixed(3)}`);
  }],
  ['slow drag ≈ 1 point per 20°', () => {
    const m = drag(200, 4);
    const v = displayValue(m.acc);
    assert(v >= 9 && v <= 11, `expected ~10, got ${v}`);
  }],
  ['counter-clockwise is negative and mirrors clockwise', () => {
    const cw = drag(120, 2).acc, ccw = drag(-120, 2).acc;
    assert(ccw < 0 && near(cw, -ccw, 1e-6), `${cw} vs ${ccw}`);
  }],
  ['fast spin moves much faster than slow drag', () => {
    const fast = displayValue(drag(720, 1, 120).acc); // 2 turns in 1 s
    const slow = displayValue(drag(720, 12, 600).acc);
    assert(fast > slow * 1.8 && fast >= 80, `fast ${fast}, slow ${slow}`);
  }],
  ['crossing the ±π seam does not jump', () => {
    const m = drag(60, 2, 60, 150); // 150° → 210° passes through 180°
    assert(near(m.sweep, deg(60), 1e-6), `sweep ${m.sweep}`);
  }],
  ['applyDelta + undo round trip', () => {
    let s = initialState();
    const id = s.players[1].id;
    s = applyDelta(s, id, 16);
    s = applyDelta(s, id, -4);
    assert(s.players[1].score === 12 && s.history.length === 2 && s.history[0].total === 12, 'after apply');
    s = undo(s);
    assert(s.players[1].score === 16 && s.history.length === 1 && s.activeId === id, 'after undo');
  }],
  ['applyDelta ignores zero and unknown players', () => {
    const s = initialState();
    assert(applyDelta(s, s.players[0].id, 0) === s, 'zero');
    assert(applyDelta(s, 'nope', 5) === s, 'unknown');
  }],
  ['newGame zeroes scores, keeps players', () => {
    let s = addPlayer(initialState(), 'Cara');
    s = applyDelta(s, s.activeId, 9);
    s = newGame(s);
    assert(s.players.length === 3 && s.players.every((p) => p.score === 0) && !s.history.length, 'reset');
  }],
  ['addPlayer picks an unused colour; removePlayer drops their history', () => {
    let s = addPlayer(initialState());
    assert(new Set(s.players.map((p) => p.color)).size === 3, 'distinct colours');
    const id = s.activeId;
    s = applyDelta(s, id, 3);
    s = removePlayer(s, id);
    assert(s.players.length === 2 && !s.history.length && s.activeId === s.players[0].id, 'removed');
  }],
  ['leaders: none before scoring, ties included', () => {
    let s = initialState();
    assert(leaders(s).size === 0, 'none');
    s = applyDelta(s, s.players[0].id, 5);
    s = applyDelta(s, s.players[1].id, 5);
    assert(leaders(s).size === 2, 'tie');
  }],
  ['store persists and recovers from corrupt storage', () => {
    const mem = new Map();
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    const a = createStore(storage);
    a.update(applyDelta, a.get().players[0].id, 7);
    assert(createStore(storage).get().players[0].score === 7, 'reloaded');
    mem.set([...mem.keys()][0], '{not json');
    assert(createStore(storage).get().players.length === 2, 'fallback');
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const t = createStore(throwing);
    t.update(applyDelta, t.get().players[0].id, 1);
    assert(t.get().players[0].score === 1, 'works without storage');
  }],
];

export function runAll() {
  return tests.map(([name, fn]) => {
    try { fn(); return { name, ok: true }; } catch (e) { return { name, ok: false, error: e.message }; }
  });
}
