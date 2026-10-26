/* ==========================================================================
   Travel Horizon — admin panel
   Talks to the REST API in server.js. Requires the site to run with `npm start`.
   ========================================================================== */

const LANGS = { en: "English", ru: "Русский", es: "Español", it: "Italiano", ky: "Кыргызча", fr: "Français" };
const CATEGORIES = { lakes: "🌊 Lakes", mountains: "🏔️ Mountains", history: "🏛️ History", cities: "🏙️ Cities" };
const DEFAULT_LOCATION = [41.4, 75.0]; // centre of Kyrgyzstan

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let me = null;          // logged-in user
let places = [];        // all places from the API
let editingId = null;   // id of the place being edited, null when adding
let idTouched = false;  // stop auto-filling the ID once the user edits it
let dirty = false;      // unsaved changes in the editor
let pickMap = null;
let pickMarker = null;

/* ---------- Helpers ---------- */
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== "api/login") {
    showLogin();
    throw new Error(data.error || "Please log in again.");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function confirmDialog(message, okLabel = "Delete") {
  const dialog = $("#confirm");
  $("#confirm-text").textContent = message;
  $("#confirm-ok").textContent = okLabel;
  dialog.showModal();
  return new Promise((resolve) => {
    const done = (answer) => { dialog.close(); cleanup(); resolve(answer); };
    const ok = () => done(true);
    const cancel = () => done(false);
    const onClose = () => { cleanup(); resolve(false); };
    function cleanup() {
      $("#confirm-ok").removeEventListener("click", ok);
      $("#confirm-cancel").removeEventListener("click", cancel);
      dialog.removeEventListener("close", onClose);
    }
    $("#confirm-ok").addEventListener("click", ok);
    $("#confirm-cancel").addEventListener("click", cancel);
    dialog.addEventListener("close", onClose);
  });
}

const slugify = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/* ---------- Views ---------- */
function showView(name) {
  ["places", "editor", "users"].forEach((v) => ($(`#${v}-view`).hidden = v !== name));
  $$(".admin-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === (name === "editor" ? "places" : name)));
  window.scrollTo({ top: 0 });
}

function showLogin() {
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
  $("#login-username").focus();
}

async function showApp() {
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  $("#who").textContent = me.username;
  showView("places");
  await loadPlaceList();
}

/* ---------- Login / logout ---------- */
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#login-error");
  error.textContent = "";
  try {
    await api("POST", "api/login", {
      username: $("#login-username").value.trim(),
      password: $("#login-password").value,
    });
    me = await api("GET", "api/me");
    $("#login-password").value = "";
    await showApp();
  } catch (err) {
    error.textContent = err.message;
  }
});

$("#logout").addEventListener("click", async () => {
  if (dirty && !(await confirmDialog("You have unsaved changes. Log out anyway?", "Log out"))) return;
  dirty = false;
  await api("POST", "api/logout").catch(() => {});
  me = null;
  showLogin();
});

/* ---------- Places list ---------- */
async function loadPlaceList() {
  try {
    places = await api("GET", "api/places");
    renderPlaceList();
  } catch (err) {
    toast(err.message, true);
  }
}

function renderPlaceList() {
  const term = $("#place-search").value.trim().toLowerCase();
  const list = places.filter((p) => !term || p.id.includes(term) || JSON.stringify(p.texts).toLowerCase().includes(term));
  $("#places-count").textContent = `${places.length} places on the website`;
  $("#place-list").innerHTML = list.length ? list.map((p) => {
    const en = p.texts.en || {};
    const filled = Object.keys(LANGS).filter((l) => p.texts[l]?.title).length;
    return `
      <article class="place-row" data-id="${esc(p.id)}">
        <img src="${esc(p.image)}" alt="" loading="lazy">
        <div class="place-row__info">
          <strong>${esc(p.emoji)} ${esc(en.title)}</strong>
          <span class="muted">${esc(p.id)} · ${p.category.map((c) => CATEGORIES[c] || c).join(", ")}</span>
        </div>
        <span class="lang-count ${filled < 6 ? "warn" : ""}" title="Languages with a title">🌐 ${filled}/6</span>
        <div class="place-row__actions">
          <button class="btn btn--outline btn--sm" data-action="edit">Edit</button>
          <button class="btn btn--danger btn--sm" data-action="delete">Delete</button>
        </div>
      </article>`;
  }).join("") : `<p class="empty-state">No places found.</p>`;
}

$("#place-search").addEventListener("input", renderPlaceList);
$("#add-place").addEventListener("click", () => openEditor(null));

