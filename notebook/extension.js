// Notebook — notes and prompts at hand in Marinara Engine.
// A tab at the right screen edge (a button in Marinara's top bar on phones) opens a panel of note cards: a tap opens a
// long card, the sheets icon copies its text. Runs inside Marinara's page (full_page_access); the notes live in the
// extension's server storage, so every device sees the same list.

const VERSION = "0.2.1";
const NOTES_KEY = "notes"; // storage: [{ id, title, tag, text, updated }], newest first
const PHONE = window.matchMedia("(max-width: 767px)");
// Per-device choices live in this browser's localStorage, not in the shared notes storage.
const TAB_KEY = "nb-tab-at"; // the tab's top as a share of the window height
const SIZE_KEY = "nb-size"; // the panel's { w, h } in px (PC and tablet)
const PIN_KEY = "nb-pinned"; // "1" = a tap outside or Esc doesn't close the panel

// Every visible word lives here.
const T = {
  title: "Notes",
  close: "Close",
  pinOn: "Pin: a click outside won't close the panel",
  pinOff: "Unpin",
  resize: "Drag to resize; double-click for the original size",
  search: "Search",
  all: "All",
  add: "+ New note",
  more: "more ▾",
  less: "less ▴",
  edit: "Edit",
  remove: "Delete",
  removeAsk: "Delete this note?",
  cancel: "Cancel",
  save: "Save",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Couldn't copy: the text is selected, copy it by hand",
  titlePh: "Title",
  tagPh: "Tag (optional)",
  textPh: "Note text",
  empty: "No notes yet. Press “+ New note”.",
  nothing: "Nothing found.",
  loading: "Loading notes…",
  loadFailed: "Notes didn't load: {err}",
  retry: "Retry",
  saveFailed: "Not saved: {err}",
};
function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key]);
}

const ICON_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>';
// Offstage's pin, so the two panels read alike; the last path is filled while pinned (CSS).
const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 ' +
  '15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 ' +
  '0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const ICON_GRIP = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" ' +
  'aria-hidden="true"><path d="M1 2l9 9M1 6l5 5"/></svg>';

// localStorage can refuse (Safari private mode, storage full): the choice then lasts until the page reloads.
function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    marinara.log.warn(`localStorage refused to read "${key}"`, error);
    return null;
  }
}
function writeLocal(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (error) {
    marinara.log.warn(`localStorage refused to write "${key}"`, error);
  }
}
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

const state = {
  notes: [],
  loaded: false,
  loadError: null,
  query: "",
  tag: null, // null = every tag
  open: new Set(), // ids of opened cards
  long: new Set(), // ids whose text does not fit the closed card
  editing: null, // { id (null for a new note), title, tag, text }
  confirmDelete: null, // id waiting for "delete?"
  saving: false,
  saveError: null,
};

// crypto.randomUUID needs a secure context; Leah's iPad and iPhone open Marinara over plain http.
function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

// ---------- the tab, the phone button, the panel ----------

const tab = h("button", {
  type: "button",
  class: "nb-tab",
  title: T.title,
  "aria-label": T.title,
  "aria-pressed": "false",
  "data-no-intuitive-swipe": true,
  html: `${ICON_NOTE}<span>${T.title}</span>`,
  onclick: () => {
    if (performance.now() - tabDraggedAt < 400) return; // the end of a drag, not a tap
    togglePanel();
  },
});

const topBtn = h("button", {
  type: "button",
  title: T.title,
  "aria-label": T.title,
  "aria-pressed": "false",
  "data-nb-topbtn": true,
  hidden: true,
  html: ICON_NOTE,
  onclick: () => togglePanel(),
});

const searchInput = h("input", {
  class: "nb-search-input",
  type: "search",
  placeholder: T.search,
  oninput: () => {
    state.query = searchInput.value.trim().toLowerCase();
    renderList();
  },
});
const tagRow = h("div", { class: "nb-tags" });
const list = h("div", { class: "nb-list", "data-chat-floating-scroll": true });
const footError = h("div", { class: "nb-foot-error", hidden: true });
const addBtn = h("button", { type: "button", class: "nb-add", onclick: () => startEdit(null) }, T.add);
const tagOptions = h("datalist", { id: "nb-tag-options" });
const pinBtn = h("button", { type: "button", class: "nb-icon-btn nb-pin", html: ICON_PIN, onclick: () => setPinned(!pinned) });
// PC and tablet: the bottom edge changes the height, the bottom-left corner both (the panel hangs from the right).
const edgeGrip = h("div", { class: "nb-grip-edge", title: T.resize, "data-resize": "h" });
const cornerGrip = h("div", { class: "nb-grip-corner", title: T.resize, "data-resize": "wh", html: ICON_GRIP });

