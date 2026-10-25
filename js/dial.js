// Rotary dial: drag clockwise to add, counter-clockwise to subtract.
// Slow drags move ~1 point per 20°, fast spins accelerate so big swings are quick.
// The pending delta is committed when the finger lifts.

export const DIAL_DEFAULTS = {
  basePointsPerRad: 2.9,  // ≈ 1 point per 20° when moving slowly
  speedGain: 0.012,       // extra gain per (rad/s)²; 2 turns/s ≈ 50 points/turn
  maxPointsPerRad: 12,    // cap ≈ 75 points per turn
  speedTau: 0.08,         // seconds; smoothing window for angular speed
  deadZone: 0.22,         // fraction of radius near the centre where movement is ignored
  haptics: true,
};

const TAU = Math.PI * 2;

/** Angle of point (x, y) around centre (cx, cy), in radians (-π..π). Screen coords: clockwise is positive. */
export function angleAt(cx, cy, x, y) {
  return Math.atan2(y - cy, x - cx);
}

/** Smallest signed difference from prev to curr, wrapped into (-π, π]. */
export function angleDiff(prev, curr) {
  let d = curr - prev;
  while (d > Math.PI) d -= TAU;
  while (d <= -Math.PI) d += TAU;
  return d;
}

/** Points per radian for a given (smoothed) angular speed in rad/s. */
export function gain(speed, s = DIAL_DEFAULTS) {
  const v = Math.abs(speed);
  return Math.min(s.maxPointsPerRad, s.basePointsPerRad * (1 + s.speedGain * v * v));
}

/** Exponentially smooth speed, time-aware so uneven event rates behave the same. */
export function smoothSpeed(prevSpeed, instSpeed, dt, tau = DIAL_DEFAULTS.speedTau) {
  const a = 1 - Math.exp(-dt / tau);
  return prevSpeed + a * (instSpeed - prevSpeed);
}

/** Integer value shown for a fractional accumulator (truncates toward zero, never -0). */
export function displayValue(acc) {
  return Math.trunc(acc) || 0;
}

/**
 * One pointer-move step. `m` is { acc, speed, lastAngle, lastTime, sweep }; angle in radians, t in seconds.
 * A null lastAngle (gesture start, or re-entering from the dead zone) only anchors the angle.
 */
export function advance(m, angle, t, s = DIAL_DEFAULTS) {
  if (m.lastAngle === null) return { ...m, lastAngle: angle, lastTime: t, dTheta: 0 };
  const dTheta = angleDiff(m.lastAngle, angle);
  const dt = Math.max(0.001, t - m.lastTime);
  const speed = smoothSpeed(m.speed, Math.abs(dTheta) / dt, dt, s.speedTau);
  return { acc: m.acc + dTheta * gain(speed, s), speed, lastAngle: angle, lastTime: t, sweep: m.sweep + dTheta, dTheta };
}

export function formatDelta(n) {
  return n > 0 ? `+${n}` : formatScore(n);
}

