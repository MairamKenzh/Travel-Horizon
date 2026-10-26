/* ==========================================================================
   Travel Horizon — site scripts
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  initLanguage();
  initHeader();
  initNav();
  initBackToTop();
  initReveal();
  initHeroSlider();
  initCounters();
  initCredits();
  initFlag();
  initDestinations().then(initMap);
  initConverter();
  initTripForm();
  setYear();
});

/* ---------- Languages ----------
   English text lives in the HTML (elements marked with data-i18n="key").
   Other languages are in js/i18n/<code>.js as window.I18N.<code> = { key: "text" }.
   A missing key falls back to the English original. */
const LANGUAGES = {
  en: "English",
  ru: "Русский",
  es: "Español",
  it: "Italiano",
  ky: "Кыргызча",
  fr: "Français",
};

// English versions of strings created by scripts (not present in the HTML)
const SCRIPT_STRINGS = {
  "js.som": "KGS (som)",
  "js.success": "Rakhmat, {name}! Your trip request has been received. Our team will email you within 24 hours with a personalised itinerary.",
  "js.count": "Showing {n} of {total} places",
  "js.maps": "Open in Google Maps",
  "js.plan": "Plan a trip here",
  "js.details": "View details",
  "js.prev": "← Previous",
  "js.next": "Next →",
  "js.photo": "Photo",
  "js.close": "Close",
  "js.mapError": "The map needs an internet connection to load.",
  "card.more": "View details",
};

let currentLang = "en";

function t(key, vars = {}) {
  const dict = (window.I18N || {})[currentLang] || {};
  const text = dict[key] ?? SCRIPT_STRINGS[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
}

function initLanguage() {
  // Remember the English originals so we can switch back without reloading
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.dataset.en = el.innerHTML));
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => (el.dataset.enPlaceholder = el.placeholder));

  const box = document.querySelector(".lang");
  if (box) {
    box.innerHTML = `
      <button class="lang__btn" aria-haspopup="true" aria-expanded="false" aria-label="Language">
        🌐 <span class="lang__code">EN</span> <span aria-hidden="true">▾</span>
      </button>
      <ul class="lang__menu">
        ${Object.entries(LANGUAGES).map(([code, name]) =>
          `<li><button data-lang="${code}">${name} <small>${code.toUpperCase()}</small></button></li>`).join("")}
      </ul>`;

    const btn = box.querySelector(".lang__btn");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = box.classList.toggle("open");
      btn.setAttribute("aria-expanded", open);
    });
    box.querySelectorAll("[data-lang]").forEach((option) => {
      option.addEventListener("click", () => {
        setLanguage(option.dataset.lang);
        box.classList.remove("open");
        btn.setAttribute("aria-expanded", false);
      });
    });
    document.addEventListener("click", () => box.classList.remove("open"));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") box.classList.remove("open");
    });
  }

  let saved = null;
  try { saved = localStorage.getItem("lang"); } catch (e) { /* storage unavailable */ }
  const browser = (navigator.language || "en").slice(0, 2);
  setLanguage(LANGUAGES[saved] ? saved : LANGUAGES[browser] ? browser : "en");
}

function setLanguage(lang) {
  currentLang = lang;
  const dict = lang === "en" ? {} : (window.I18N || {})[lang] || {};
  document.documentElement.lang = lang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.innerHTML = dict[el.dataset.i18n] ?? el.dataset.en;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = dict[el.dataset.i18nPlaceholder] ?? el.dataset.enPlaceholder;
  });

  const code = document.querySelector(".lang__code");
  if (code) code.textContent = lang.toUpperCase();
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-current", b.dataset.lang === lang));

  try { localStorage.setItem("lang", lang); } catch (e) { /* storage unavailable */ }
  document.dispatchEvent(new CustomEvent("languagechange"));
}

/* ---------- Header: solid background after scrolling + progress bar ---------- */
function initHeader() {
  const header = document.querySelector(".header");
  const progress = document.querySelector(".progress");
  function update() {
    header?.classList.toggle("scrolled", window.scrollY > 40 || header.classList.contains("menu-open"));
    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = max > 0 ? `${(window.scrollY / max) * 100}%` : "0";
    }
  }
  window.addEventListener("scroll", update, { passive: true });
  update();
}