// data-chat-floating-panel: on touch screens Marinara keeps such a body-level panel inside the visible screen
// while the software keyboard is open (globals.css).
const panel = h(
  "aside",
  { class: "nb-panel", hidden: true, "data-chat-floating-panel": true, "data-no-intuitive-swipe": true },
  h(
    "div",
    { class: "nb-head" },
    h("span", { class: "nb-title" }, T.title),
    pinBtn,
    h("button", { type: "button", class: "nb-icon-btn", title: T.close, "aria-label": T.close, html: ICON_CLOSE, onclick: () => showPanel(false) }),
  ),
  h("label", { class: "nb-search", html: ICON_SEARCH }, searchInput),
  tagRow,
  list,
  h("div", { class: "nb-foot" }, footError, addBtn),
  tagOptions,
  edgeGrip,
  cornerGrip,
);

document.body.append(tab, panel);

function showPanel(show) {
  panel.hidden = !show;
  tab.setAttribute("aria-pressed", String(show));
  topBtn.setAttribute("aria-pressed", String(show));
  if (show) {
    applySize();
    render();
    if (!state.editing) void load();
  }
}
function togglePanel() {
  showPanel(panel.hidden);
}

// ---------- pin, a tap outside (Leah 22.11, the same rules as Offstage's panel) ----------

let pinned = readLocal(PIN_KEY) === "1";
function setPinned(on) {
  pinned = on;
  writeLocal(PIN_KEY, on ? "1" : "0");
  paintPin();
}
function paintPin() {
  const label = pinned ? T.pinOff : T.pinOn;
  pinBtn.setAttribute("aria-pressed", String(pinned));
  pinBtn.setAttribute("aria-label", label);
  pinBtn.title = label;
}
paintPin();

// A tap outside closes an unpinned panel (an open form stays as typed until the next opening). That tap only closes:
// the click that follows doesn't reach the chat, so a button under the tap isn't pressed by accident. Taps on the top
// bar and on Offstage's tab and panel go through: there the tap is meant for what was hit.
let swallowClickUntil = 0;
function onOutsidePointer(event) {
  if (panel.hidden || pinned) return;
  const target = event.target;
  if (!(target instanceof Node) || !target.isConnected) return;
  for (const node of [panel, tab, topBtn]) if (node.contains(target)) return;
  showPanel(false);
  const hit = target instanceof Element ? target : target.parentElement;
  if (!hit || !hit.closest(".mari-topbar, .kulisy-tab, .kulisy-panel")) swallowClickUntil = Date.now() + 700;
}
function onSwallowClick(event) {
  if (Date.now() > swallowClickUntil) return;
  swallowClickUntil = 0;
  event.preventDefault();
  event.stopPropagation();
}

// ---------- the tab's place on the edge (Leah 22.11: Offstage's tab covered it on a low window) ----------

// Dragged up or down the edge; each device keeps its place. At rest it never lies over Offstage's tab.
let tabAt = Number.parseFloat(readLocal(TAB_KEY)); // NaN = never dragged: the default 60% of the window
let tabDrag = null;
let tabDraggedAt = -Infinity;
let offstageTab = null;

function placeTab() {
  const height = tab.offsetHeight;
  if (!height) return; // not shown (phone)
  const max = window.innerHeight - height - 8;
  let top = clamp((Number.isFinite(tabAt) ? tabAt : 0.6) * window.innerHeight, 8, max);
  offstageTab = document.querySelector(".kulisy-tab");
  if (offstageTab) {
    const r = offstageTab.getBoundingClientRect();
    const gap = 6;
    if (r.height && top < r.bottom + gap && top + height + gap > r.top) {
      top = r.bottom + gap <= max ? r.bottom + gap : Math.max(8, r.top - gap - height);
    }
  }
  tab.style.top = `${Math.round(top)}px`;
}