$("#place-list").addEventListener("click", async (e) => {
  const row = e.target.closest(".place-row");
  if (!row) return;
  const place = places.find((p) => p.id === row.dataset.id);
  if (e.target.dataset.action === "delete") {
    const title = place.texts.en?.title || place.id;
    if (!(await confirmDialog(`Delete "${title}"? It will disappear from the website in all languages.`))) return;
    try {
      await api("DELETE", `api/places/${encodeURIComponent(place.id)}`);
      places = places.filter((p) => p.id !== place.id);
      renderPlaceList();
      toast(`"${title}" was deleted.`);
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  openEditor(place);
});

/* ---------- Editor: build the form once ---------- */
function buildEditor() {
  $("#lang-tabs").innerHTML = Object.entries(LANGS).map(([code, name]) =>
    `<button type="button" class="lang-tab" role="tab" data-lang="${code}">${name}${code === "en" ? " *" : ""}</button>`).join("");
  $("#lang-panes").innerHTML = Object.keys(LANGS).map((code) => `
    <div class="lang-pane" data-lang="${code}" hidden>
      <div class="form-row">
        <div class="field">
          <label for="${code}-title">Title${code === "en" ? " *" : ""}</label>
          <input id="${code}-title" data-field="title" maxlength="80" placeholder="e.g. Song-Kul Lake">
        </div>
        <div class="field">
          <label for="${code}-badge">Badge <span class="muted">(short label on the photo)</span></label>
          <input id="${code}-badge" data-field="badge" maxlength="40" placeholder="e.g. Lake · Nomads">
        </div>
      </div>
      <div class="field">
        <label for="${code}-description">Description${code === "en" ? " *" : ""} <span class="counter" data-counter></span></label>
        <textarea id="${code}-description" data-field="description" rows="5" maxlength="600"></textarea>
      </div>
      <div class="field">
        <label for="${code}-tags">Tags <span class="muted">(one per line, up to 6; emoji welcome)</span></label>
        <textarea id="${code}-tags" data-field="tags" rows="3" placeholder="📍 Naryn&#10;☀️ Jun–Sep"></textarea>
      </div>
    </div>`).join("");

  $("#category-checks").innerHTML = Object.entries(CATEGORIES).map(([value, label]) =>
    `<label><input type="checkbox" name="category" value="${value}"> ${label}</label>`).join("");

  $("#lang-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".lang-tab");
    if (tab) switchLang(tab.dataset.lang);
  });

  const form = $("#place-form");
  form.addEventListener("input", (e) => {
    dirty = true;
    if (e.target.id === "en-title" && !editingId && !idTouched) $("#place-id").value = slugify(e.target.value);
    if (e.target.id === "place-id") idTouched = true;
    if (["lat", "lng"].includes(e.target.id)) moveMarker(Number($("#lat").value), Number($("#lng").value), false);
    updateLangState();
  });
  form.addEventListener("submit", savePlace);
}

function switchLang(code) {
  $$(".lang-tab").forEach((t) => t.classList.toggle("active", t.dataset.lang === code));
  $$(".lang-pane").forEach((p) => (p.hidden = p.dataset.lang !== code));
}

function updateLangState() {
  for (const code of Object.keys(LANGS)) {
    const filled = $(`#${code}-title`).value.trim() && $(`#${code}-description`).value.trim();
    const tab = $(`.lang-tab[data-lang="${code}"]`);
    tab.classList.toggle("filled", !!filled);
    tab.classList.toggle("required", code === "en" && !filled);
    const desc = $(`#${code}-description`);
    $(`.lang-pane[data-lang="${code}"] [data-counter]`).textContent = `${desc.value.length}/600`;
  }
}

/* ---------- Editor: open / close ---------- */
function openEditor(place) {
  editingId = place ? place.id : null;
  idTouched = !!place;
  $("#editor-title").textContent = place ? `Edit: ${place.texts.en?.title || place.id}` : "Add a new place";
  $("#form-errors").hidden = true;

  $("#place-form").reset();
  $("#place-id").value = place?.id || "";
  $("#place-id").readOnly = !!place;
  $$("#category-checks input").forEach((c) => (c.checked = !!place?.category.includes(c.value)));
  $("#emoji").value = place?.emoji || "";
  $("#sort").value = place?.sort ?? places.length;
  $("#credit").value = place?.credit || "";
  for (const code of Object.keys(LANGS)) {
    const tx = place?.texts[code] || {};
    $(`#${code}-title`).value = tx.title || "";
    $(`#${code}-badge`).value = tx.badge || "";
    $(`#${code}-description`).value = tx.description || "";
    $(`#${code}-tags`).value = (tx.tags || []).join("\n");
  }
  setPhoto(place?.image || "", place?.photo || "");
  loadPhotoOptions(place?.image || "");

  showView("editor");
  switchLang("en");
  updateLangState();
  initPickMap();
  const [lat, lng] = place ? [place.lat, place.lng] : DEFAULT_LOCATION;
  moveMarker(lat, lng, true, !!place);
  dirty = false;
}

async function closeEditor() {
  if (dirty && !(await confirmDialog("Discard your unsaved changes?", "Discard"))) return;
  dirty = false;
  showView("places");
  renderPlaceList();
}
$$("[data-close-editor]").forEach((b) => b.addEventListener("click", closeEditor));

window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------- Editor: photo ---------- */
function setPhoto(path, photoKey) {
  $("#place-form").elements.image.value = path;
  $("#place-form").elements.photo.value = photoKey;
  const preview = $("#photo-preview");
  preview.classList.toggle("has-image", !!path);
  preview.innerHTML = path ? `<img src="${esc(path)}" alt="">` : "<span>No photo yet</span>";
}

async function loadPhotoOptions(selected) {
  const select = $("#photo-select");
  try {
    const images = await api("GET", "api/images");
    select.innerHTML = `<option value="">Choose…</option>` +
      images.map((p) => `<option value="${esc(p)}" ${p === selected ? "selected" : ""}>${esc(p.replace(/^images\//, ""))}</option>`).join("");
  } catch (err) {
    toast(err.message, true);
  }
}

$("#photo-select").addEventListener("change", (e) => {
  const path = e.target.value;
  if (!path) return;
  // Built-in photos have their credit in js/credits.js, keyed by file name
  const key = path.replace(/^images\//, "").replace(/\.\w+$/, "");
  const known = !!(window.PHOTO_CREDITS || {})[key];
  setPhoto(path, known ? key : "");
  if (known) $("#credit").value = "";
  dirty = true;
});

// Shrink big photos in the browser before uploading (max 1600 px wide, JPEG)
function resizeImage(file, maxWidth = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("This file could not be read as an image."));
    img.src = URL.createObjectURL(file);
  });
}

