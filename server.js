/* ==========================================================================
   Travel Horizon — web server, REST API and admin backend
   Run with:  npm start   →   http://localhost:3000   (admin: /admin.html)
   ========================================================================== */

const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// Where the database and uploaded photos are saved. On Railway the attached volume's path is
// provided automatically (RAILWAY_VOLUME_MOUNT_PATH); DATA_DIR overrides it on any host.
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");          // served at /images/uploads/
const SEED_FILE = path.join(ROOT, "data", "seed-places.json");
const LANGS = ["en", "ru", "es", "it", "ky", "fr"];
const CATEGORIES = ["lakes", "mountains", "history", "cities"];
const SESSION_HOURS = 8;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- Database ---------- */
const db = new DatabaseSync(path.join(DATA_DIR, "travel.db"));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,          -- space-separated, e.g. "lakes mountains"
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    image TEXT NOT NULL,             -- path such as images/song-kul.jpg
    photo TEXT,                      -- key in js/credits.js (built-in photos)
    credit TEXT,                     -- free-text photo credit (uploaded photos)
    emoji TEXT,
    sort INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS place_texts (
    place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    lang TEXT NOT NULL,
    badge TEXT,
    title TEXT,
    description TEXT,
    tags TEXT,                       -- JSON array of strings
    PRIMARY KEY (place_id, lang)
  );
`);

function transaction(fn) {
  db.exec("BEGIN");
  try { const result = fn(); db.exec("COMMIT"); return result; }
  catch (err) { db.exec("ROLLBACK"); throw err; }
}

function savePlace(p, isNew) {
  transaction(() => {
    const fields = [p.category.join(" "), p.lat, p.lng, p.image, p.photo || null, p.credit || null, p.emoji || null, p.sort];
    if (isNew) {
      db.prepare(`INSERT INTO places (category, lat, lng, image, photo, credit, emoji, sort, id) VALUES (?,?,?,?,?,?,?,?,?)`).run(...fields, p.id);
    } else {
      db.prepare(`UPDATE places SET category=?, lat=?, lng=?, image=?, photo=?, credit=?, emoji=?, sort=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...fields, p.id);
      db.prepare("DELETE FROM place_texts WHERE place_id = ?").run(p.id);
    }
    const insertText = db.prepare(`INSERT INTO place_texts (place_id, lang, badge, title, description, tags) VALUES (?,?,?,?,?,?)`);
    for (const [lang, tx] of Object.entries(p.texts)) {
      insertText.run(p.id, lang, tx.badge, tx.title, tx.description, JSON.stringify(tx.tags));
    }
  });
}

function loadPlaces(id) {
  const rows = id
    ? db.prepare("SELECT * FROM places WHERE id = ?").all(id)
    : db.prepare("SELECT * FROM places ORDER BY sort, id").all();
  const texts = db.prepare("SELECT * FROM place_texts WHERE place_id = ?");
  return rows.map((r) => ({
    id: r.id,
    category: r.category.split(" "),
    lat: r.lat,
    lng: r.lng,
    image: r.image,
    photo: r.photo || "",
    credit: r.credit || "",
    emoji: r.emoji || "",
    sort: r.sort,
    updatedAt: r.updated_at,
    texts: Object.fromEntries(texts.all(r.id).map((t) => [t.lang, {
      badge: t.badge || "", title: t.title || "", description: t.description || "", tags: JSON.parse(t.tags || "[]"),
    }])),
  }));
}

/* ---------- Passwords and sessions ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

const sessions = new Map(); // token -> { userId, username, expires }

function getSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map((c) => {
    const i = c.indexOf("=");
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));
  const session = sessions.get(cookies.th_session);
  if (!session) return null;
  if (session.expires < Date.now()) { sessions.delete(cookies.th_session); return null; }
  return session;
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Please log in." });
  req.user = session;
  next();
}

/* ---------- First run: seed places and create the first admin ---------- */
if (db.prepare("SELECT COUNT(*) AS n FROM places").get().n === 0) {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  seed.forEach((p) => savePlace(p, true));
  console.log(`Database created with ${seed.length} places.`);
}
if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0) {
  const password = process.env.ADMIN_PASSWORD || "admin123";
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run("admin", hashPassword(password));
  if (process.env.ADMIN_PASSWORD) {
    console.log("Created admin account → username: admin, password: (the ADMIN_PASSWORD variable)");
  } else {
    console.log("Created admin account → username: admin, password: admin123");
    console.log("Log in at /admin.html and change this password under 'Users'.");
  }
}