/** Score with a typographic minus sign. */
export function formatScore(n) {
  return n < 0 ? `−${Math.abs(n)}` : String(n);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

/**
 * Build a dial inside `root`.
 * onChange(delta) fires whenever the pending integer delta changes; onCommit(delta) on release.
 * Returns { nudge(n), cancel(), destroy() }.
 */
export function createDial(root, { onChange = () => {}, onCommit = () => {}, settings = {} } = {}) {
  const s = { ...DIAL_DEFAULTS, ...settings };

  root.classList.add('dial');
  root.tabIndex = 0;
  root.setAttribute('role', 'slider');
  root.setAttribute('aria-label', 'Score change dial. Arrow keys adjust, Enter applies.');

  const face = svg('svg', { viewBox: '-100 -100 200 200', 'aria-hidden': 'true', class: 'dial-svg' }, root);
  svg('circle', { r: 96, class: 'dial-track' }, face);
  const arc = svg('circle', { r: 91, class: 'dial-arc', transform: 'rotate(-90)' }, face);
  const ticks = svg('g', { class: 'dial-ticks' }, face);
  for (let i = 0; i < 60; i++) {
    if (i === 45) continue; // 12 o'clock: the grip sits here
    const major = i % 5 === 0;
    const a = (i / 60) * TAU;
    const r1 = major ? 70 : 76, r2 = 84;
    svg('line', {
      x1: (r1 * Math.cos(a)).toFixed(2), y1: (r1 * Math.sin(a)).toFixed(2),
      x2: (r2 * Math.cos(a)).toFixed(2), y2: (r2 * Math.sin(a)).toFixed(2),
      class: major ? 'tick major' : 'tick',
    }, ticks);
  }
  svg('circle', { cx: 0, cy: -77, r: 4.5, class: 'dial-grip' }, ticks);
  svg('circle', { r: 62, class: 'dial-hub' }, face);

  const readout = document.createElement('div');
  readout.className = 'dial-readout';
  readout.innerHTML = '<div class="dial-delta">0</div><div class="dial-hint">turn to score</div>';
  root.appendChild(readout);
  const deltaEl = readout.firstElementChild;
  const hintEl = readout.lastElementChild;

  const ARC_LEN = TAU * 91;
  const idle = () => ({ acc: 0, speed: 0, lastAngle: null, lastTime: 0, sweep: 0 });
  let m = idle();       // gesture model: fractional points, smoothed speed, radians swept (for the arc)
  let shown = 0;        // integer pending points
  let rotation = 0;     // persistent knob rotation, radians
  let pointerId = null;
  let nudgeTimer = null;

  function render() {
    deltaEl.textContent = formatDelta(shown);
    root.dataset.sign = shown > 0 ? 'pos' : shown < 0 ? 'neg' : 'zero';
    root.setAttribute('aria-valuenow', String(shown));
    root.setAttribute('aria-valuetext', formatDelta(shown));
    hintEl.textContent = shown === 0 ? 'turn to score' : 'release to apply';
    const frac = Math.min(Math.abs(m.sweep) / TAU, 1);
    arc.style.strokeDasharray = `${(frac * ARC_LEN).toFixed(1)} ${ARC_LEN.toFixed(1)}`;
    arc.style.opacity = frac > 0.005 ? '1' : '0'; // a zero-length round-capped stroke still draws a dot
    arc.setAttribute('transform', m.sweep < 0 ? 'rotate(-90) scale(1,-1)' : 'rotate(-90)');
    ticks.setAttribute('transform', `rotate(${((rotation * 180) / Math.PI).toFixed(2)})`);
  }

  /** Re-derive the shown integer from m.acc; tick haptics and notify when it changes. */
  function sync() {
    const v = displayValue(m.acc);
    if (v !== shown) {
      shown = v;
      if (s.haptics && navigator.vibrate) navigator.vibrate(4);
      onChange(shown);
    }
    render();
  }

  function reset() {
    clearTimeout(nudgeTimer);
    m = idle();
    shown = 0;
    render();
    onChange(0);
  }

  function commit() {
    const d = shown;
    reset();
    if (d !== 0) onCommit(d);
  }

  function geometry() {
    const r = root.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: Math.min(r.width, r.height) / 2 };
  }

  function onDown(e) {
    if (pointerId !== null) return;
    clearTimeout(nudgeTimer);
    pointerId = e.pointerId;
    root.setPointerCapture(pointerId);
    root.classList.add('active');
    const g = geometry();
    const dist = Math.hypot(e.clientX - g.cx, e.clientY - g.cy);
    // Keep any pending nudges; start a fresh sweep and speed estimate.
    m = {
      ...m, speed: 0, sweep: 0, lastTime: e.timeStamp / 1000,
      lastAngle: dist < g.radius * s.deadZone ? null : angleAt(g.cx, g.cy, e.clientX, e.clientY),
    };
    e.preventDefault();
  }

  function onMove(e) {
    if (e.pointerId !== pointerId) return;
    const g = geometry();
    const dist = Math.hypot(e.clientX - g.cx, e.clientY - g.cy);
    if (dist < g.radius * s.deadZone) { m = { ...m, lastAngle: null }; return; }
    m = advance(m, angleAt(g.cx, g.cy, e.clientX, e.clientY), e.timeStamp / 1000, s);
    rotation += m.dTheta;
    sync();
  }

  function onUp(e) {
    if (e.pointerId !== pointerId) return;
    try { root.releasePointerCapture(pointerId); } catch {}
    pointerId = null;
    root.classList.remove('active');
    if (e.type === 'pointercancel') reset();
    else commit();
  }

  /** Add whole points to the pending delta (buttons/keys); auto-applies after a pause. */
  function nudge(n, autoCommitMs = 1400) {
    m = { ...m, acc: shown + n };
    sync();
    clearTimeout(nudgeTimer);
    if (autoCommitMs) nudgeTimer = setTimeout(commit, autoCommitMs);
  }

  function onKey(e) {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (step) { nudge(step, 0); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') { commit(); e.preventDefault(); }
    else if (e.key === 'Escape') { reset(); }
  }

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('keydown', onKey);
  render();

  return {
    nudge,
    cancel: reset,
    destroy() {
      clearTimeout(nudgeTimer);
      root.replaceChildren();
    },
  };
}