$("#photo-upload").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = $("#upload-status");
  status.textContent = "Uploading…";
  try {
    const data = await resizeImage(file);
    const { path } = await api("POST", "api/upload", { name: file.name, data });
    setPhoto(path, "");
    await loadPhotoOptions(path);
    status.textContent = "✅ Photo uploaded. Remember to add a photo credit.";
    dirty = true;
  } catch (err) {
    status.textContent = `❌ ${err.message}`;
  }
  e.target.value = "";
});

/* ---------- Editor: location picker (Leaflet) ---------- */
function initPickMap() {
  if (pickMap || !window.L) {
    if (!window.L) $("#pick-map").innerHTML = '<p class="hint" style="padding:16px">The map needs an internet connection. Type the coordinates below.</p>';
    pickMap?.invalidateSize();
    return;
  }
  pickMap = L.map("pick-map").setView(DEFAULT_LOCATION, 6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 18,
  }).addTo(pickMap);
  pickMarker = L.marker(DEFAULT_LOCATION, { draggable: true }).addTo(pickMap);
  pickMarker.on("dragend", () => {
    const { lat, lng } = pickMarker.getLatLng();
    moveMarker(lat, lng, true);
    dirty = true;
  });
  pickMap.on("click", (e) => {
    moveMarker(e.latlng.lat, e.latlng.lng, true);
    dirty = true;
  });
}

function moveMarker(lat, lng, updateInputs, zoomIn = false) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (updateInputs) {
    $("#lat").value = lat.toFixed(4);
    $("#lng").value = lng.toFixed(4);
  }
  if (!pickMap) return;
  pickMarker.setLatLng([lat, lng]);
  // Leaflet needs a size update once the editor becomes visible
  setTimeout(() => {
    pickMap.invalidateSize();
    pickMap.setView([lat, lng], zoomIn ? 9 : pickMap.getZoom());
  }, 50);
}