// Forgotten password: start the server once with ADMIN_RESET_PASSWORD set (on Railway: Variables tab),
// log in, then remove the variable. Creates the account if it doesn't exist.
if (process.env.ADMIN_RESET_PASSWORD) {
  const username = process.env.ADMIN_RESET_USERNAME || "admin";
  const password = process.env.ADMIN_RESET_PASSWORD;
  if (password.length < 8) {
    console.warn("ADMIN_RESET_PASSWORD must be at least 8 characters — password NOT reset.");
  } else {
    db.prepare(`INSERT INTO users (username, password_hash) VALUES (?, ?)
      ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`).run(username, hashPassword(password));
    console.log(`Password for "${username}" was reset from ADMIN_RESET_PASSWORD. Remove that variable now.`);
  }
}

/* ---------- Validation ---------- */
const clean = (v, max) => String(v ?? "").trim().slice(0, max);

// Uploaded photos live in UPLOAD_DIR, built-in photos in the project's images folder
const imageFile = (p) => p.startsWith("images/uploads/")
  ? path.join(UPLOAD_DIR, p.slice("images/uploads/".length))
  : path.join(ROOT, p);

function validatePlace(body) {
  const errors = [];
  const p = {
    id: clean(body.id, 40).toLowerCase(),
    category: Array.isArray(body.category) ? body.category.filter((c) => CATEGORIES.includes(c)) : [],
    lat: Number(body.lat),
    lng: Number(body.lng),
    image: clean(body.image, 200),
    photo: clean(body.photo, 60),
    credit: clean(body.credit, 200),
    emoji: clean(body.emoji, 8),
    sort: Number.isFinite(Number(body.sort)) ? Math.round(Number(body.sort)) : 0,
    texts: {},
  };
  if (!/^[a-z0-9-]{2,40}$/.test(p.id)) errors.push("ID must be 2–40 characters: lowercase letters, numbers and dashes.");
  if (!p.category.length) errors.push("Choose at least one category.");
  if (!(p.lat >= -90 && p.lat <= 90) || !(p.lng >= -180 && p.lng <= 180)) errors.push("Latitude/longitude are not valid.");
  if (!/^images\/[\w./-]+\.(jpe?g|png|webp)$/i.test(p.image) || p.image.includes("..") || !fs.existsSync(imageFile(p.image))) {
    errors.push("Choose or upload a photo.");
  }
  for (const lang of LANGS) {
    const tx = body.texts?.[lang];
    if (!tx) continue;
    const entry = {
      badge: clean(tx.badge, 40),
      title: clean(tx.title, 80),
      description: clean(tx.description, 600),
      tags: (Array.isArray(tx.tags) ? tx.tags : []).map((t) => clean(t, 40)).filter(Boolean).slice(0, 6),
    };
    if (entry.title || entry.description || entry.badge || entry.tags.length) p.texts[lang] = entry;
  }
  if (!p.texts.en?.title) errors.push("The English title is required.");
  if (!p.texts.en?.description) errors.push("The English description is required.");
  return { place: p, errors };
}

/* ---------- App ---------- */
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // hosts like Railway put the site behind an HTTPS proxy
app.use(express.json({ limit: "8mb" }));

// Public files only: never serve server.js, package.json or the database
app.use("/css", express.static(path.join(ROOT, "css")));
app.use("/js", express.static(path.join(ROOT, "js")));
app.use("/images/uploads", express.static(UPLOAD_DIR));
app.use("/images", express.static(path.join(ROOT, "images")));
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path === "/") return res.sendFile(path.join(ROOT, "index.html"));
  const page = req.path.match(/^\/([a-z-]+\.html)$/);
  if (page && fs.existsSync(path.join(ROOT, page[1]))) return res.sendFile(path.join(ROOT, page[1]));
  next();
});

/* Auth */
const failedLogins = new Map(); // ip -> { count, until }

