import { createDial, formatDelta, formatScore } from './dial.js';
import {
  PLAYER_COLORS, createStore, addPlayer, updatePlayer, removePlayer, selectPlayer,
  applyDelta, undo, newGame, leaders,
} from './state.js';

const store = createStore();
const $ = (sel) => document.querySelector(sel);

const playersEl = $('#players');
const previewEl = $('#preview');
const historyEl = $('#history');
const historyCountEl = $('#historyCount');
const undoBtn = $('#undo');
const dialog = $('#playerDialog');
const form = $('#playerForm');
const nameInput = $('#playerName');
const swatchesEl = $('#swatches');

let pending = 0;
let editingId = null;

const activePlayer = () => store.get().players.find((p) => p.id === store.get().activeId);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// ---- Dial ----

const dial = createDial($('#dial'), {
  onChange(d) { pending = d; renderPreview(); },
  onCommit(d) {
    const p = activePlayer();
    if (p) store.update(applyDelta, p.id, d);
  },
});

document.querySelectorAll('[data-nudge]').forEach((btn) => {
  btn.addEventListener('click', () => dial.nudge(Number(btn.dataset.nudge)));
});

undoBtn.addEventListener('click', () => { dial.cancel(); store.update(undo); });

$('#newGame').addEventListener('click', () => {
  if (confirm('Start a new game? Scores and history are cleared; players are kept.')) {
    dial.cancel();
    store.update(newGame);
  }
});

// ---- Players strip ----

const LONG_PRESS_MS = 500;
let pressTimer = null, pressStart = null, longPressed = false;

playersEl.addEventListener('pointerdown', (e) => {
  const card = e.target.closest('.player[data-id]');
  if (!card) return;
  longPressed = false;
  pressStart = { x: e.clientX, y: e.clientY };
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { longPressed = true; openEditor(card.dataset.id); }, LONG_PRESS_MS);
});
playersEl.addEventListener('pointermove', (e) => {
  if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) clearTimeout(pressTimer);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((t) =>
  playersEl.addEventListener(t, () => { clearTimeout(pressTimer); pressStart = null; }));
playersEl.addEventListener('contextmenu', (e) => e.preventDefault());

playersEl.addEventListener('click', (e) => {
  if (e.target.closest('.player.add')) {
    store.update(addPlayer);
    openEditor(store.get().activeId, true);
    return;
  }
  const card = e.target.closest('.player[data-id]');
  if (!card || longPressed) return;
  const id = card.dataset.id;
  if (id === store.get().activeId) openEditor(id);
  else { dial.cancel(); store.update(selectPlayer, id); }
});

function renderPlayers(state) {
  const lead = leaders(state);
  const cards = state.players.map((p) => {
    const name = el('span', { className: 'name', textContent: p.name });
    if (lead.has(p.id)) name.append(el('span', { className: 'lead', textContent: '★', title: 'Leading' }));
    const card = el('button', { type: 'button', className: 'player' }, name,
      el('span', { className: 'score', textContent: formatScore(p.score) }));
    card.dataset.id = p.id;
    card.style.setProperty('--pc', p.color);
    card.setAttribute('aria-pressed', String(p.id === state.activeId));
    card.setAttribute('aria-label', `${p.name}, ${formatScore(p.score)} points${p.id === state.activeId ? ', selected. Tap again to edit' : ''}`);
    return card;
  });
  cards.push(el('button', { type: 'button', className: 'player add', textContent: '+ Player' }));
  playersEl.replaceChildren(...cards);
  playersEl.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---- Preview & history ----

function renderPreview() {
  const p = activePlayer();
  if (!p) { previewEl.textContent = 'Add a player to start'; return; }
  const who = el('span', { className: 'who', textContent: p.name });
  const parts = [who, el('span', { className: 'arrow', textContent: '·' }), formatScore(p.score)];
  if (pending) parts.push(el('span', { className: 'arrow', textContent: '→' }), formatScore(p.score + pending));
  previewEl.replaceChildren(...parts);
  document.documentElement.style.setProperty('--accent', p.color);
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function renderHistory(state) {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  historyCountEl.textContent = state.history.length ? `(${state.history.length})` : '';
  if (!state.history.length) {
    historyEl.replaceChildren(el('li', { className: 'empty', textContent: 'No scores yet. Turn the dial clockwise to add points.' }));
  } else {
    historyEl.replaceChildren(...state.history.slice(0, 200).map((h) => {
      const p = byId.get(h.playerId);
      const dot = el('span', { className: 'dot' });
      dot.style.background = p?.color ?? 'var(--muted)';
      return el('li', {}, dot,
        el('span', { className: 'hname', textContent: p?.name ?? '?' }),
        el('span', { className: `hdelta ${h.delta > 0 ? 'pos' : 'neg'}`, textContent: formatDelta(h.delta) }),
        el('span', { className: 'htotal', textContent: `= ${formatScore(h.total)}` }),
        el('span', { className: 'htime', textContent: timeFmt.format(h.ts) }));
    }));
  }
  const last = state.history[0];
  undoBtn.disabled = !last;
  undoBtn.title = last ? `Undo ${byId.get(last.playerId)?.name ?? ''} ${formatDelta(last.delta)}` : 'Nothing to undo';
}

// ---- Player editor ----

PLAYER_COLORS.forEach((c) => {
  const input = el('input', { type: 'radio', name: 'color', value: c, ariaLabel: c });
  const sw = el('span');
  sw.style.background = c;
  swatchesEl.append(el('label', {}, input, sw));
});

function openEditor(id, isNew = false) {
  const p = store.get().players.find((x) => x.id === id);
  if (!p || dialog.open) return;
  editingId = id;
  nameInput.value = p.name;
  form.elements.color.value = p.color;
  dialog.returnValue = ''; // Escape keeps the previous value otherwise
  dialog.showModal();
  if (isNew) nameInput.select();
}

dialog.addEventListener('close', () => {
  const id = editingId;
  editingId = null;
  if (!id) return;
  if (dialog.returnValue === 'save') {
    store.update(updatePlayer, id, { name: nameInput.value.trim() || 'Player', color: form.elements.color.value });
  } else if (dialog.returnValue === 'remove') {
    const p = store.get().players.find((x) => x.id === id);
    if (p && confirm(`Remove ${p.name}? Their history is deleted too.`)) store.update(removePlayer, id);
  }
});

// ---- Boot ----

function renderAll(state) {
  renderPlayers(state);
  renderPreview();
  renderHistory(state);
}

store.subscribe(renderAll);
renderAll(store.get());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