/* ---------- Mobile menu + active page link ---------- */
function initNav() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open);
      toggle.textContent = open ? "✕" : "☰";
      // Keep the header readable while the menu is open over the hero
      document.querySelector(".header").classList.toggle("menu-open", open);
      window.dispatchEvent(new Event("scroll"));
    });
  }

  const page = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav a").forEach((link) => {
    if (link.getAttribute("href") === page) link.classList.add("active");
  });
}

/* ---------- Back-to-top button ---------- */
function initBackToTop() {
  const btn = document.querySelector(".to-top");
  if (!btn) return;
  window.addEventListener("scroll", () => {
    btn.classList.toggle("show", window.scrollY > 600);
  }, { passive: true });
  btn.addEventListener("click", () => window.scrollTo({ top: 0 }));
}

/* ---------- Fade sections in when they scroll into view ---------- */
function initReveal() {
  const items = document.querySelectorAll(".reveal");
  // Stagger siblings so grids appear one card after another
  items.forEach((el) => {
    const siblings = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
    el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 6) * 80}ms`;
  });
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  items.forEach((el) => observer.observe(el));
}

/* ---------- Home hero slideshow ---------- */
function initHeroSlider() {
  const slides = document.querySelectorAll(".hero__slide");
  if (!slides.length) return;
  const dots = document.querySelector(".hero__dots");
  const caption = document.querySelector(".hero__caption");
  let index = 0;
  let timer;

  slides.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.setAttribute("aria-label", `Slide ${i + 1}`);
    dot.addEventListener("click", () => { show(i); restart(); });
    dots?.appendChild(dot);
  });

  function show(i) {
    index = (i + slides.length) % slides.length;
    slides.forEach((s, n) => s.classList.toggle("active", n === index));
    dots?.querySelectorAll("button").forEach((d, n) => d.classList.toggle("active", n === index));
    const text = slides[index].querySelector(".hero__slide-caption");
    if (caption && text) caption.textContent = `📍 ${text.textContent}`;
  }
  function restart() {
    clearInterval(timer);
    timer = setInterval(() => show(index + 1), 6000);
  }

  document.addEventListener("languagechange", () => show(index));
  show(0);
  restart();
}

/* ---------- Animated number counters ---------- */
function initCounters() {
  const counters = document.querySelectorAll("[data-count]");
  if (!counters.length) return;

  function format(el, value) {
    const grouped = el.dataset.plain === undefined;
    const num = grouped ? Math.round(value).toLocaleString(currentLang) : String(Math.round(value));
    el.textContent = (el.dataset.prefix || "") + num + (el.dataset.suffix || "");
  }
  function animate(el) {
    const target = Number(el.dataset.count);
    const start = performance.now();
    const duration = 1600;
    (function step(now) {
      const p = Math.min((now - start) / duration, 1);
      format(el, target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(start);
  }

  counters.forEach((el) => format(el, 0));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { animate(entry.target); observer.unobserve(entry.target); }
    });
  }, { threshold: 0.5 });
  counters.forEach((el) => observer.observe(el));
  document.addEventListener("languagechange", () => counters.forEach((el) => format(el, Number(el.dataset.count))));
}

/* ---------- Photo credits (Wikimedia Commons, see js/credits.js) ---------- */
function creditHtml(name) {
  const c = (window.PHOTO_CREDITS || {})[name];
  if (!c) return "";
  return `${t("js.photo")}: <a href="${c.source}" target="_blank" rel="noopener">${c.author}</a>, ${c.license}`;
}

function initCredits() {
  function render() {
    document.querySelectorAll("[data-credit]").forEach((el) => (el.innerHTML = creditHtml(el.dataset.credit)));
    const list = document.querySelector("#credits-list");
    if (list && window.PHOTO_CREDITS) {
      list.innerHTML = Object.values(window.PHOTO_CREDITS).map((c) =>
        `<li><a href="${c.source}" target="_blank" rel="noopener">${c.file}</a> by ${c.author} (${c.license})</li>`).join("");
    }
  }
  document.addEventListener("languagechange", render);
  render();
}

/* ---------- Flag of Kyrgyzstan: draw the 40 sun rays ---------- */
function initFlag() {
  const rays = document.querySelector("#flag [data-rays]");
  if (!rays) return;
  const cx = 150, cy = 90, inner = 26, outer = 52;
  let html = "";
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const w = Math.PI / 40; // half-width of each ray at its base
    const p = (r, ang) => `${(cx + r * Math.cos(ang)).toFixed(1)},${(cy + r * Math.sin(ang)).toFixed(1)}`;
    // Rays alternate slightly in length, like on the real flag
    html += `<polygon points="${p(inner, a - w)} ${p(i % 2 ? outer : outer - 5, a)} ${p(inner, a + w)}"/>`;
  }
  rays.innerHTML = html;
}

/* ---------- Destinations: filter, search, details modal ---------- */
let openPlace = null; // set by initDestinations, used by the map

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Places from the database (server.js). Returns null when the site is opened as a plain file.
async function loadPlaces() {
  if (!location.protocol.startsWith("http")) return null;
  try {
    const res = await fetch("api/places");
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

// Text of a place in the current language, falling back to English field by field
function placeText(place) {
  const en = place.texts.en || {};
  const local = place.texts[currentLang] || {};
  return {
    badge: local.badge || en.badge || "",
    title: local.title || en.title || "",
    description: local.description || en.description || "",
    tags: local.tags?.length ? local.tags : en.tags || [],
  };
}

function placeCardHtml(p) {
  const tx = placeText(p);
  return `
    <article class="dest-card" tabindex="0" data-id="${escapeHtml(p.id)}" data-category="${escapeHtml(p.category.join(" "))}"
      data-lat="${Number(p.lat)}" data-lng="${Number(p.lng)}" data-photo="${escapeHtml(p.photo)}"
      data-photo-credit="${escapeHtml(p.credit)}" data-emoji="${escapeHtml(p.emoji)}">
      <div class="dest-card__img">
        <img src="${escapeHtml(p.image)}" alt="${escapeHtml(tx.title)}" loading="lazy">
        ${tx.badge ? `<span class="pill">${escapeHtml(tx.badge)}</span>` : ""}
        <span class="dest-card__more">${escapeHtml(t("card.more"))}</span>
      </div>
      <div class="dest-card__body">
        <h3>${escapeHtml(tx.title)}</h3>
        <p>${escapeHtml(tx.description)}</p>
        <div class="card__meta">${tx.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      </div>
    </article>`;
}

async function initDestinations() {
  const grid = document.querySelector("#destinations-grid");
  if (!grid) return;

  // On the server, cards are built from the database (managed in admin.html).
  // Opened as a plain file, the cards already written in destinations.html are used.
  const places = await loadPlaces();
  if (places) {
    const render = () => { grid.innerHTML = places.map(placeCardHtml).join(""); };
    render();
    document.addEventListener("languagechange", render);
  }
  const getCards = () => [...grid.querySelectorAll(".dest-card")];
  const buttons = document.querySelectorAll(".filter-btn");
  const search = document.querySelector("#search");
  const empty = document.querySelector(".empty");
  const count = document.querySelector(".result-count");
  let category = "all";

  function visibleCards() {
    return getCards().filter((c) => c.style.display !== "none");
  }

  function apply() {
    const term = (search?.value || "").trim().toLowerCase();
    const cards = getCards();
    cards.forEach((card) => {
      card.tabIndex = 0;
      const matchCat = category === "all" || card.dataset.category.split(" ").includes(category);
      const matchText = !term || card.textContent.toLowerCase().includes(term);
      card.style.display = matchCat && matchText ? "" : "none";
    });
    const shown = visibleCards().length;
    if (empty) empty.style.display = shown ? "none" : "block";
    if (count) count.textContent = t("js.count", { n: shown, total: cards.length });
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      category = btn.dataset.filter;
      apply();
    });
  });
  search?.addEventListener("input", apply);
  document.addEventListener("languagechange", apply);
  apply();

  // ----- Modal with full details -----
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="modal__dialog">
      <button class="modal__close" aria-label="Close">✕</button>
      <div class="modal__img"><img alt=""><span class="pill pill--sun"></span><span class="modal__credit"></span></div>
      <div class="modal__body">
        <h2></h2>
        <p></p>
        <div class="card__meta"></div>
        <div class="modal__actions">
          <a class="btn btn--dark modal__maps" target="_blank" rel="noopener"></a>
          <a class="btn btn--outline modal__plan" href="contact.html"></a>
        </div>
      </div>
      <div class="modal__nav"><button class="modal__prev"></button><button class="modal__next"></button></div>
    </div>`;
  document.body.appendChild(modal);
  let current = null;
  let lastFocus = null;

  function fill(card) {
    current = card;
    const img = card.querySelector("img");
    modal.querySelector(".modal__img img").src = img.getAttribute("src");
    modal.querySelector(".modal__img img").alt = img.alt;
    const pill = modal.querySelector(".modal__img .pill");
    pill.textContent = card.querySelector(".pill")?.textContent || "";
    pill.style.display = pill.textContent ? "" : "none";
    modal.querySelector(".modal__credit").innerHTML =
      creditHtml(card.dataset.photo) || escapeHtml(card.dataset.photoCredit ? `${t("js.photo")}: ${card.dataset.photoCredit}` : "");
    modal.querySelector("h2").textContent = card.querySelector("h3").textContent;
    modal.querySelector(".modal__body p").textContent = card.querySelector("p").textContent;
    modal.querySelector(".modal__body .card__meta").innerHTML = card.querySelector(".card__meta").innerHTML;
    const maps = modal.querySelector(".modal__maps");
    maps.href = `https://www.google.com/maps/search/?api=1&query=${card.dataset.lat},${card.dataset.lng}`;
    maps.textContent = `📍 ${t("js.maps")}`;
    modal.querySelector(".modal__plan").textContent = t("js.plan");
    modal.querySelector(".modal__prev").textContent = t("js.prev");
    modal.querySelector(".modal__next").textContent = t("js.next");
    modal.querySelector(".modal__close").setAttribute("aria-label", t("js.close"));
  }

  function open(card) {
    lastFocus = document.activeElement;
    fill(card);
    modal.classList.add("open");
    document.body.classList.add("modal-open");
    modal.querySelector(".modal__dialog").scrollTop = 0;
    modal.querySelector(".modal__close").focus();
  }
  function close() {
    modal.classList.remove("open");
    document.body.classList.remove("modal-open");
    lastFocus?.focus();
  }
  function step(dir) {
    const list = visibleCards().length ? visibleCards() : getCards();
    const i = list.indexOf(current);
    fill(list[(i + dir + list.length) % list.length]);
    modal.querySelector(".modal__dialog").scrollTop = 0;
  }

  openPlace = (id) => {
    const card = getCards().find((c) => c.dataset.id === id);
    if (card) open(card);
  };

  // Delegated, so it keeps working after cards are re-rendered on language change
  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".dest-card");
    if (card) open(card);
  });
  grid.addEventListener("keydown", (e) => {
    const card = e.target.closest(".dest-card");
    if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(card); }
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  modal.querySelector(".modal__close").addEventListener("click", close);
  modal.querySelector(".modal__prev").addEventListener("click", () => step(-1));
  modal.querySelector(".modal__next").addEventListener("click", () => step(1));
  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("open")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
  document.addEventListener("languagechange", () => {
    if (!modal.classList.contains("open")) return;
    fill(getCards().find((c) => c.dataset.id === current.dataset.id) || current);
  });

  // Links like destinations.html?place=songkul open that place directly;
  // links like destinations.html#lakes pre-select a filter
  const place = new URLSearchParams(location.search).get("place");
  if (place) openPlace(place);
  const hash = location.hash.slice(1);
  const preset = hash && document.querySelector(`.filter-btn[data-filter="${hash}"]`);
  if (preset) preset.click();
}