app.post("/api/login", (req, res) => {
  const ip = req.ip;
  const fail = failedLogins.get(ip);
  if (fail && fail.count >= 5 && fail.until > Date.now()) {
    return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  }
  const username = clean(req.body.username, 40);
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !checkPassword(String(req.body.password || ""), user.password_hash)) {
    const count = (fail && fail.until > Date.now() ? fail.count : 0) + 1;
    failedLogins.set(ip, { count, until: Date.now() + 5 * 60 * 1000 });
    return res.status(401).json({ error: "Wrong username or password." });
  }
  failedLogins.delete(ip);
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId: user.id, username: user.username, expires: Date.now() + SESSION_HOURS * 3600 * 1000 });
  res.setHeader("Set-Cookie", `th_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${req.secure ? "; Secure" : ""}`);
  res.json({ username: user.username });
});

app.post("/api/logout", (req, res) => {
  const cookie = (req.headers.cookie || "").match(/th_session=([a-f0-9]+)/);
  if (cookie) sessions.delete(cookie[1]);
  res.setHeader("Set-Cookie", "th_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => res.json({ username: req.user.username, id: req.user.userId }));

/* Places — reading is public, changing needs login */
app.get("/api/places", (req, res) => res.json(loadPlaces()));

app.get("/api/places/:id", (req, res) => {
  const [place] = loadPlaces(req.params.id);
  place ? res.json(place) : res.status(404).json({ error: "Place not found." });
});

app.post("/api/places", requireAuth, (req, res) => {
  const { place, errors } = validatePlace(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  if (loadPlaces(place.id).length) return res.status(409).json({ error: `A place with ID "${place.id}" already exists.` });
  savePlace(place, true);
  res.status(201).json(loadPlaces(place.id)[0]);
});

app.put("/api/places/:id", requireAuth, (req, res) => {
  if (!loadPlaces(req.params.id).length) return res.status(404).json({ error: "Place not found." });
  const { place, errors } = validatePlace({ ...req.body, id: req.params.id });
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  savePlace(place, false);
  res.json(loadPlaces(place.id)[0]);
});

app.delete("/api/places/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM places WHERE id = ?").run(req.params.id);
  result.changes ? res.json({ ok: true }) : res.status(404).json({ error: "Place not found." });
});

/* Photos */
app.get("/api/images", requireAuth, (req, res) => {
  const list = (dir, prefix) => fs.readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => `${prefix}${f}`);
  res.json([...list(UPLOAD_DIR, "images/uploads/"), ...list(path.join(ROOT, "images"), "images/")]);
});

app.post("/api/upload", requireAuth, (req, res) => {
  const match = String(req.body.data || "").match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "Only JPG, PNG or WebP images can be uploaded." });
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_UPLOAD_BYTES) return res.status(400).json({ error: "The image is larger than 5 MB." });
  const base = clean(req.body.name, 60).toLowerCase().replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "photo";
  const file = `${base}-${crypto.randomBytes(3).toString("hex")}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buffer);
  res.status(201).json({ path: `images/uploads/${file}` });
});

/* Admin accounts */
app.get("/api/users", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT id, username, created_at AS createdAt FROM users ORDER BY id").all());
});

app.post("/api/users", requireAuth, (req, res) => {
  const username = clean(req.body.username, 40);
  const password = String(req.body.password || "");
  if (!/^[\w.-]{3,40}$/.test(username)) return res.status(400).json({ error: "Username: 3–40 letters, numbers, dots, dashes or underscores." });
  if (password.length < 8) return res.status(400).json({ error: "The password must be at least 8 characters." });
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) return res.status(409).json({ error: "This username is taken." });
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hashPassword(password));
  res.status(201).json({ ok: true });
});

app.delete("/api/users/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.userId) return res.status(400).json({ error: "You cannot delete your own account." });
  const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: "User not found." });
  for (const [token, s] of sessions) if (s.userId === id) sessions.delete(token);
  res.json({ ok: true });
});

app.put("/api/users/me/password", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userId);
  if (!checkPassword(String(req.body.current || ""), user.password_hash)) return res.status(400).json({ error: "The current password is wrong." });
  const next = String(req.body.next || "");
  if (next.length < 8) return res.status(400).json({ error: "The new password must be at least 8 characters." });
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), user.id);
  res.json({ ok: true });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.type === "entity.too.large" ? "The upload is too large." : "Server error." });
});

app.listen(PORT, () => {
  console.log(`Travel Horizon is running → http://localhost:${PORT}`);
  console.log(`Admin panel              → http://localhost:${PORT}/admin.html`);
});