/* ---------- Editor: save ---------- */
function collectForm() {
  const form = $("#place-form");
  const texts = {};
  for (const code of Object.keys(LANGS)) {
    texts[code] = {
      title: $(`#${code}-title`).value.trim(),
      badge: $(`#${code}-badge`).value.trim(),
      description: $(`#${code}-description`).value.trim(),
      tags: $(`#${code}-tags`).value.split("\n").map((t) => t.trim()).filter(Boolean),
    };
  }
  return {
    id: $("#place-id").value.trim(),
    category: $$("#category-checks input:checked").map((c) => c.value),
    lat: Number($("#lat").value),
    lng: Number($("#lng").value),
    image: form.elements.image.value,
    photo: form.elements.photo.value,
    credit: $("#credit").value.trim(),
    emoji: $("#emoji").value.trim(),
    sort: Number($("#sort").value) || 0,
    texts,
  };
}

function checkForm(data) {
  const errors = [];
  if (!data.texts.en.title) errors.push("Write an English title.");
  if (!data.texts.en.description) errors.push("Write an English description.");
  if (!/^[a-z0-9-]{2,40}$/.test(data.id)) errors.push("The ID may only contain lowercase letters, numbers and dashes (2–40 characters).");
  if (!data.category.length) errors.push("Choose at least one category.");
  if (!data.image) errors.push("Upload or choose a photo.");
  if (!$("#lat").value || !$("#lng").value) errors.push("Set the location on the map.");
  return errors;
}

async function savePlace(e) {
  e.preventDefault();
  const data = collectForm();
  const errors = checkForm(data);
  const box = $("#form-errors");
  if (errors.length) {
    box.innerHTML = `<strong>Please fix the following:</strong><ul>${errors.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`;
    box.hidden = false;
    if (!data.texts.en.title || !data.texts.en.description) switchLang("en");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  box.hidden = true;
  try {
    const saved = editingId
      ? await api("PUT", `api/places/${encodeURIComponent(editingId)}`, data)
      : await api("POST", "api/places", data);
    const i = places.findIndex((p) => p.id === saved.id);
    if (i >= 0) places[i] = saved; else places.push(saved);
    places.sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
    dirty = false;
    toast(`"${saved.texts.en.title}" was saved. It's live on the website.`);
    showView("places");
    renderPlaceList();
  } catch (err) {
    box.innerHTML = `<strong>Could not save:</strong> ${esc(err.message)}`;
    box.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

/* ---------- Users ---------- */
async function loadUsers() {
  try {
    const users = await api("GET", "api/users");
    $("#user-list").innerHTML = users.map((u) => `
      <div class="user-row" data-id="${u.id}">
        <span class="user-row__avatar">${esc(u.username[0])}</span>
        <div><strong>${esc(u.username)}${u.username === me.username ? " (you)" : ""}</strong>
          <span>Added ${esc(new Date(u.createdAt + "Z").toLocaleDateString())}</span></div>
        ${u.username === me.username ? "" : `<button class="btn btn--danger btn--sm" data-action="delete-user">Remove</button>`}
      </div>`).join("");
  } catch (err) {
    toast(err.message, true);
  }
}

$("#user-list").addEventListener("click", async (e) => {
  if (e.target.dataset.action !== "delete-user") return;
  const row = e.target.closest(".user-row");
  const name = row.querySelector("strong").textContent;
  if (!(await confirmDialog(`Remove ${name}? They will no longer be able to log in.`, "Remove"))) return;
  try {
    await api("DELETE", `api/users/${row.dataset.id}`);
    toast(`${name} was removed.`);
    loadUsers();
  } catch (err) {
    toast(err.message, true);
  }
});

$("#add-user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api("POST", "api/users", { username: form.username.value.trim(), password: form.password.value });
    toast(`${form.username.value.trim()} can now log in.`);
    form.reset();
    loadUsers();
  } catch (err) {
    toast(err.message, true);
  }
});

$("#password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.next.value !== form.confirm.value) return toast("The new passwords don't match.", true);
  try {
    await api("PUT", "api/users/me/password", { current: form.current.value, next: form.next.value });
    toast("Your password was changed.");
    form.reset();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------- Tabs ---------- */
$(".admin-tabs").addEventListener("click", async (e) => {
  const tab = e.target.closest("button");
  if (!tab) return;
  if (!$("#editor-view").hidden && dirty && !(await confirmDialog("Discard your unsaved changes?", "Discard"))) return;
  dirty = false;
  if (tab.dataset.tab === "users") { showView("users"); loadUsers(); }
  else { showView("places"); renderPlaceList(); }
});

/* ---------- Start ---------- */
buildEditor();
(async function start() {
  if (!location.protocol.startsWith("http")) {
    $("#file-warning").hidden = false;
    showLogin();
    return;
  }
  try {
    me = await api("GET", "api/me");
    await showApp();
  } catch (e) {
    showLogin();
  }
})();