/* ---------- Interactive map (Leaflet + OpenStreetMap/CARTO tiles) ---------- */
function initMap() {
  const el = document.querySelector("#map");
  if (!el) return;
  if (!window.L) {
    el.innerHTML = `<div class="map-fallback">${t("js.mapError")}</div>`;
    return;
  }

  const map = L.map(el, { scrollWheelZoom: false }).setView([41.4, 75.0], 6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 18,
  }).addTo(map);

  const markers = [];
  document.querySelectorAll(".dest-card[data-lat]").forEach((card) => {
    const icon = L.divIcon({
      className: "",
      html: `<div class="map-pin"><span>${escapeHtml(card.dataset.emoji || "📍")}</span></div>`,
      iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -30],
    });
    const marker = L.marker([card.dataset.lat, card.dataset.lng], { icon }).addTo(map);
    // Popup content is built on open so it always uses the current language
    marker.bindPopup(() => {
      // Look the card up again: it is re-rendered when the language changes
      const current = document.querySelector(`.dest-card[data-id="${CSS.escape(card.dataset.id)}"]`) || card;
      const box = document.createElement("div");
      box.className = "map-popup";
      box.innerHTML = `<img src="${escapeHtml(current.querySelector("img").getAttribute("src"))}" alt="">
        <div><strong>${escapeHtml(current.querySelector("h3").textContent)}</strong><button>${escapeHtml(t("js.details"))} →</button></div>`;
      box.querySelector("button").addEventListener("click", () => {
        map.closePopup();
        openPlace?.(card.dataset.id);
      });
      return box;
    });
    markers.push(marker);
  });
  if (markers.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.08));
}

