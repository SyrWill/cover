"use strict";

const $ = (sel) => document.querySelector(sel);
const grid = $("#grid");
const listsView = $("#listsView");
const ctx = $("#ctx");
const listCtx = $("#listCtx");
const ddMenu = $("#ddMenu");
const hovercard = $("#hovercard");

const state = {
  items: [],
  selected: null,
  sort: "added",          // Library sorting (saved)
  listSort: "list",       // sorting inside an open list
  listsSort: "updated",   // the Lists page
  query: "",
  filters: { rating: null, decade: null, genre: null },
  show: "all",            // eye menu: all | watched | unwatched
  showTitles: false,      // titles under the posters
  coverTarget: null,
  selecting: false,       // selection mode: pick several movies for bulk actions
  picked: new Set(),
  lastPicked: null,       // anchor for Shift + click ranges
  missingOnly: false,
  view: "library",        // "library" | "lists" | "list" (one open list)
  listId: null,
  lists: [],
};

const currentList = () => state.lists.find((l) => l.id === state.listId);

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  stack: '<svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
  chevron: '<svg class="chev" viewBox="0 0 24 24"><path d="m12 15.7-6-6 1.4-1.4 4.6 4.6 4.6-4.6L18 9.7z"/></svg>',
};

// Offered in the genre pickers next to the ones already in your library.
const COMMON_GENRES = ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family",
  "Fantasy", "History", "Horror", "Music", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western"];

// ---------------------------------------------------------------- api

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  if (data.lists) state.lists = data.lists;
  if (data.library) setItems(data.library);
  else if (data.lists) render();
  return data;
}

function setItems(items) {
  state.items = items;
  if (state.view === "list" && !currentList()) state.view = "lists";
  if (state.selected && !items.some((i) => i.id === state.selected)) state.selected = null;
  if (state.missingOnly && items.every((i) => i.exists)) state.missingOnly = false;
  render();
  queueAutoThumbs();
}

// ---------------------------------------------------------------- formatting

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function fmtRuntime(sec) {
  if (!sec || !isFinite(sec)) return "";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60), h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

function fmtSize(bytes) {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

function timeAgo(ts) {
  const diff = Date.now() / 1000 - ts;
  const steps = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [secs, name] of steps) {
    const n = Math.floor(diff / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

// A steady colour per title for posters that have no art yet.
function hue(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// Ratings are stored as 1..10 half stars.
const starsHtml = (v) => `<span class="stars" style="--v:${v || 0}" aria-label="${v ? `${v / 2} stars` : "Not rated"}"><i></i></span>`;
const starsText = (v) => "★".repeat(Math.floor(v / 2)) + (v % 2 ? "½" : "");

// "The Thing" sorts under T, "A Quiet Place" under Q.
const sortTitle = (t) => t.replace(/^(the|a|an)\s+/i, "");
const byTitle = (a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title), undefined, { numeric: true, sensitivity: "base" });

// ---------------------------------------------------------------- filters and sorting

const SORTS = [
  ["added", "Recently added"],
  ["title", "Title"],
  ["year-new", "Release date, newest"],
  ["year-old", "Release date, oldest"],
  ["director", "Director"],
  ["rating", "Your rating"],
  ["played", "Recently played"],
  ["length", "Length"],
];
const LIST_SORTS = [["list", "Collection order"], ...SORTS];
const LISTS_SORTS = [
  ["updated", "Recently updated"],
  ["created", "Newest collections"],
  ["name", "Name"],
  ["size", "Most films"],
  ["played", "Recently played"],
];
const RATINGS = [[10, "★★★★★"], [8, "★★★★ and up"], [6, "★★★ and up"], [4, "★★ and up"], [2, "★ and up"], ["unrated", "Not rated"]];
const SHOWS = [["all", "All movies"], ["watched", "Watched"], ["unwatched", "Not watched yet"]];

const sortKey = () => (state.view === "list" ? state.listSort : state.sort);
const genresOf = (i) => i.genres || [];
// By director's name as you typed it, each director's films oldest first; movies without one last.
const byDirector = (a, b) => (!a.director - !b.director) ||
  (a.director || "").localeCompare(b.director || "", undefined, { sensitivity: "base" }) ||
  (a.year || 9999) - (b.year || 9999) || byTitle(a, b);
const sameText = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;

function matchesFilters(i, skip) {
  const { rating, decade, genre } = state.filters;
  if (skip !== "rating" && rating != null && (rating === "unrated" ? i.rating : (i.rating || 0) < rating)) return false;
  if (skip !== "decade" && decade != null && (decade === "none" ? i.year : !i.year || Math.floor(i.year / 10) * 10 !== decade)) return false;
  if (skip !== "genre" && genre != null && (genre === "none" ? genresOf(i).length : !genresOf(i).some((g) => sameText(g, genre)))) return false;
  if (state.show === "watched" && !i.watched) return false;
  if (state.show === "unwatched" && i.watched) return false;
  return true;
}

// The movies in view (library or the open list), before filters: used for counts in the menus.
function baseItems() {
  const lst = state.view === "list" && currentList();
  const q = state.query.toLowerCase();
  return state.items.filter((i) =>
    (!lst || lst.films.includes(i.id)) &&
    (!state.missingOnly || !i.exists) &&
    (!q || `${i.title} ${i.year || ""} ${i.director || ""} ${genresOf(i).join(" ")} ${i.path}`.toLowerCase().includes(q)));
}

function visibleItems() {
  const lst = state.view === "list" && currentList();
  const order = lst ? new Map(lst.films.map((id, n) => [id, n])) : null;
  const by = {
    list: (a, b) => order.get(a.id) - order.get(b.id),
    added: (a, b) => b.added - a.added,
    title: byTitle,
    "year-new": (a, b) => (b.year || -1) - (a.year || -1) || byTitle(a, b),
    "year-old": (a, b) => (a.year || 9999) - (b.year || 9999) || byTitle(a, b),
    director: byDirector,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || byTitle(a, b),
    played: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || b.added - a.added,
    length: (a, b) => (b.duration || 0) - (a.duration || 0) || byTitle(a, b),
  }[sortKey()] || ((a, b) => b.added - a.added);
  return baseItems().filter((i) => matchesFilters(i)).sort(by);
}

const filtering = () => !!(state.query || state.missingOnly || state.show !== "all" || state.selecting ||
  Object.values(state.filters).some((v) => v != null));

// ---------------------------------------------------------------- posters

const posterUrl = (item) => `/posters/${encodeURIComponent(item.cover)}`;

// The real poster, or a title card (over a frame from the movie when there is one).
function posterArt(item) {
  if (item.cover && !item.coverAuto) return `<img src="${posterUrl(item)}" alt="" draggable="false" loading="lazy" decoding="async">`;
  const waiting = !item.cover && item.exists && !item.autoTried && !thumbTried.has(item.id);
  return `<div class="art ${item.cover ? "frame" : ""} ${waiting ? "loading" : ""}" style="--h:${hue(item.title)}">
      ${item.cover ? `<img src="${posterUrl(item)}" alt="" draggable="false" loading="lazy" decoding="async">` : ""}
      <div class="art-title">${esc(item.title)}</div>${item.year ? `<div class="art-year">${item.year}</div>` : ""}
    </div>`;
}

function cardHtml(item) {
  const caption = state.showTitles ? `
      <div class="caption">
        <h3 class="title">${esc(item.title)}</h3>
        <div class="sub">${item.year ? `<span>${item.year}</span>` : ""}${item.rating ? starsHtml(item.rating) : ""}</div>
      </div>` : "";
  return `
    <article class="card ${item.exists ? "" : "is-missing"}" data-id="${item.id}">
      <div class="poster">
        ${posterArt(item)}
        <span class="pick" aria-hidden="true">${ICONS.check}</span>
        ${item.watched ? `<span class="seen" title="Watched">${ICONS.eye}</span>` : ""}
        ${item.exists ? "" : `<span class="badge missing" data-action="locate" title="Click to locate the file">File not found</span>`}
        <button class="play-btn" data-action="play" aria-label="Play" title="Play">${ICONS.play}</button>
      </div>${caption}
    </article>`;
}

const elementFrom = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

// Cards are reused while their content is unchanged, so a re-render never
// reloads images or restarts hover effects on the card under the mouse.
const cardCache = new Map(); // id -> { html, el }
let addCardEl = null;

// ---------------------------------------------------------------- motion
// Small, quick animations so the shelf feels alive: posters slide to their new place when
// sorting or filtering, new ones pop in, removed ones fade out, menus drop down.
// Only what is on screen moves, and nothing moves when Windows has animations turned off.

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const EASE_OUT = "cubic-bezier(.2, .8, .2, 1)";
const ENTER = [
  { opacity: 0, transform: "translateY(10px) scale(.94)" },
  { opacity: 1, transform: "none" },
];
const POP_IN = [
  { opacity: 0, transform: "scale(.86)" },
  { opacity: 1, transform: "scale(1.02)", offset: .7 },
  { opacity: 1, transform: "none" },
];
let viewEntering = false; // go() animates the whole view instead

const motionOn = () => !reduceMotion.matches && !document.hidden;
const onScreen = (r) => r.width > 0 && r.bottom > 0 && r.top < innerHeight;
const stopMotion = (el) => el.getAnimations().forEach((a) => a.cancel());

// Menus and popups: a quick drop from the button that opened them.
function popIn(el, from = "top") {
  if (!motionOn()) return;
  el.style.transformOrigin = from;
  el.animate([{ opacity: 0, transform: "translateY(-6px) scale(.97)" }, { opacity: 1, transform: "none" }],
    { duration: 170, easing: EASE_OUT });
}

// A view coming in: its header, then its cards one after another.
function enterView() {
  if (!motionOn()) return;
  const box = state.view === "lists" ? listsView : grid;
  const head = state.view === "list" ? $("#listHeader") : $("#sectionBar");
  head.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }],
    { duration: 260, easing: EASE_OUT });
  let n = 0;
  for (const el of box.children) {
    const r = el.getBoundingClientRect();
    if (r.top > innerHeight) break;
    if (!onScreen(r)) continue;
    stopMotion(el);
    el.animate(ENTER, { duration: 320, delay: Math.min(n++, 18) * 18, easing: EASE_OUT, fill: "backwards" });
  }
}