tab.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  tabDrag = { id: event.pointerId, y0: event.clientY, top0: tab.getBoundingClientRect().top, moved: false };
  tab.setPointerCapture(event.pointerId);
});
tab.addEventListener("pointermove", (event) => {
  if (!tabDrag || event.pointerId !== tabDrag.id) return;
  const dy = event.clientY - tabDrag.y0;
  if (!tabDrag.moved && Math.abs(dy) < 5) return;
  tabDrag.moved = true;
  tab.classList.add("is-dragging");
  tab.style.top = `${Math.round(clamp(tabDrag.top0 + dy, 8, window.innerHeight - tab.offsetHeight - 8))}px`;
});
function endTabDrag(event) {
  if (!tabDrag || event.pointerId !== tabDrag.id) return;
  const moved = tabDrag.moved;
  tabDrag = null;
  tab.classList.remove("is-dragging");
  if (!moved) return;
  tabDraggedAt = performance.now();
  tabAt = tab.getBoundingClientRect().top / window.innerHeight;
  writeLocal(TAB_KEY, String(tabAt));
  placeTab();
}
tab.addEventListener("pointerup", endTabDrag);
tab.addEventListener("pointercancel", endTabDrag);

// ---------- the panel's size (PC and tablet) ----------

const MIN_W = 300;
const MIN_H = 240;
let size = readSize();
function readSize() {
  const raw = readLocal(SIZE_KEY);
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw);
    if (Number.isFinite(s.w) && Number.isFinite(s.h)) return s;
  } catch (error) {
    marinara.log.warn(`Ignoring a broken "${SIZE_KEY}"`, error);
    return null;
  }
  marinara.log.warn(`Ignoring a broken "${SIZE_KEY}": ${raw}`);
  return null;
}
// CSS max-width / max-height keep a remembered size inside a smaller window.
function applySize() {
  const on = size && !PHONE.matches;
  panel.style.width = on ? `${size.w}px` : "";
  panel.style.height = on ? `${size.h}px` : "";
}

let resize = null;
function onGripDown(event) {
  if (event.button !== 0) return;
  const r = panel.getBoundingClientRect();
  resize = { id: event.pointerId, mode: event.currentTarget.dataset.resize, x0: event.clientX, y0: event.clientY, w0: r.width, h0: r.height };
  event.currentTarget.setPointerCapture(event.pointerId);
  panel.classList.add("is-resizing");
  event.preventDefault();
}
function onGripMove(event) {
  if (!resize || event.pointerId !== resize.id) return;
  const r = panel.getBoundingClientRect();
  const w = resize.mode === "wh" ? clamp(resize.w0 - (event.clientX - resize.x0), MIN_W, r.right - 8) : resize.w0;
  const hgt = clamp(resize.h0 + (event.clientY - resize.y0), MIN_H, window.innerHeight - r.top - 8);
  size = { w: Math.round(w), h: Math.round(hgt) };
  applySize();
}
function onGripUp(event) {
  if (!resize || event.pointerId !== resize.id) return;
  resize = null;
  panel.classList.remove("is-resizing");
  if (size) writeLocal(SIZE_KEY, JSON.stringify(size));
  measure();
}
function onGripReset() {
  size = null;
  writeLocal(SIZE_KEY, null);
  applySize();
  measure();
}
for (const grip of [edgeGrip, cornerGrip]) {
  grip.addEventListener("pointerdown", onGripDown);
  grip.addEventListener("pointermove", onGripMove);
  grip.addEventListener("pointerup", onGripUp);
  grip.addEventListener("pointercancel", onGripUp);
  grip.addEventListener("dblclick", onGripReset);
}

// Phone (< 768): a tab at the screen edge gets in the way of the chat (Offstage, Leah 10.10) — a button in Marinara's
// top bar instead, right after Offstage's curtain button when it is there. Marinara redraws the bar now and then.
function ensureTopButton() {
  const nav = document.querySelector(".mari-topbar .mari-topbar-panel-nav");
  if (!nav || !PHONE.matches) {
    if (topBtn.isConnected) topBtn.remove();
    return;
  }
  // a neighbouring Marinara button's look (size, rounding) without its panel colours and its "hidden on phones"
  // Our mark is an attribute, not a class: Offstage copies a neighbour's classes onto its own button the same way.
  const sib = nav.querySelector(".mari-topbar-action:not([data-nb-topbtn]):not(.kulisy-topbtn):not(.cl-spark)");
  const cls = sib ? sib.className.replace(/\s*(mari-panel-gradient--\S+|mari-topbar-panel-icon|max-sm:hidden|sm:hidden|ml-auto)/g, "") : "mari-topbar-action";
  if (topBtn.className !== cls) topBtn.className = cls;
  const after = nav.querySelector(":scope > .kulisy-topbtn") || nav.querySelector(":scope > .cl-spark");
  if (after) {
    if (after.nextElementSibling !== topBtn) after.after(topBtn);
  } else if (nav.firstElementChild !== topBtn) nav.prepend(topBtn);
  if (topBtn.hidden) topBtn.hidden = false;
}