/* ---------- Currency converter (approximate, offline rates) ---------- */
// Approximate number of Kyrgyz som (KGS) per 1 unit of currency.
// Rates change daily — check nbkr.kg for the official rate.
const RATES = { USD: 87.5, EUR: 95, GBP: 112, RUB: 1.08, KZT: 0.17, CNY: 12.2 };

function initConverter() {
  const amount = document.querySelector("#conv-amount");
  const currency = document.querySelector("#conv-currency");
  const result = document.querySelector("#conv-result");
  if (!amount || !currency || !result) return;

  function update() {
    const value = parseFloat(amount.value) || 0;
    const som = value * RATES[currency.value];
    result.textContent = `≈ ${som.toLocaleString(currentLang, { maximumFractionDigits: 0 })} ${t("js.som")}`;
  }
  amount.addEventListener("input", update);
  currency.addEventListener("change", update);
  document.addEventListener("languagechange", update);
  update();
}

/* ---------- Trip request form validation ---------- */
function initTripForm() {
  const form = document.querySelector("#trip-form");
  if (!form) return;

  const today = new Date().toISOString().split("T")[0];
  form.querySelector("#arrival")?.setAttribute("min", today);

  const rules = {
    name: (v) => v.trim().length >= 2,
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    country: (v) => v !== "",
    arrival: (v) => v !== "" && v >= today,
    days: (v) => Number(v) >= 1 && Number(v) <= 60,
    travelers: (v) => Number(v) >= 1 && Number(v) <= 30,
  };

  function check(name) {
    const input = form.elements[name];
    const ok = rules[name](input.value);
    input.closest(".field").classList.toggle("invalid", !ok);
    return ok;
  }

  Object.keys(rules).forEach((name) => {
    form.elements[name].addEventListener("blur", () => check(name));
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const allOk = Object.keys(rules).map(check).every(Boolean);
    const success = document.querySelector(".success");
    if (!allOk) {
      success.style.display = "none";
      form.querySelector(".invalid input, .invalid select")?.focus();
      return;
    }
    const name = form.elements.name.value.trim().split(" ")[0];
    success.textContent = t("js.success", { name });
    success.style.display = "block";
    form.reset();
  });
}

function setYear() {
  document.querySelectorAll(".year").forEach((el) => (el.textContent = new Date().getFullYear()));
}