// Puts nodes into a container, leaving the DOM alone when nothing moved. Cards that stay
// slide from where they were (FLIP), new ones pop in, and the ones that leave fade out.
function placeNodes(container, nodes) {
  const current = [...container.children].filter((el) => !el.classList.contains("ghost"));
  if (current.length === nodes.length && nodes.every((n, i) => current[i] === n)) return;
  const animate = motionOn() && !viewEntering && !container.hidden;
  const before = new Map();
  if (animate) {
    for (const el of current) {
      const r = el.getBoundingClientRect();
      if (onScreen(r)) before.set(el, r);
    }
  }
  container.replaceChildren(...nodes);
  if (!animate) return;

  const box = container.getBoundingClientRect();
  const kept = new Set(nodes);
  for (const [el, r] of before) {
    if (kept.has(el) || !el.classList.contains("card")) continue;
    // A copy of the leaving card fades out where it was.
    const ghost = el.cloneNode(true);
    ghost.classList.add("ghost");
    ghost.classList.remove("selected", "picked");
    ghost.querySelectorAll("[data-id], [data-lid], [data-action], [data-list]").forEach((x) => {
      delete x.dataset.id; delete x.dataset.lid; delete x.dataset.action; delete x.dataset.list;
    });
    delete ghost.dataset.id; delete ghost.dataset.lid; delete ghost.dataset.action; delete ghost.dataset.list;
    Object.assign(ghost.style, {
      left: `${r.left - box.left}px`, top: `${r.top - box.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    });
    container.append(ghost);
    ghost.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.9)" }],
      { duration: 180, easing: "ease-in", fill: "forwards" }).finished.then(() => ghost.remove(), () => ghost.remove());
    setTimeout(() => ghost.remove(), 400); // even if the window stops drawing (minimized)
  }

  let entering = 0;
  for (const el of nodes) {
    const was = before.get(el);
    stopMotion(el);
    const r = el.getBoundingClientRect();
    if (!onScreen(r)) continue;
    if (was) {
      const dx = was.left - r.left, dy = was.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 340, easing: EASE_OUT });
    } else if (el.classList.contains("card")) {
      el.animate(POP_IN, { duration: 340, delay: Math.min(entering++, 14) * 22, easing: EASE_OUT, fill: "backwards" });
    } else {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
  }
}

// ---------------------------------------------------------------- render

function render() {
  document.body.dataset.view = state.view;
  const tab = state.view === "list" ? "lists" : state.view;
  document.querySelectorAll(".view-tabs [data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === tab));
  $("#search").placeholder = state.view === "lists" ? "Search collections" : state.view === "list" ? "Search this collection" : "Search movies";
  grid.hidden = state.view === "lists";
  listsView.hidden = state.view !== "lists";
  renderListHeader();
  renderFilters();
  if (state.view === "lists") {
    $("#sectionTitle").textContent = "Collections";
    $("#missingChip").hidden = true;
    renderLists();
    return updateMenu();
  }

  const items = visibleItems();
  const nodes = items.map((item) => {
    const html = cardHtml(item);
    let cached = cardCache.get(item.id);
    if (!cached || cached.html !== html) {
      cached = { html, el: elementFrom(html) };
      cardCache.set(item.id, cached);
    }
    cached.el.classList.toggle("selected", !state.selecting && item.id === state.selected);
    cached.el.classList.toggle("picked", state.picked.has(item.id));
    return cached.el;
  });
  for (const id of cardCache.keys()) if (!state.items.some((i) => i.id === id)) cardCache.delete(id);
  // Bulk actions only touch what you can see.
  const visible = new Set(items.map((i) => i.id));
  for (const id of state.picked) if (!visible.has(id)) state.picked.delete(id);

  addCardEl ||= elementFrom(`
    <article class="card add-card" data-action="add">
      <div class="poster"><div class="plus">${ICONS.plus}</div><span>Add movie</span></div>
    </article>`);
  if (!filtering()) nodes.push(addCardEl);
  const inList = state.view === "list";
  if (inList && !currentList()?.films.length) {
    nodes.push(elementFrom(`<p class="empty">This collection is empty.<br>In the <b>Library</b>, right-click a poster → <b>Add to collection</b>, or <b>Select</b> several movies → <b>Add to collection</b>.<br>Movies you add here with <b>+</b> go straight into it.</p>`));
  } else if (!state.items.length) {
    nodes.push(elementFrom(`<p class="empty">Your shelf is empty.<br>Click <b>Add movie</b> or <b>Add folder</b> to bring in the movies on your drives.</p>`));
  } else if (!items.length) {
    nodes.push(elementFrom(`<p class="empty">No movies match${state.query ? ` “${esc(state.query)}”` : " these filters"}.</p>`));
  }
  placeNodes(grid, nodes);

  const n = inList ? currentList()?.films.length ?? 0 : state.items.length;
  $("#count").textContent = items.length < n ? `${items.length} of ${plural(n, "movie")}` : plural(n, "movie");
  $("#sectionTitle").textContent = { watched: "Watched", unwatched: "Not watched yet" }[state.show] || (inList ? "Films" : "All movies");
  const missing = state.items.filter((i) => !i.exists).length;
  const missingChip = $("#missingChip");
  missingChip.hidden = !missing;
  missingChip.classList.toggle("active", state.missingOnly);
  missingChip.textContent = `Missing files (${missing})`;
  updateMenu();
}

// The filter buttons in the section bar show what is picked.
function renderFilters() {
  const label = (btn, name, value, clearable) => {
    btn.classList.toggle("on", value != null && clearable);
    btn.innerHTML = `${esc(name)}${value != null ? `&nbsp;<b>${esc(value)}</b>` : ""}${clearable && value != null
      ? `<span class="clear" data-clear title="Clear">×</span>` : ICONS.chevron}`;
  };
  const f = state.filters;
  const btn = (k) => document.querySelector(`.filter[data-menu="${k}"]`);
  label(btn("rating"), "Rating", f.rating == null ? null : f.rating === "unrated" ? "none" : `${starsText(f.rating)}${f.rating < 10 ? "+" : ""}`, true);
  label(btn("decade"), "Decade", f.decade == null ? null : f.decade === "none" ? "no year" : `${f.decade}s`, true);
  label(btn("genre"), "Genre", f.genre == null ? null : f.genre === "none" ? "none" : f.genre, true);
  const sorts = state.view === "list" ? LIST_SORTS : SORTS;
  label(btn("sort"), "Sort by", sorts.find(([k]) => k === sortKey())?.[1] ?? "", false);
  label(btn("listsort"), "Sort by", LISTS_SORTS.find(([k]) => k === state.listsSort)?.[1] ?? "", false);
  const eye = btn("show");
  eye.classList.toggle("on", state.show !== "all");
  eye.innerHTML = `${ICONS.eye}${ICONS.chevron}`;
  eye.title = `Show: ${SHOWS.find(([k]) => k === state.show)[1]}`;
}

// ---------------------------------------------------------------- dropdown menus (filters, sorting, show)

let openMenuKind = null;

function openMenu(kind, anchor) {
  const item = (value, label, active, count) => `
    <button class="dd-item ${active ? "active" : ""}" data-pick="${esc(value)}">
      <span class="dd-name">${label}</span>${count == null ? "" : `<span class="dd-count">${count}</span>`}
      ${active ? ICONS.check.replace("<svg", '<svg class="dd-check"') : ""}
    </button>`;
  const f = state.filters;
  const pool = baseItems();
  const count = (skip, test) => pool.filter((i) => matchesFilters(i, skip) && test(i)).length;
  let html = "";

  if (kind === "rating") {
    html = `<h4>Your rating</h4>${item("", "Any rating", f.rating == null)}<hr>` + RATINGS.map(([v, label]) =>
      item(v, v === "unrated" ? label : `<span class="stars-label">${label}</span>`, f.rating === v,
        count("rating", (i) => (v === "unrated" ? !i.rating : (i.rating || 0) >= v)))).join("");
  } else if (kind === "decade") {
    const decades = [...new Set(pool.filter((i) => i.year).map((i) => Math.floor(i.year / 10) * 10))].sort((a, b) => b - a);
    html = `<h4>Decade</h4>${item("", "Any decade", f.decade == null)}<hr>` +
      decades.map((d) => item(d, `${d}s`, f.decade === d, count("decade", (i) => i.year && Math.floor(i.year / 10) * 10 === d))).join("") +
      item("none", "No year", f.decade === "none", count("decade", (i) => !i.year)) +
      (decades.length ? "" : `<p class="dd-empty">Add release years in <b>Edit details</b> to browse by decade.</p>`);
  } else if (kind === "genre") {
    const names = new Map();
    for (const i of pool) for (const g of genresOf(i)) if (![...names.keys()].some((n) => sameText(n, g))) names.set(g, true);
    const sorted = [...names.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    html = `<h4>Genre</h4>${item("", "Any genre", f.genre == null)}<hr>` +
      sorted.map((g) => item(g, esc(g), f.genre != null && f.genre !== "none" && sameText(f.genre, g),
        count("genre", (i) => genresOf(i).some((x) => sameText(x, g))))).join("") +
      item("none", "No genre", f.genre === "none", count("genre", (i) => !genresOf(i).length)) +
      (sorted.length ? "" : `<p class="dd-empty">Add genres in <b>Edit details</b>, or select several movies → <b>Genres</b>.</p>`);
  } else if (kind === "sort") {
    html = `<h4>Sort by</h4>` + (state.view === "list" ? LIST_SORTS : SORTS).map(([k, label]) => item(k, label, sortKey() === k)).join("");
  } else if (kind === "listsort") {
    html = `<h4>Sort collections by</h4>` + LISTS_SORTS.map(([k, label]) => item(k, label, state.listsSort === k)).join("");
  } else if (kind === "show") {
    html = `<h4>Show</h4>` + SHOWS.map(([k, label]) => item(k, label, state.show === k)).join("") +
      `<hr><label class="dd-toggle-row"><input type="checkbox" id="showTitlesBox" ${state.showTitles ? "checked" : ""}>Titles under posters</label>`;
  }

  hidePopups();
  ddMenu.innerHTML = html;
  ddMenu.hidden = false;
  openMenuKind = kind;
  anchor.classList.add("open");
  const r = anchor.getBoundingClientRect();
  ddMenu.style.left = `${Math.max(8, Math.min(r.right - ddMenu.offsetWidth, innerWidth - ddMenu.offsetWidth - 8))}px`;
  ddMenu.style.top = `${r.bottom + 6}px`;
  popIn(ddMenu, "top right");
}

function pickFromMenu(kind, raw) {
  const value = raw === "" ? null : /^\d+$/.test(raw) ? Number(raw) : raw;
  if (kind === "sort") {
    if (state.view === "list") state.listSort = value;
    else { state.sort = value; saveSetting("sort", value); }
  } else if (kind === "listsort") state.listsSort = value;
  else if (kind === "show") state.show = value;
  else state.filters[kind] = value;
  hidePopups();
  scrollTo({ top: 0 }); // first, so the posters slide from where you see them now
  render();
}

$("#filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".filter");
  if (!btn) return;
  if (e.target.closest("[data-clear]")) {
    state.filters[btn.dataset.menu] = null;
    hidePopups();
    return render();
  }
  if (openMenuKind === btn.dataset.menu) return hidePopups();
  openMenu(btn.dataset.menu, btn);
});

ddMenu.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-pick]");
  if (pick) pickFromMenu(openMenuKind, pick.dataset.pick);
});
ddMenu.addEventListener("change", (e) => {
  if (e.target.id !== "showTitlesBox") return;
  state.showTitles = e.target.checked;
  saveSetting("showTitles", state.showTitles);
  render();
});

// ---------------------------------------------------------------- collections

const listRowCache = new Map(); // id -> { html, el }
let newListEl = null;

const itemsById = () => new Map(state.items.map((i) => [i.id, i]));
const filmsOf = (lst, byId = itemsById()) => lst.films.map((id) => byId.get(id)).filter(Boolean);

// The collection's own cover, or (until it has one) its first three posters fanned out
// over a colour taken from its name.
function collectionArt(lst, films) {
  if (lst.cover) return `<img src="/posters/${encodeURIComponent(lst.cover)}" alt="" draggable="false" loading="lazy" decoding="async">`;
  const slots = [1, 0, 2].map((n) => `<div class="fp fp${n}">${films[n] ? posterArt(films[n]) : ""}</div>`).join("");
  return `<div class="col-art" style="--h:${hue(lst.name)}">
      <div class="fan">${slots}</div>
      <div class="col-art-name">${esc(lst.name)}</div>
    </div>`;
}

function collectionCardHtml(lst, byId) {
  const films = filmsOf(lst, byId);
  const caption = state.showTitles ? `
      <div class="caption">
        <h3 class="title">${esc(lst.name)}</h3>
        <div class="sub"><span>${plural(films.length, "film")}</span></div>
      </div>` : "";
  return `
    <article class="card col-card" data-lid="${lst.id}" aria-label="${esc(lst.name)}">
      <div class="poster">
        ${collectionArt(lst, films)}
        <span class="badge col-count" title="${plural(films.length, "film")}">${ICONS.stack}${films.length}</span>
        <button class="more" data-listmenu aria-label="More actions" title="More actions">${ICONS.more}</button>
      </div>${caption}
    </article>`;
}

function renderLists() {
  const q = state.query.toLowerCase();
  const byId = itemsById();
  const by = {
    updated: (a, b) => b.updated - a.updated,
    created: (a, b) => b.created - a.created,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    size: (a, b) => b.films.length - a.films.length || b.updated - a.updated,
    played: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || b.updated - a.updated,
  }[state.listsSort];
  const lists = state.lists.filter((l) => !q || `${l.name} ${l.description || ""}`.toLowerCase().includes(q)).sort(by);
  const nodes = lists.map((lst) => {
    const html = collectionCardHtml(lst, byId);
    let cached = listRowCache.get(lst.id);
    if (!cached || cached.html !== html) {
      cached = { html, el: elementFrom(html) };
      listRowCache.set(lst.id, cached);
    }
    return cached.el;
  });
  newListEl ||= elementFrom(`
    <article class="card add-card" data-list="create">
      <div class="poster"><div class="plus">${ICONS.plus}</div><span>New collection</span></div>
    </article>`);
  if (!q) nodes.push(newListEl);
  if (q && !lists.length) nodes.push(elementFrom(`<p class="empty">No collections match “${esc(state.query)}”.</p>`));
  placeNodes(listsView, nodes);
  $("#count").textContent = plural(state.lists.length, "collection");
}

function renderListHeader() {
  const lst = state.view === "list" && currentList();
  $("#listHeader").hidden = !lst;
  if (!lst) return;
  const films = filmsOf(lst);
  const art = collectionArt(lst, films);
  if ($("#listCover").dataset.html !== art) $("#listCover").innerHTML = $("#listCover").dataset.html = art;
  const total = films.reduce((sum, f) => sum + (f.duration || 0), 0);
  const watched = films.filter((f) => f.watched).length;
  $("#listTitle").textContent = lst.name;
  $("#listDesc").textContent = lst.description || "";
  $("#listDesc").hidden = !lst.description;
  $("#listMeta").textContent = [plural(films.length, "film"), total ? `${fmtRuntime(total)} in all` : "",
    films.length ? `${watched} watched` : "", `updated ${timeAgo(lst.updated)}`].filter(Boolean).join(" • ");
  $("#listHeader [data-list='play']").disabled = !films.some((f) => f.exists);
}

// Switches between the Library, the Lists page and one list.
function go(view, listId = null) {
  Object.assign(state, {
    view, listId, selected: null, selecting: false, picked: new Set(), missingOnly: false, query: "",
    listSort: "list",
  });
  $("#search").value = "";
  hidePopups();
  viewEntering = true;
  try { render(); } finally { viewEntering = false; }
  scrollTo({ top: 0 });
  enterView();
}

const listActions = {
  open(lst) { go("list", lst.id); },
  back() { go("lists"); },

  async create() { await actions.createList(); },

  async play(lst) {
    const r = await api("/api/list/play", { lid: lst.id });
    toast(`Playing ${plural(r.count, "movie")} in your player`);
  },

  async edit(lst) {
    const result = await listDialog(lst);
    if (!result) return;
    await api("/api/list/edit", { lid: lst.id, name: result.name, description: result.description });
    await saveCollectionCover(lst.id, result.poster);
  },

  cover(lst) {
    state.coverTarget = null;
    state.coverList = lst.id;
    $("#coverInput").value = "";
    $("#coverInput").click();
  },

  async uncover(lst) {
    await api("/api/list/remove-cover", { lid: lst.id });
    toast("Cover removed");
  },

  async delete(lst) {
    const ok = await dialog({
      title: "Delete collection?",
      text: `“${lst.name}” will be deleted. Its movies stay in your library.`,
      ok: "Delete", danger: true,
    });
    if (!ok) return;
    await api("/api/list/delete", { lid: lst.id });
    if (state.view === "list") go("lists");
    toast("Collection deleted");
  },
};

async function runList(name, lid) {
  hidePopups();
  try {
    const lst = state.lists.find((l) => l.id === lid);
    if (lst || name === "create" || name === "back") await listActions[name](lst);
  } catch (e) {
    toast(e.message);
  }
}

// poster: null = keep, "remove", or a data URL
async function saveCollectionCover(lid, poster) {
  if (poster === "remove") await api("/api/list/remove-cover", { lid });
  else if (poster) await api("/api/list/cover", { lid, image: poster });
}

async function setCollectionCover(lid, file) {
  if (!file || !file.type.startsWith("image/")) return toast("That isn't an image");
  await api("/api/list/cover", { lid, image: await posterDataUrl(file) });
  toast("Cover updated");
}

// New / edit collection: resolves to { name, description, poster } or null.
// The cover change waits for Save, like a movie's poster.
function listDialog(lst = null) {
  const modal = $("#listModal"), form = $("#listForm"), name = $("#lName"), desc = $("#lDesc");
  const frame = $("#lPoster"), fileInput = $("#coverInput");
  const films = lst ? filmsOf(lst) : [];
  let poster = null;
  $("#lTitle").textContent = lst ? "Edit collection" : "New collection";
  $("#lOk").textContent = lst ? "Save" : "Create";
  name.value = lst?.name || "";
  desc.value = lst?.description || "";

  const drawPoster = () => {
    const shown = { ...(lst || {}), name: name.value.trim() || "New collection", cover: poster === "remove" ? null : lst?.cover };
    frame.innerHTML = poster && poster !== "remove" ? `<img src="${poster}" alt="">` : collectionArt(shown, films);
    $("#lPosterRemove").hidden = !(poster ? poster !== "remove" : lst?.cover);
  };
  const usePoster = async (file) => {
    if (!file || !file.type.startsWith("image/")) return toast("That isn't an image");
    poster = await posterDataUrl(file);
    drawPoster();
  };

  drawPoster();
  modal.hidden = false;
  name.focus();
  name.select();
  return new Promise((resolve) => {
    const close = (result) => {
      modal.hidden = true;
      form.onsubmit = $("#lCancel").onclick = modal.onmousedown = modal.onkeydown = name.oninput = null;
      frame.onclick = frame.ondragover = frame.ondragleave = frame.ondrop = null;
      $("#lPosterPick").onclick = $("#lPosterRemove").onclick = fileInput.onchange = modal.onpaste = null;
      resolve(result);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!name.value.trim()) return name.focus();
      close({ name: name.value.trim(), description: desc.value.trim(), poster });
    };
    name.oninput = drawPoster;
    $("#lPosterPick").onclick = frame.onclick = () => { fileInput.value = ""; fileInput.click(); };
    $("#lPosterRemove").onclick = () => { poster = "remove"; drawPoster(); };
    fileInput.onchange = () => usePoster(fileInput.files[0]);
    frame.ondragover = (e) => { e.preventDefault(); frame.classList.add("drop"); };
    frame.ondragleave = () => frame.classList.remove("drop");
    frame.ondrop = (e) => {
      e.preventDefault();
      frame.classList.remove("drop");
      usePoster([...e.dataTransfer.files].find((f) => f.type.startsWith("image/")));
    };
    modal.onpaste = (e) => {
      const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
      if (file) { e.preventDefault(); usePoster(file); }
    };
    $("#lCancel").onclick = () => close(null);
    modal.onmousedown = (e) => { if (e.target === modal) close(null); };
    modal.onkeydown = (e) => { if (e.key === "Escape") close(null); };
  });
}

// "Add to list": tick the lists the movies belong in, or make a new one.
function saveDialog(items) {
  const modal = $("#saveModal"), list = $("#saveList"), form = $("#saveForm"), nameInput = $("#saveNewName");
  const ids = items.map((i) => i.id);
  $("#saveTitle").textContent = items.length > 1 ? `Add ${items.length} movies to…` : `Add “${items[0].title}” to…`;

  const draw = () => {
    const lists = [...state.lists].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    list.innerHTML = lists.length
      ? lists.map((l) => {
        const inside = ids.filter((id) => l.films.includes(id)).length;
        return `<label class="save-row">
          <input type="checkbox" data-lid="${l.id}" ${inside === ids.length ? "checked" : ""} ${inside && inside < ids.length ? "data-some" : ""}>
          <span class="save-name">${esc(l.name)}</span><span class="save-count">${plural(l.films.length, "film")}</span>
        </label>`;
      }).join("")
      : `<p class="save-empty">No collections yet. Start the first one below.</p>`;
    list.querySelectorAll("[data-some]").forEach((b) => { b.indeterminate = true; });
  };

  draw();
  nameInput.value = "";
  modal.hidden = false;
  (list.querySelector("input") || nameInput).focus();

  return new Promise((resolve) => {
    const close = () => {
      modal.hidden = true;
      list.onchange = form.onsubmit = modal.onmousedown = modal.onkeydown = $("#saveDone").onclick = null;
      resolve();
    };
    list.onchange = async (e) => {
      const box = e.target, lst = state.lists.find((l) => l.id === box.dataset.lid);
      try {
        await api(`/api/list/${box.checked ? "add" : "remove"}`, { lid: lst.id, ids });
        toast(box.checked ? `Added to “${lst.name}”` : `Removed from “${lst.name}”`);
      } catch (err) { toast(err.message); }
      draw();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return nameInput.focus();
      try {
        await api("/api/list/create", { name, ids });
        toast(`Added to “${name}”`);
        nameInput.value = "";
      } catch (err) { toast(err.message); }
      draw();
    };
    $("#saveDone").onclick = close;
    modal.onmousedown = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => { if (e.key === "Escape") close(); };
  });
}

// ---------------------------------------------------------------- menu state

function updateMenu() {
  const item = selectedItem();
  document.querySelectorAll("[data-needs]").forEach((b) => {
    const needs = b.dataset.needs;
    b.disabled = needs === "picked" ? !state.picked.size : needs === "cover" ? !(item?.cover && !item.coverAuto) : !item;
  });
  const n = state.picked.size;
  $("#menu").classList.toggle("selecting", state.selecting);
  grid.classList.toggle("selecting", state.selecting);
  $("#selCount").textContent = `${n} selected`;
  $("[data-action='bulkRemoveCover']").disabled = !pickedItems().some((i) => i.cover && !i.coverAuto);
  // One button: marks all as watched, or unwatched when they all already are.
  const allWatched = n > 0 && pickedItems().every((i) => i.watched);
  $("[data-action='bulkWatched'] span").textContent = allWatched ? "Mark as unwatched" : "Mark as watched";
}

const pickedItems = () => state.items.filter((i) => state.picked.has(i.id));

// ---------------------------------------------------------------- selection mode

function setSelecting(on, initial = []) {
  state.selecting = on;
  state.picked = new Set(on ? initial : []);
  state.lastPicked = initial[initial.length - 1] ?? null;
  if (on) state.selected = null;
  hidePopups();
  render();
}

// Click toggles one movie; Shift + click picks everything between it and the last one.
function togglePick(id, range) {
  const order = visibleItems().map((i) => i.id);
  if (range && state.lastPicked && order.includes(state.lastPicked)) {
    const [a, b] = [order.indexOf(state.lastPicked), order.indexOf(id)].sort((x, y) => x - y);
    order.slice(a, b + 1).forEach((i) => state.picked.add(i));
  } else if (state.picked.has(id)) {
    state.picked.delete(id);
  } else {
    state.picked.add(id);
  }
  state.lastPicked = id;
  render();
}

const selectedItem = () => state.items.find((i) => i.id === state.selected);

function select(id) {
  state.selected = id;
  grid.querySelectorAll(".card[data-id]").forEach((c) => c.classList.toggle("selected", c.dataset.id === id));
  updateMenu();
}

// ---------------------------------------------------------------- actions

const actions = {
  async add() { await addMovies("files"); },
  async addFolder() { await addMovies("folder"); },

  async play(item) {
    try {
      await api("/api/open", { id: item.id });
      toast(`Opening “${item.title}”`);
    } catch (e) { toast(e.message); }
  },

  cover(item) {
    state.coverTarget = item.id;
    state.coverList = null;
    $("#coverInput").value = "";
    $("#coverInput").click();
  },

  async removeCover(item) {
    thumbTried.delete(item.id); // grab a fresh frame
    await api("/api/remove-cover", { id: item.id });
    toast("Poster removed");
  },

  async details(item) { await detailsDialog(item); },

  async reveal(item) { await api("/api/reveal", { id: item.id }); },

  async toggleWatched(item) {
    await api("/api/watched", { id: item.id, watched: !item.watched });
    toast(item.watched ? "Marked as not watched" : "Marked as watched");
  },

  async collect(item) { await saveDialog([item]); },

  async uncollect(item) {
    const lst = currentList();
    if (!lst) return;
    await api("/api/list/remove", { lid: lst.id, ids: [item.id] });
    toast(`Removed from “${lst.name}”`);
  },

  async locate(item) {
    toast(`Find “${item.title}” in the dialog…`, 60000);
    const res = await api("/api/locate", { id: item.id });
    if (!res.relinked) return toast("Nothing changed");
    thumbTried.delete(item.id);
    toast("File found");
    // Moved a whole folder? Fix the other movies from it in one go.
    const others = res.siblings || [];
    if (!others.length) return;
    const ok = await dialog({
      title: `Found ${plural(others.length, "more missing movie")}`,
      text: `${others.length === 1 ? "It is" : "They are"} in the same folder as the file you picked. Relink ${others.length === 1 ? "it" : "them"} too?`,
      ok: "Relink",
    });
    if (ok) {
      others.forEach((id) => thumbTried.delete(id));
      const r = await api("/api/relink-folder", { ids: others, folder: res.folder });
      toast(`Relinked ${plural(r.relinked + 1, "movie")}`);
    }
  },

  async delete(item) {
    const ok = await dialog({
      title: "Remove from library?",
      text: `“${item.title}” will be removed from Cover. The movie file on your drive is not touched.`,
      ok: "Remove", danger: true,
    });
    if (ok) {
      await api("/api/delete", { id: item.id });
      toast("Removed from library");
    }
  },

  // ---- these don't take a single movie

  async createList() {
    const result = await listDialog();
    if (!result) return;
    const { id } = await api("/api/list/create", { name: result.name, description: result.description });
    await saveCollectionCover(id, result.poster);
    toast(`Created “${result.name}”`);
  },

  async bulkWatched() {
    const items = pickedItems();
    if (!items.length) return;
    const watched = !items.every((i) => i.watched);
    await api("/api/watched", { ids: items.map((i) => i.id), watched });
    toast(`Marked ${plural(items.length, "movie")} as ${watched ? "watched" : "not watched"}`);
  },

  async bulkCollect() {
    const items = pickedItems();
    if (items.length) await saveDialog(items);
  },

  async bulkUncollect() {
    const lst = currentList(), items = pickedItems();
    if (!lst || !items.length) return;
    await api("/api/list/remove", { lid: lst.id, ids: items.map((i) => i.id) });
    toast(`Removed ${plural(items.length, "movie")} from “${lst.name}”`);
  },

  async bulkGenres() {
    const items = pickedItems();
    if (items.length) await genresDialog(items);
  },

  selectMode() { setSelecting(true, state.selected ? [state.selected] : []); },
  exitSelect() { setSelecting(false); },
  selectAll() {
    visibleItems().forEach((i) => state.picked.add(i.id));
    render();
  },
  selectNone() {
    state.picked.clear();
    render();
  },

  async bulkRemoveCover() {
    const items = pickedItems().filter((i) => i.cover && !i.coverAuto);
    if (!items.length) return;
    items.forEach((i) => thumbTried.delete(i.id)); // grab fresh frames
    await api("/api/remove-cover", { ids: items.map((i) => i.id) });
    toast(`Removed ${plural(items.length, "poster")}`);
  },

  async bulkDelete() {
    const items = pickedItems();
    if (!items.length) return;
    const ok = await dialog({
      title: `Remove ${plural(items.length, "movie")}?`,
      text: `They will be removed from Cover. The movie files on your drive are not touched.`,
      ok: "Remove", danger: true,
    });
    if (ok) {
      await api("/api/delete", { ids: items.map((i) => i.id) });
      toast(`Removed ${plural(items.length, "movie")}`);
      setSelecting(false);
    }
  },
};

const GLOBAL_ACTIONS = new Set(["add", "addFolder", "selectMode", "exitSelect", "selectAll", "selectNone",
  "bulkRemoveCover", "bulkDelete", "createList", "bulkCollect", "bulkUncollect", "bulkWatched", "bulkGenres"]);

async function run(name, item) {
  hidePopups();
  try {
    if (GLOBAL_ACTIONS.has(name)) return await actions[name]();
    item = item || selectedItem();
    if (item) await actions[name](item);
  } catch (e) {
    toast(e.message);
  }
}

async function rate(item, rating) {
  try {
    await api("/api/rate", { id: item.id, rating: rating || null });
    toast(rating ? `Rated “${item.title}” ${starsText(rating)}` : "Rating cleared");
  } catch (e) { toast(e.message); }
}

async function addMovies(mode) {
  toast(mode === "folder" ? "Choose a folder in the dialog…" : "Choose movies in the dialog…", 60000);
  // Inside a list, picked movies also go into it (even ones already in the library).
  const lst = state.view === "list" ? currentList() : null;
  const { added, picked } = await api("/api/add", { mode, list: lst?.id });
  if (lst) toast(picked ? `Added ${plural(picked, "movie")} to “${lst.name}”` : "Nothing added");
  else toast(added.length ? `Added ${plural(added.length, "movie")}` : "Nothing new added");
  if (added.length) select(added[added.length - 1]);
}

// ---------------------------------------------------------------- images

const readDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(file);
});

async function setCoverFromFile(id, file) {
  if (!file || !file.type.startsWith("image/")) return toast("That isn't an image");
  await api("/api/cover", { id, image: await posterDataUrl(file) });
  toast("Poster updated");
}

// Posters never show wider than ~800px: bigger or heavy images are scaled down to a
// JPEG before saving (GIFs are kept as they are, so they stay animated).
async function posterDataUrl(file, maxWidth = 800) {
  const url = await readDataUrl(file);
  if (file.type === "image/gif") return url;
  const img = new Image();
  img.src = url;
  await img.decode();
  if (img.naturalWidth <= maxWidth && file.size <= 400 * 1024) return url;
  const c = document.createElement("canvas");
  c.width = Math.min(maxWidth, img.naturalWidth);
  c.height = Math.round((c.width * img.naturalHeight) / img.naturalWidth);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

// ---------------------------------------------------------------- auto frames
// Movies without a poster get a frame from a quarter of the way in, under their title,
// and their running time. Works for whatever the browser can decode (mp4/webm/most mkv);
// others keep the plain title card until you add a poster.

const FRAME_WIDTH = 960;
const thumbQueue = [];
let thumbBusy = false;

const thumbTried = new Set(); // one attempt per movie per session, whatever the server says
const needsThumb = (i) => i.exists && !thumbTried.has(i.id) && !i.autoTried;

function queueAutoThumbs() {
  for (const i of state.items) {
    if (needsThumb(i) && !thumbQueue.includes(i.id)) thumbQueue.push(i.id);
  }
  pumpThumbs();
}

async function pumpThumbs() {
  if (thumbBusy) return;
  thumbBusy = true;
  while (thumbQueue.length) {
    const id = thumbQueue.shift();
    const item = state.items.find((i) => i.id === id);
    if (!item || !needsThumb(item)) continue;
    thumbTried.add(id);
    const result = await captureFrame(id);
    try { await api("/api/auto-thumb", { id, ...result }); } catch { /* removed meanwhile */ }
  }
  thumbBusy = false;
}

// Points to try, as a share of the running time: a dark frame (a fade, a night scene)
// moves on to the next one; if all are dark the brightest is kept.
const FRAME_POINTS = [0.25, 0.4, 0.55, 0.7];

// Average brightness 0..255 of a frame, from a tiny copy of it.
function brightness(source) {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(source, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  return sum / 256;
}

function captureFrame(id) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let done = false, tries = 0, best = null;
    const finish = (image = best?.image ?? null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const duration = isFinite(v.duration) ? v.duration : null;
      v.removeAttribute("src");
      v.load();
      resolve({ image, duration });
    };
    const timer = setTimeout(() => finish(), 25000);
    const seekNext = () => {
      const d = v.duration;
      v.currentTime = isFinite(d) && d > 0 ? d * FRAME_POINTS[tries] : 1 + tries * 5;
    };
    v.muted = true;
    v.preload = "auto";
    v.addEventListener("error", () => finish());
    v.addEventListener("loadedmetadata", seekNext);
    // "seeked" can fire before the new frame is drawn; wait for the frame itself when the browser can tell us.
    v.addEventListener("seeked", () => {
      if (!v.requestVideoFrameCallback) return grab();
      let grabbed = false;
      const once = () => { if (!grabbed) { grabbed = true; grab(); } };
      v.requestVideoFrameCallback(once);
      setTimeout(once, 400);
    });
    const grab = () => {
      if (done) return;
      if (!v.videoWidth) return finish();
      const c = document.createElement("canvas");
      c.width = Math.min(FRAME_WIDTH, v.videoWidth);
      c.height = Math.round((c.width * v.videoHeight) / v.videoWidth);
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      const light = brightness(c);
      if (!best || light > best.light) best = { light, image: c.toDataURL("image/jpeg", 0.82) };
      tries++;
      if (light >= 40 || tries >= FRAME_POINTS.length) return finish();
      seekNext();
    };
    v.src = `/media/${id}`;
  });
}

// ---------------------------------------------------------------- stars you can click (half steps)

// Draws stars into el; hovering previews, clicking sets. Returns { set(value) }.
function starInput(el, value, onPick) {
  let current = value || 0;
  const draw = (v) => {
    el.innerHTML = starsHtml(v);
    el.setAttribute("aria-valuenow", String(v / 2));
    el.title = v ? `${v / 2} of 5 stars` : "Not rated";
  };
  const at = (e) => {
    const r = el.querySelector(".stars").getBoundingClientRect();
    return Math.max(1, Math.min(10, Math.ceil(((e.clientX - r.left) / r.width) * 10)));
  };
  el.onmousemove = (e) => draw(at(e));
  el.onmouseleave = () => draw(current);
  el.onclick = (e) => {
    const v = at(e);
    current = v === current ? 0 : v; // clicking your rating again clears it
    draw(current);
    onPick(current);
  };
  el.onkeydown = (e) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (step) current = Math.max(0, Math.min(10, current + step));
    else if (e.key === "Delete" || e.key === "Backspace" || e.key === "0") current = 0;
    else return;
    e.preventDefault();
    draw(current);
    onPick(current);
  };
  draw(current);
  return { set(v) { current = v || 0; draw(current); } };
}

// ---------------------------------------------------------------- details dialog

function allGenres() {
  const names = [...COMMON_GENRES];
  for (const i of state.items) for (const g of genresOf(i)) if (!names.some((n) => sameText(n, g))) names.push(g);
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

const splitGenres = (text) => text.split(",").map((g) => g.trim()).filter(Boolean);

function detailsDialog(item) {
  const modal = $("#detailsModal"), form = $("#detailsForm");
  const title = $("#dTitle"), year = $("#dYear"), genres = $("#dGenres"), suggest = $("#dGenreSuggest");
  const frame = $("#dPoster"), fileInput = $("#coverInput");
  let rating = item.rating || 0;
  let poster = null; // null = keep, "remove", or a data URL

  title.value = item.title;
  year.value = item.year || "";
  // Directors already in the library are offered as you type, so the same name is spelled the same.
  const director = $("#dDirector");
  director.value = item.director || "";
  const known = new Map();
  for (const i of state.items) if (i.director && !known.has(i.director.toLowerCase())) known.set(i.director.toLowerCase(), i.director);
  $("#directorList").innerHTML = [...known.values()].sort((a, b) => a.localeCompare(b))
    .map((d) => `<option value="${esc(d)}">`).join("");
  genres.value = genresOf(item).join(", ");
  $("#dWatched").checked = !!item.watched;
  $("#dFile").textContent = item.exists ? item.path : `File not found: ${item.path}`;
  const stars = starInput($("#dRating"), rating, (v) => { rating = v; });

  const drawPoster = () => {
    const shown = poster === "remove" ? { ...item, cover: null }
      : poster ? null : item;
    frame.innerHTML = shown ? posterArt({ ...shown, title: title.value || item.title, year: Number(year.value) || null })
      : `<img src="${poster}" alt="">`;
    const hasReal = poster ? poster !== "remove" : item.cover && !item.coverAuto;
    $("#dPosterRemove").hidden = !hasReal;
  };
  const drawSuggest = () => {
    const picked = splitGenres(genres.value);
    suggest.innerHTML = allGenres().map((g) =>
      `<button type="button" class="${picked.some((p) => sameText(p, g)) ? "on" : ""}" data-genre="${esc(g)}">${esc(g)}</button>`).join("");
  };
  const usePoster = async (file) => {
    if (!file || !file.type.startsWith("image/")) return toast("That isn't an image");
    poster = await posterDataUrl(file);
    drawPoster();
  };

  drawPoster();
  drawSuggest();
  modal.hidden = false;
  title.focus();
  title.select();

  return new Promise((resolve) => {
    const close = () => {
      modal.hidden = true;
      form.onsubmit = modal.onmousedown = modal.onkeydown = title.oninput = year.oninput = genres.oninput = null;
      suggest.onclick = frame.onclick = frame.ondragover = frame.ondragleave = frame.ondrop = null;
      $("#dCancel").onclick = $("#dPosterPick").onclick = $("#dPosterRemove").onclick = $("#dRatingClear").onclick = null;
      fileInput.onchange = modal.onpaste = null;
      resolve();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!title.value.trim()) return title.focus();
      try {
        await api("/api/details", {
          id: item.id, title: title.value.trim(), year: year.value.trim(), director: director.value.trim(),
          genres: splitGenres(genres.value), rating: rating || null,
        });
        if ($("#dWatched").checked !== !!item.watched) await api("/api/watched", { id: item.id, watched: $("#dWatched").checked });
        if (poster === "remove") {
          thumbTried.delete(item.id);
          await api("/api/remove-cover", { id: item.id });
        } else if (poster) {
          await api("/api/cover", { id: item.id, image: poster });
        }
        close();
        toast("Saved");
      } catch (err) { toast(err.message); }
    };
    title.oninput = year.oninput = drawPoster;
    genres.oninput = drawSuggest;
    year.onkeydown = (e) => { if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey) e.preventDefault(); };
    suggest.onclick = (e) => {
      const g = e.target.closest("[data-genre]")?.dataset.genre;
      if (!g) return;
      const picked = splitGenres(genres.value);
      const next = picked.some((p) => sameText(p, g)) ? picked.filter((p) => !sameText(p, g)) : [...picked, g];
      genres.value = next.join(", ");
      drawSuggest();
    };
    $("#dRatingClear").onclick = () => { rating = 0; stars.set(0); };
    $("#dCancel").onclick = close;
    $("#dPosterPick").onclick = frame.onclick = () => { fileInput.value = ""; fileInput.click(); };
    $("#dPosterRemove").onclick = () => { poster = "remove"; drawPoster(); };
    fileInput.onchange = () => usePoster(fileInput.files[0]);
    frame.ondragover = (e) => { e.preventDefault(); frame.classList.add("drop"); };
    frame.ondragleave = () => frame.classList.remove("drop");
    frame.ondrop = (e) => {
      e.preventDefault();
      frame.classList.remove("drop");
      usePoster([...e.dataTransfer.files].find((f) => f.type.startsWith("image/")));
    };
    modal.onpaste = (e) => {
      const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
      if (file) { e.preventDefault(); usePoster(file); }
    };
    modal.onmousedown = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => { if (e.key === "Escape") close(); };
  });
}

// Genres for several movies: click to add to all, click again to take it off all.
function genresDialog(items) {
  const modal = $("#genresModal"), form = $("#genresForm"), list = $("#gList"), input = $("#gNew");
  const ids = items.map((i) => i.id);
  $("#gTitle").textContent = `Genres of ${plural(items.length, "movie")}`;
  const draw = () => {
    const current = state.items.filter((i) => ids.includes(i.id));
    list.innerHTML = allGenres().map((g) => {
      const n = current.filter((i) => genresOf(i).some((x) => sameText(x, g))).length;
      return `<button type="button" class="${n === current.length ? "on" : n ? "some" : ""}" data-genre="${esc(g)}" data-all="${n === current.length}">${esc(g)}</button>`;
    }).join("");
  };
  draw();
  input.value = "";
  modal.hidden = false;
  input.focus();
  return new Promise((resolve) => {
    const close = () => {
      modal.hidden = true;
      list.onclick = form.onsubmit = modal.onmousedown = modal.onkeydown = $("#gDone").onclick = null;
      resolve();
    };
    list.onclick = async (e) => {
      const b = e.target.closest("[data-genre]");
      if (!b) return;
      try {
        await api("/api/genres", b.dataset.all === "true" ? { ids, remove: [b.dataset.genre] } : { ids, add: [b.dataset.genre] });
      } catch (err) { toast(err.message); }
      draw();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const names = splitGenres(input.value);
      if (!names.length) return input.focus();
      try { await api("/api/genres", { ids, add: names }); } catch (err) { toast(err.message); }
      input.value = "";
      draw();
    };
    $("#gDone").onclick = close;
    modal.onmousedown = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => { if (e.key === "Escape") close(); };
  });
}

// ---------------------------------------------------------------- hover card

let hoverTimer = null;
let hoverId = null;

function showHovercard(card) {
  const item = state.items.find((i) => i.id === card.dataset.id);
  if (!item) return;
  const meta = [item.year, fmtRuntime(item.duration), item.ext, fmtSize(item.size)].filter(Boolean).join(" • ");
  const status = [item.watched ? "Watched" : "Not watched yet", item.lastPlayed ? `last played ${timeAgo(item.lastPlayed)}` : ""]
    .filter(Boolean).join(" • ");
  hovercard.innerHTML = `
    <h3>${esc(item.title)}</h3>
    ${meta ? `<div class="hc-meta">${esc(meta)}</div>` : ""}
    ${item.director ? `<div class="hc-meta">Directed by <b>${esc(item.director)}</b></div>` : ""}
    ${genresOf(item).length ? `<div class="hc-tags">${genresOf(item).map((g) => `<span class="tag">${esc(g)}</span>`).join("")}</div>` : ""}
    <div class="hc-label">Your rating</div>
    <div class="hc-rating">${item.rating ? starsHtml(item.rating) : `<span class="hc-line">Not rated</span>`}</div>
    <div class="hc-label">Status</div>
    <div class="hc-line">${esc(status)}</div>
    <div class="hc-file">${item.exists ? esc(item.path.split(/[\\/]/).pop()) : "File not found — right-click → Locate file"}</div>`;
  hovercard.hidden = false;
  const r = card.querySelector(".poster").getBoundingClientRect();
  const w = hovercard.offsetWidth, h = hovercard.offsetHeight;
  const left = r.right + 14 + w < innerWidth ? r.right + 14 : Math.max(8, r.left - 14 - w);
  hovercard.style.left = `${left}px`;
  hovercard.style.top = `${Math.max(124, Math.min(r.top, innerHeight - h - 12))}px`;
}

function hideHovercard() {
  clearTimeout(hoverTimer);
  hoverId = null;
  hovercard.hidden = true;
}

grid.addEventListener("mouseover", (e) => {
  const card = e.target.closest(".card[data-id]");
  if (!card || card.dataset.id === hoverId) return;
  hideHovercard();
  if (state.selecting || !ctx.hidden || e.buttons) return;
  hoverId = card.dataset.id;
  hoverTimer = setTimeout(() => showHovercard(card), 450);
});
grid.addEventListener("mouseout", (e) => {
  const card = e.target.closest(".card[data-id]");
  if (card && !card.contains(e.relatedTarget)) hideHovercard();
});

// ---------------------------------------------------------------- ui helpers

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function dialog({ title, text, value, ok = "OK", danger = false }) {
  const modal = $("#modal"), input = $("#modalInput"), okBtn = $("#modalOk");
  $("#modalTitle").textContent = title;
  $("#modalText").textContent = text;
  $("#modalText").hidden = !text;
  input.hidden = value === undefined;
  input.value = value ?? "";
  okBtn.textContent = ok;
  okBtn.classList.toggle("danger", danger);
  modal.hidden = false;
  (value === undefined ? okBtn : input).focus();
  if (value !== undefined) input.select();

  return new Promise((resolve) => {
    const close = (result) => {
      modal.hidden = true;
      $("#modalForm").onsubmit = $("#modalCancel").onclick = modal.onmousedown = modal.onkeydown = null;
      resolve(result);
    };
    $("#modalForm").onsubmit = (e) => { e.preventDefault(); close(value === undefined ? true : input.value); };
    $("#modalCancel").onclick = () => close(null);
    modal.onmousedown = (e) => { if (e.target === modal) close(null); };
    modal.onkeydown = (e) => { if (e.key === "Escape") close(null); };
  });
}

function showCtx(item, x, y) {
  hideHovercard();
  select(item.id);
  ctx.querySelector('[data-needs="cover"]').disabled = !(item.cover && !item.coverAuto);
  ctx.querySelector('[data-action="cover"]').textContent = item.cover && !item.coverAuto ? "Change poster…" : "Add poster…";
  ctx.querySelector('[data-action="toggleWatched"]').textContent = item.watched ? "Mark as not watched" : "Mark as watched";
  starInput($("#ctxStars"), item.rating, (v) => { hidePopups(); rate(item, v); });
  ctx.hidden = false;
  const { width, height } = ctx.getBoundingClientRect();
  ctx.style.left = `${Math.min(x, innerWidth - width - 8)}px`;
  ctx.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
  popIn(ctx, "top left");
}

const hidePopups = () => {
  ctx.hidden = true;
  listCtx.hidden = true;
  $("#themeMenu").hidden = true;
  ddMenu.hidden = true;
  openMenuKind = null;
  document.querySelectorAll(".filter.open, #themeBtn.open").forEach((b) => b.classList.remove("open"));
  hideHovercard();
};

// ---------------------------------------------------------------- events

const cardItem = (el) => state.items.find((i) => i.id === el?.closest(".card")?.dataset.id);

grid.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (state.selecting) {
    if (card?.dataset.id) togglePick(card.dataset.id, e.shiftKey);
    return;
  }
  if (!card) return select(null);
  if (card.classList.contains("add-card")) return run("add");
  const btn = e.target.closest("[data-action]");
  const item = cardItem(card);
  // Ctrl + click starts picking several movies, like in File Explorer.
  if (e.ctrlKey || e.metaKey) {
    return setSelecting(true, [...new Set([state.selected, item.id].filter(Boolean))]);
  }
  if (btn?.dataset.action === "play") return run("play", item);
  if (btn?.dataset.action === "locate") {
    select(item.id);
    return run("locate", item);
  }
  select(item.id);
});

grid.addEventListener("dblclick", (e) => {
  const item = cardItem(e.target);
  if (item && !state.selecting && !e.target.closest("[data-action]")) run("play", item);
});

grid.addEventListener("contextmenu", (e) => {
  const item = cardItem(e.target);
  if (!item) return;
  e.preventDefault();
  if (!state.selecting) showCtx(item, e.clientX, e.clientY);
});

// Shift + click would otherwise highlight text across cards.
grid.addEventListener("mousedown", (e) => { if (state.selecting && e.shiftKey) e.preventDefault(); });

$("#menu").addEventListener("click", (e) => {
  const tab = e.target.closest("button[data-view]");
  if (tab) return go(tab.dataset.view);
  const btn = e.target.closest("button[data-action]");
  if (btn) run(btn.dataset.action);
});

$("#brand").addEventListener("click", () => go("library"));

// Lists page: open a list, its ⋮ menu, or create one.
let ctxListId = null;
function showListCtx(lid, x, y) {
  hidePopups();
  ctxListId = lid;
  listCtx.querySelector(".has-cover").hidden = !state.lists.find((l) => l.id === lid)?.cover;
  listCtx.hidden = false;
  const { width, height } = listCtx.getBoundingClientRect();
  listCtx.style.left = `${Math.min(x, innerWidth - width - 8)}px`;
  listCtx.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
  popIn(listCtx, "top left");
}

listsView.addEventListener("click", (e) => {
  if (e.target.closest("[data-list='create']")) return runList("create");
  const row = e.target.closest("[data-lid]");
  if (!row) return;
  const more = e.target.closest("[data-listmenu]");
  if (more) {
    const r = more.getBoundingClientRect();
    return showListCtx(row.dataset.lid, r.right - 200, r.bottom + 4);
  }
  runList("open", row.dataset.lid);
});

listsView.addEventListener("contextmenu", (e) => {
  const row = e.target.closest("[data-lid]");
  if (!row) return;
  e.preventDefault();
  showListCtx(row.dataset.lid, e.clientX, e.clientY);
});

listCtx.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-list]");
  if (btn) runList(btn.dataset.list, ctxListId);
});

$("#listCover").addEventListener("click", () => runList("edit", state.listId));

// Drop an image onto a collection to make it its cover.
listsView.addEventListener("dragover", (e) => {
  const card = e.target.closest(".card[data-lid]");
  e.preventDefault();
  e.dataTransfer.dropEffect = card ? "copy" : "none";
  listsView.querySelectorAll(".card.drop").forEach((c) => c !== card && c.classList.remove("drop"));
  card?.classList.add("drop");
});
listsView.addEventListener("dragleave", (e) => {
  if (!listsView.contains(e.relatedTarget)) listsView.querySelectorAll(".card.drop").forEach((c) => c.classList.remove("drop"));
});
listsView.addEventListener("drop", (e) => {
  e.preventDefault();
  listsView.querySelectorAll(".card.drop").forEach((c) => c.classList.remove("drop"));
  const lid = e.target.closest(".card[data-lid]")?.dataset.lid;
  const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
  if (lid && file) setCollectionCover(lid, file).catch((err) => toast(err.message));
  else if (lid) toast("Drop an image file to use it as the cover");
});

$("#listHeader").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-list]");
  if (btn) runList(btn.dataset.list, state.listId);
});

// Themes: purely cosmetic. LIQUID and STYMU come from your design systems; their colours live in style.css.
// Each swatch is a tiny shelf in that theme: its page, two posters and the accent on the third.
const THEMES = [
  { id: "marquee", group: "Cover", name: "Marquee", swatch: { page: "#111418", card: "#3a4552", accent: "#f2b13a" } },
  { id: "matinee", group: "Cover", name: "Matinee", swatch: { page: "#f4f2ee", card: "#d6d0c4", accent: "#c0420f" } },
  { id: "liquid-sky", group: "LIQUID", name: "Sky", swatch: { page: "#d8eeff", card: "#ffffff", accent: "#0a84ff" } },
  { id: "liquid-glass", group: "LIQUID", name: "Glass", swatch: { page: "#0b2130", card: "#24506a", accent: "#3ad4f2" } },
  { id: "stymu-sleeve", group: "STYMU", name: "Sleeve", swatch: { page: "#ece0c8", card: "#d8901f", accent: "#a8431a" } },
  { id: "stymu-cabinet", group: "STYMU", name: "Cabinet", swatch: { page: "#0a0a09", card: "#c8e04a", accent: "#e2773d" } },
];
function swatchSvg({ page, card, accent }, square) {
  const r = square ? 0 : 5, p = square ? 0 : 1.2;
  return `<svg class="swatch" viewBox="0 0 32 24" aria-hidden="true">
      <rect x=".5" y=".5" width="31" height="23" rx="${r}" fill="${page}" stroke="currentColor" stroke-opacity=".22"/>
      <rect x="5" y="5" width="6" height="9" rx="${p}" fill="${card}"/>
      <rect x="13" y="5" width="6" height="9" rx="${p}" fill="${card}"/>
      <rect x="21" y="5" width="6" height="9" rx="${p}" fill="${accent}"/>
      <rect x="5" y="17" width="12" height="2" rx="1" fill="${card}"/>
    </svg>`;
}
const themeMenu = $("#themeMenu");
const currentTheme = () => document.documentElement.dataset.theme || "marquee";

// Saved in the app folder (data/settings.json), so it travels with it.
const saveSetting = (key, value) =>
  fetch("/api/settings", { method: "POST", body: JSON.stringify({ [key]: value }) }).catch(() => {});

function setTheme(id, save = true) {
  if (!THEMES.some((t) => t.id === id)) id = "marquee";
  document.documentElement.dataset.theme = id;
  if (save) saveSetting("theme", id);
}

function openThemeMenu() {
  let html = "<h4>Theme</h4>", group = null;
  for (const t of THEMES) {
    if (t.group !== group) html += `<h5>${esc(group = t.group)}</h5>`;
    html += `<button class="dd-item ${t.id === currentTheme() ? "active" : ""}" data-theme-id="${t.id}">
      ${swatchSvg(t.swatch, t.group === "STYMU")}
      <span class="dd-name">${esc(t.name)}</span>${t.id === currentTheme() ? ICONS.check.replace("<svg", '<svg class="dd-check"') : ""}
    </button>`;
  }
  const wasOpen = !themeMenu.hidden;
  hidePopups();
  themeMenu.innerHTML = html;
  themeMenu.hidden = false;
  $("#themeBtn").classList.add("open");
  const r = $("#themeBtn").getBoundingClientRect();
  themeMenu.style.left = `${Math.max(8, Math.min(r.right - themeMenu.offsetWidth, innerWidth - themeMenu.offsetWidth - 8))}px`;
  themeMenu.style.top = `${r.bottom + 8}px`;
  if (!wasOpen) popIn(themeMenu, "top right");
}

$("#themeBtn").addEventListener("click", () => (themeMenu.hidden ? openThemeMenu() : hidePopups()));
themeMenu.addEventListener("click", (e) => {
  const item = e.target.closest("[data-theme-id]");
  if (!item) return;
  setTheme(item.dataset.themeId);
  openThemeMenu(); // stays open so you can flip through themes
});
setTheme(currentTheme(), false); // the server already painted the saved theme

ctx.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (btn) run(btn.dataset.action);
});

document.addEventListener("mousedown", (e) => {
  if (!e.target.closest("#ctx, #listCtx, #ddMenu, #filters, #themeMenu, #themeBtn")) hidePopups();
});
addEventListener("blur", hidePopups);
addEventListener("scroll", (e) => { if (!ddMenu.contains(e.target) && !themeMenu.contains(e.target)) hidePopups(); }, true);

// Poster size: slider or Ctrl + mouse wheel; remembered in the app folder.
const sizeSlider = $("#sizeSlider");

let saveSizeTimer;
function setPosterSize(px, save = true) {
  px = Math.max(+sizeSlider.min, Math.min(+sizeSlider.max, Math.round(px / 10) * 10));
  sizeSlider.value = px;
  for (const el of [grid, listsView]) {
    el.style.setProperty("--poster", `${px}px`);
    el.dataset.size = px < 140 ? "s" : px > 260 ? "l" : "m";
  }
  if (save) {
    clearTimeout(saveSizeTimer); // the slider fires on every step; save once it settles
    saveSizeTimer = setTimeout(() => saveSetting("posterSize", px), 400);
  }
}

sizeSlider.addEventListener("input", () => setPosterSize(+sizeSlider.value));
const zoomPosters = (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  hideHovercard();
  setPosterSize(+sizeSlider.value - Math.sign(e.deltaY) * 20);
};
grid.addEventListener("wheel", zoomPosters, { passive: false });
listsView.addEventListener("wheel", zoomPosters, { passive: false });

setPosterSize(180, false); // the saved size arrives with the first /api/state

$("#missingChip").addEventListener("click", () => {
  state.missingOnly = !state.missingOnly;
  render();
  scrollTo({ top: 0 });
});

$("#search").addEventListener("input", (e) => { state.query = e.target.value.trim(); render(); });
$("#searchForm").addEventListener("submit", (e) => e.preventDefault());

$("#coverInput").addEventListener("change", (e) => {
  if (!$("#detailsModal").hidden || !$("#listModal").hidden) return; // the dialogs handle their own pick
  const file = e.target.files[0];
  if (file && state.coverList) return setCollectionCover(state.coverList, file).catch((err) => toast(err.message));
  if (file && state.coverTarget) setCoverFromFile(state.coverTarget, file).catch((err) => toast(err.message));
});

// Drop an image onto a poster to use it.
grid.addEventListener("dragover", (e) => {
  const card = e.target.closest(".card[data-id]");
  e.preventDefault();
  hideHovercard();
  e.dataTransfer.dropEffect = card ? "copy" : "none";
  grid.querySelectorAll(".card.drop").forEach((c) => c !== card && c.classList.remove("drop"));
  card?.classList.add("drop");
});
grid.addEventListener("dragleave", (e) => {
  if (!grid.contains(e.relatedTarget)) grid.querySelectorAll(".card.drop").forEach((c) => c.classList.remove("drop"));
});
grid.addEventListener("drop", (e) => {
  e.preventDefault();
  grid.querySelectorAll(".card.drop").forEach((c) => c.classList.remove("drop"));
  const item = cardItem(e.target);
  const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
  if (item && file) {
    select(item.id);
    setCoverFromFile(item.id, file).catch((err) => toast(err.message));
  } else if (item) {
    toast("Drop an image file to use it as the poster");
  }
});
// Forms are handled in JS; never let one reload the page.
document.addEventListener("submit", (e) => e.preventDefault());
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

// Paste an image (Ctrl+V) to make it the selected movie's poster.
document.addEventListener("paste", (e) => {
  if (!state.selected || e.target.matches("input, textarea") || document.querySelector(".modal-backdrop:not([hidden])")) return;
  const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
  if (file) setCoverFromFile(state.selected, file).catch((err) => toast(err.message));
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches?.("input, textarea") || document.querySelector(".modal-backdrop:not([hidden])")) return;
  if (state.view === "lists") {
    if (e.key === "Escape") hidePopups();
    return;
  }
  if (state.selecting) {
    if (e.key === "Escape") run("exitSelect");
    if (e.key === "Delete") run("bulkDelete");
    if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run("selectAll"); }
    return;
  }
  if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setSelecting(true); run("selectAll"); return; }
  if (e.key === "Escape") { hidePopups(); select(null); }
  const item = selectedItem();
  if (!item || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === "Enter") run("play");
  if (e.key === "Delete") run("delete");
  if (e.key === "F2") { e.preventDefault(); run("details"); }
  if (e.key.toLowerCase() === "w") run("toggleWatched");
  // 1-5: rate in whole stars (Shift for the half below), 0: clear
  const n = "012345".indexOf(e.code.replace("Digit", "").replace("Numpad", ""));
  if (n >= 0 && /^(Digit|Numpad)\d$/.test(e.code)) rate(item, n ? n * 2 - (e.shiftKey ? 1 : 0) : 0);
});

// Own title bar: the desktop app (Cover.exe) has no Windows title bar, so the top bar takes
// its place, like Spotify or Discord. In a browser window none of this shows.
if (typeof window.ipc?.postMessage === "function") {
  const send = (m) => window.ipc.postMessage(m);
  const line = (d) => `<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">${d}</svg>`;
  const WIN = {
    minimize: line('<path d="M0 5.5h10"/>'),
    maximize: line('<rect x=".5" y=".5" width="9" height="9"/>'),
    restore: line('<rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V.5h7v7h-2"/>'),
    close: line('<path d="M.5.5l9 9M9.5.5l-9 9"/>'),
  };
  document.documentElement.classList.add("native-frame");
  const topbar = $(".topbar");
  // Everything under the title bar sits on one rounded panel that scrolls on its own, so
  // the title bar never moves and the scrollbar starts below it.
  const scroller = document.createElement("div");
  scroller.className = "scroller";
  topbar.after(scroller);
  scroller.append(...["#menu", "#listHeader", "#sectionBar", "#grid", "#listsView"].map((s) => $(s)));
  window.scrollTo = (...args) => scroller.scrollTo(...args);
  const controls = document.createElement("div");
  controls.className = "window-controls";
  controls.innerHTML = `
    <button type="button" data-win="minimize" title="Minimize" aria-label="Minimize">${WIN.minimize}</button>
    <button type="button" data-win="maximize" title="Maximize" aria-label="Maximize">${WIN.maximize}</button>
    <button type="button" data-win="close" class="win-close" title="Close" aria-label="Close">${WIN.close}</button>`;
  topbar.append(controls);
  // Library / Collections stay at the right end of the menu row, as a segmented switch
  // whose labels hide on narrow windows.
  const tabs = $(".view-tabs");
  for (const b of tabs.querySelectorAll("button")) {
    const label = b.lastChild;
    if (label?.nodeType !== Node.TEXT_NODE) continue;
    const span = document.createElement("span");
    span.textContent = label.textContent;
    label.replaceWith(span);
    b.title = span.textContent; // the label hides on narrow windows
  }
  // The switch ends right under the Theme button, whatever the window's width.
  const menu = $("#menu"), themeBtn = $("#themeBtn");
  const alignTabs = () => {
    const edge = themeBtn.getBoundingClientRect().right;
    const right = menu.getBoundingClientRect().right;
    if (edge > 0 && right > edge) menu.style.paddingRight = `${Math.round(right - edge)}px`;
  };
  const watchEdges = new ResizeObserver(alignTabs);
  for (const el of [menu, topbar, themeBtn]) watchEdges.observe(el, { box: "border-box" });
  addEventListener("resize", alignTabs);
  // The highlight slides between Library and Collections.
  const thumb = document.createElement("span");
  thumb.className = "tab-thumb";
  tabs.prepend(thumb);
  // Until it can be measured (the window may start minimized) the active tab keeps its own fill.
  const moveThumb = () => {
    const on = tabs.querySelector("button.active");
    const w = on?.offsetWidth || 0;
    if (w) Object.assign(thumb.style, { left: `${on.offsetLeft}px`, width: `${w}px` });
    tabs.classList.toggle("thumbed", w > 0);
    if (w && !thumb.classList.contains("ready")) requestAnimationFrame(() => thumb.classList.add("ready"));
  };
  const watchTabs = new MutationObserver(moveThumb);
  tabs.querySelectorAll("button").forEach((b) => watchTabs.observe(b, { attributes: true, attributeFilter: ["class"] }));
  new ResizeObserver(moveThumb).observe(tabs);
  addEventListener("resize", moveThumb);
  document.addEventListener("visibilitychange", moveThumb);
  moveThumb();
  const maxBtn = controls.querySelector('[data-win="maximize"]');
  controls.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-win]");
    if (b) send("window:" + b.dataset.win);
  });
  // The app tells us when the window is maximized (by us, Win+Up, snapping...).
  window.__setMaximized = (on) => {
    document.documentElement.classList.toggle("maximized", on);
    maxBtn.innerHTML = on ? WIN.restore : WIN.maximize;
    maxBtn.title = on ? "Restore" : "Maximize";
    maxBtn.setAttribute("aria-label", maxBtn.title);
  };
  // Empty parts of the title bar move the window; a double-click maximizes it.
  topbar.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("button, input, a, form, .window-controls")) return;
    e.preventDefault();
    send(e.detail === 2 ? "window:maximize" : "window:drag");
  });
  // The page covers the window's top border, so the top edge and corners resize from here.
  for (const edge of ["n", "nw", "ne"]) {
    const grip = document.createElement("div");
    grip.className = `resize-grip resize-${edge}`;
    grip.addEventListener("mousedown", (e) => {
      if (e.button === 0) { e.preventDefault(); send("window:resize-" + edge); }
    });
    document.body.append(grip);
  }
  send("window:ready");
}