// ---------- storage ----------

async function load() {
  try {
    const stored = await marinara.storage.get();
    const notes = stored[NOTES_KEY];
    if (notes !== undefined && !Array.isArray(notes)) throw new Error(`storage "${NOTES_KEY}" is not a list`);
    if (state.editing) return; // a form is open: keep what is on screen, the next opening reloads
    state.notes = notes || [];
    state.loaded = true;
    state.loadError = null;
  } catch (error) {
    marinara.log.error("Could not load the notes", error);
    state.loadError = error.message;
  }
  render();
}

// Saving is refused until the first load succeeded: an empty list saved over the stored one would wipe every note.
async function persist(next) {
  if (!state.loaded) throw new Error("notes were never loaded");
  state.saving = true;
  state.saveError = null;
  renderFoot();
  try {
    await marinara.storage.patch({ [NOTES_KEY]: next });
    state.notes = next;
    return true;
  } catch (error) {
    marinara.log.error("Could not save the notes", error);
    state.saveError = fill(T.saveFailed, { err: error.message });
    return false;
  } finally {
    state.saving = false;
  }
}

// ---------- editing ----------

function startEdit(id) {
  const note = id ? state.notes.find((n) => n.id === id) : null;
  state.editing = { id, title: note ? note.title : "", tag: note ? note.tag : state.tag || "", text: note ? note.text : "" };
  state.confirmDelete = null;
  state.saveError = null;
  render();
  const form = list.querySelector(".nb-form");
  form.scrollIntoView({ block: "nearest" });
  form.querySelector(id ? ".nb-form-text" : ".nb-form-title").focus({ preventScroll: true });
}

function cancelEdit() {
  state.editing = null;
  state.saveError = null;
  render();
}

async function saveEdit() {
  const e = state.editing;
  const text = e.text.replace(/\s+$/, "");
  if (!text.trim() || state.saving) return;
  const note = { id: e.id || newId(), title: e.title.trim(), tag: e.tag.trim(), text, updated: Date.now() };
  const next = e.id ? state.notes.map((n) => (n.id === e.id ? note : n)) : [note, ...state.notes];
  if (await persist(next)) {
    state.editing = null;
    state.open.add(note.id);
    if (state.tag && note.tag !== state.tag) state.tag = note.tag || null;
  }
  render();
}

async function removeNote(id) {
  if (state.saving) return;
  if (await persist(state.notes.filter((n) => n.id !== id))) {
    state.open.delete(id);
    state.long.delete(id);
    state.confirmDelete = null;
  }
  render();
}

// ---------- copying ----------

// The Clipboard API exists only in a secure context (https or localhost); over http (Leah's iPad and iPhone at
// totoro.lan) the copy goes through a selected hidden field, synchronously inside the tap.
function copyText(text) {
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      (error) => {
        marinara.log.warn("Clipboard API refused the copy, trying a selection copy", error);
        return copyBySelection(text);
      },
    );
  }
  return Promise.resolve(copyBySelection(text));
}
function copyBySelection(text) {
  const area = h("textarea", { readonly: true, class: "nb-copy-area" });
  area.value = text;
  document.body.append(area);
  area.focus({ preventScroll: true });
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (error) {
    marinara.log.warn("Selection copy failed", error);
  }
  area.remove();
  return ok;
}

const flashTimers = new Map();
async function onCopy(note, card) {
  const ok = await copyText(note.text);
  if (!ok) {
    // let her copy it by hand: open the card and select its text
    state.open.add(note.id);
    card.classList.add("open");
    const range = document.createRange();
    range.selectNodeContents(card.querySelector(".nb-body"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  card.classList.toggle("copied", ok);
  card.classList.toggle("copy-failed", !ok);
  card.querySelector(".nb-toast").textContent = ok ? T.copied : T.copyFailed;
  card.querySelector(".nb-copy").innerHTML = ok ? ICON_CHECK : ICON_COPY;
  if (flashTimers.has(note.id)) marinara.clearTimeout(flashTimers.get(note.id));
  flashTimers.set(
    note.id,
    marinara.setTimeout(() => {
      flashTimers.delete(note.id);
      card.classList.remove("copied", "copy-failed");
      card.querySelector(".nb-copy").innerHTML = ICON_COPY;
    }, ok ? 1200 : 4000),
  );
}

// ---------- rendering ----------

function render() {
  renderTags();
  renderList();
  renderFoot();
}

function allTags() {
  return [...new Set(state.notes.map((n) => n.tag).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function renderTags() {
  const tags = allTags();
  if (state.tag && !tags.includes(state.tag)) state.tag = null;
  tagRow.replaceChildren(
    ...[null, ...tags].map((tag) =>
      h("button", {
        type: "button",
        class: "nb-tag" + (state.tag === tag ? " on" : ""),
        "aria-pressed": String(state.tag === tag),
        onclick: () => {
          state.tag = tag;
          render();
        },
      }, tag === null ? T.all : tag),
    ),
  );
  tagRow.hidden = tags.length === 0;
  tagOptions.replaceChildren(...tags.map((tag) => h("option", { value: tag })));
}

function visibleNotes() {
  const q = state.query;
  return state.notes.filter(
    (n) =>
      (!state.tag || n.tag === state.tag) &&
      (!q || n.title.toLowerCase().includes(q) || n.tag.toLowerCase().includes(q) || n.text.toLowerCase().includes(q)),
  );
}

function renderList() {
  if (!state.loaded) {
    list.replaceChildren(
      state.loadError
        ? h("div", { class: "nb-empty nb-error" }, fill(T.loadFailed, { err: state.loadError }), " ",
            h("button", { type: "button", class: "nb-link", onclick: () => void load() }, T.retry))
        : h("div", { class: "nb-empty" }, T.loading),
    );
    return;
  }
  const cards = [];
  if (state.editing && !state.editing.id) cards.push(formCard());
  for (const note of visibleNotes()) cards.push(state.editing && state.editing.id === note.id ? formCard() : noteCard(note));
  if (!cards.length) cards.push(h("div", { class: "nb-empty" }, state.notes.length ? T.nothing : T.empty));
  list.replaceChildren(...cards);
  if (!panel.hidden) measure();
}

function renderFoot() {
  const err = state.saveError || (state.loaded && state.loadError ? fill(T.loadFailed, { err: state.loadError }) : null);
  footError.textContent = err || "";
  footError.hidden = !err;
  addBtn.disabled = !state.loaded || !!state.editing;
  for (const btn of list.querySelectorAll(".nb-save")) btn.disabled = state.saving || !state.editing || !state.editing.text.trim();
}

function noteCard(note) {
  const isOpen = state.open.has(note.id);
  const askDelete = state.confirmDelete === note.id;
  const card = h(
    "div",
    { class: "nb-card" + (isOpen ? " open" : "") + (state.long.has(note.id) ? " long" : ""), "data-note-id": note.id },
    note.title || note.tag
      ? h("div", { class: "nb-name" },
          note.title ? h("span", {}, note.title) : null,
          note.tag ? h("span", { class: "nb-name-tag" }, (note.title ? "· " : "") + note.tag) : null)
      : null,
    h("div", { class: "nb-body" }, note.text),
    h("div", { class: "nb-more" }, isOpen ? T.less : T.more),
    askDelete
      ? h("div", { class: "nb-actions" },
          h("span", { class: "nb-ask" }, T.removeAsk),
          h("button", { type: "button", class: "nb-btn nb-danger", onclick: () => void removeNote(note.id) }, T.remove),
          h("button", { type: "button", class: "nb-btn", onclick: () => { state.confirmDelete = null; renderList(); } }, T.cancel))
      : h("div", { class: "nb-actions" },
          h("button", { type: "button", class: "nb-btn", onclick: () => startEdit(note.id) }, T.edit),
          h("button", { type: "button", class: "nb-btn", onclick: () => { state.confirmDelete = note.id; renderList(); } }, T.remove)),
    h("span", { class: "nb-toast", "aria-live": "polite" }),
    h("button", { type: "button", class: "nb-copy", title: T.copy, "aria-label": T.copy, html: ICON_COPY }),
  );
  // stopPropagation: the icon swap can detach the clicked node before the card's own click handler sees it
  card.querySelector(".nb-copy").addEventListener("click", (event) => {
    event.stopPropagation();
    void onCopy(note, card);
  });
  card.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    // selecting text inside an open card is not a tap
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && card.contains(sel.anchorNode)) return;
    if (state.open.has(note.id)) state.open.delete(note.id);
    else state.open.add(note.id);
    if (state.confirmDelete === note.id) state.confirmDelete = null;
    renderList();
  });
  return card;
}

function formCard() {
  const e = state.editing;
  const grow = (area) => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight + 2}px`;
  };
  const text = h("textarea", {
    class: "nb-in nb-form-text",
    rows: 4,
    placeholder: T.textPh,
    oninput: () => {
      e.text = text.value;
      grow(text);
      renderFoot();
    },
  });
  text.value = e.text;
  const card = h(
    "div",
    { class: "nb-card nb-form" },
    h("input", { class: "nb-in nb-form-title", placeholder: T.titlePh, value: e.title, oninput: (ev) => { e.title = ev.target.value; } }),
    h("input", { class: "nb-in nb-form-tag", placeholder: T.tagPh, value: e.tag, list: "nb-tag-options", oninput: (ev) => { e.tag = ev.target.value; } }),
    text,
    h("div", { class: "nb-actions" },
      h("button", { type: "button", class: "nb-btn nb-primary nb-save", disabled: state.saving || !e.text.trim(), onclick: () => void saveEdit() }, T.save),
      h("button", { type: "button", class: "nb-btn", onclick: cancelEdit }, T.cancel)),
  );
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void saveEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    }
  });
  requestAnimationFrame(() => grow(text));
  return card;
}

// A closed card shows three lines (CSS clamp); a card whose text is longer gets "more". Measured only while visible.
function measure() {
  requestAnimationFrame(() => {
    for (const card of list.querySelectorAll(".nb-card[data-note-id]")) {
      if (card.classList.contains("open")) continue;
      const body = card.querySelector(".nb-body");
      const isLong = body.scrollHeight > body.clientHeight + 1;
      card.classList.toggle("long", isLong);
      if (isLong) state.long.add(card.dataset.noteId);
      else state.long.delete(card.dataset.noteId);
    }
  });
}

// ---------- page events ----------

// Keys typed in the panel stay in the panel: Marinara's own shortcuts listen on the document.
panel.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !state.editing && !pinned) {
    showPanel(false);
    (PHONE.matches ? topBtn : tab).focus({ preventScroll: true });
  }
  event.stopPropagation();
});
// Escape right after opening (focus still on the tab or nowhere); in Marinara's own fields Escape stays Marinara's.
function onDocEscape(event) {
  if (event.key !== "Escape" || panel.hidden || pinned) return;
  const target = event.target;
  if (target === document.body || target === tab || target === topBtn) showPanel(false);
}
document.addEventListener("keydown", onDocEscape);
document.addEventListener("pointerdown", onOutsidePointer, true);
document.addEventListener("click", onSwallowClick, true);

// Marinara redraws its top bar now and then; Offstage puts its tab in later than this script runs.
let topBarFrame = 0;
const observer = new MutationObserver(() => {
  if (topBarFrame) return;
  topBarFrame = requestAnimationFrame(() => {
    topBarFrame = 0;
    if (PHONE.matches !== topBtn.isConnected || (PHONE.matches && !topBtn.parentElement.matches(".mari-topbar-panel-nav"))) ensureTopButton();
    if (document.querySelector(".kulisy-tab") !== offstageTab) placeTab();
  });
});
observer.observe(document.body, { childList: true, subtree: true });

function onPhoneChange() {
  ensureTopButton();
  applySize();
  placeTab();
  if (!panel.hidden) measure();
}
PHONE.addEventListener("change", onPhoneChange);

function onResize() {
  placeTab();
  if (!panel.hidden) measure();
}
window.addEventListener("resize", onResize);

ensureTopButton();
placeTab();

marinara.onCleanup(() => {
  observer.disconnect();
  if (topBarFrame) cancelAnimationFrame(topBarFrame);
  PHONE.removeEventListener("change", onPhoneChange);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("keydown", onDocEscape);
  document.removeEventListener("pointerdown", onOutsidePointer, true);
  document.removeEventListener("click", onSwallowClick, true);
  tab.remove();
  topBtn.remove();
  panel.remove();
});

marinara.log.info(`Notebook ${VERSION} loaded`);