// Heartbeat: the server shuts itself down once the window is closed.
// When the app is updated the server restarts itself and its version changes;
// the page then reloads so both sides run the new code (waiting while you're mid-task).
let appVersion = null;
let warnedOutdated = false;
const ping = () => fetch("/api/ping", { method: "POST", body: "{}" })
  .then((r) => r.json())
  .then((r) => {
    appVersion ??= r.version;
    const busy = state.selecting || document.querySelector(".modal-backdrop:not([hidden])");
    if (r.version && r.version !== appVersion && !busy) {
      try { sessionStorage.setItem("restoreView", JSON.stringify({ view: state.view, listId: state.listId })); } catch { /* fine */ }
      return location.reload();
    }
    // The server couldn't restart itself (e.g. its new code has an error).
    if (r.outdated && !warnedOutdated) {
      warnedOutdated = true;
      toast("Cover was updated. Close this window and open it again to finish.", 600000);
    }
  })
  .catch(() => {});
setInterval(ping, 5000);
ping();
addEventListener("pagehide", () => navigator.sendBeacon("/api/bye", "{}"));

api("/api/state")
  .then(({ settings = {} }) => {
    if (settings.posterSize) setPosterSize(settings.posterSize, false);
    if (SORTS.some(([k]) => k === settings.sort)) state.sort = settings.sort;
    state.showTitles = !!settings.showTitles;
    // Back to where you were before an automatic reload.
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem("restoreView")); sessionStorage.removeItem("restoreView"); } catch { /* fine */ }
    if (saved?.view === "list" && !state.lists.some((l) => l.id === saved.listId)) saved.view = "lists";
    if (saved && saved.view !== "library") go(saved.view, saved.view === "list" ? saved.listId : null);
    else render();
  })
  .catch((e) => toast(e.message));
