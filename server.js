/* ==========================================================================
   Travel Horizon — web server, REST API and admin backend
   Run with:  npm start   →   http://localhost:3000   (admin: /admin.html)

   Database: a local SQLite file (data/travel.db) by default, or an online
   Turso database when TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set.
   Uploaded photos and login sessions are stored in the database too, so
   nothing is lost on hosts that wipe their disk on restart (e.g. Render free).
   ========================================================================== */

const express = require("express");
const { createClient } = require("@libsql/client");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const SEED_FILE = path.join(ROOT, "data", "seed-places.json");
const LANGS = ["en", "ru", "es", "it", "ky", "fr"];
const CATEGORIES = ["lakes", "mountains", "history", "cities"];
const SESSION_HOURS = 8;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/* ---------- Database ---------- */
const remote = !!process.env.TURSO_DATABASE_URL;
if (!remote) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = createClient(remote
  ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: `file:${path.join(DATA_DIR, "travel.db")}` });

const SCHEMA = `
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
  CREATE TABLE IF NOT EXISTS uploads (
    name TEXT PRIMARY KEY,           -- served at /images/uploads/<name>
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`;

const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
const all = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const run = (sql, args = []) => db.execute({ sql, args });

async function savePlace(p, isNew) {
  const fields = [p.category.join(" "), p.lat, p.lng, p.image, p.photo || null, p.credit || null, p.emoji || null, p.sort, p.id];
  const statements = [
    isNew
      ? { sql: "INSERT INTO places (category, lat, lng, image, photo, credit, emoji, sort, id) VALUES (?,?,?,?,?,?,?,?,?)", args: fields }
      : { sql: "UPDATE places SET category=?, lat=?, lng=?, image=?, photo=?, credit=?, emoji=?, sort=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", args: fields },
    { sql: "DELETE FROM place_texts WHERE place_id = ?", args: [p.id] },
    ...Object.entries(p.texts).map(([lang, tx]) => ({
      sql: "INSERT INTO place_texts (place_id, lang, badge, title, description, tags) VALUES (?,?,?,?,?,?)",
      args: [p.id, lang, tx.badge, tx.title, tx.description, JSON.stringify(tx.tags)],
    })),
  ];
  await db.batch(statements, "write"); // runs as one transaction
}

async function loadPlaces(id) {
  // Two queries in total (not one per place), which matters for an online database
  const rows = id
    ? await all("SELECT * FROM places WHERE id = ?", [id])
    : await all("SELECT * FROM places ORDER BY sort, id");
  const texts = id
    ? await all("SELECT * FROM place_texts WHERE place_id = ?", [id])
    : await all("SELECT * FROM place_texts");
  const byPlace = {};
  for (const t of texts) {
    (byPlace[t.place_id] ||= {})[t.lang] = {
      badge: t.badge || "", title: t.title || "", description: t.description || "", tags: JSON.parse(t.tags || "[]"),
    };
  }
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
    texts: byPlace[r.id] || {},
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

function sessionToken(req) {
  return ((req.headers.cookie || "").match(/(?:^|;\s*)th_session=([a-f0-9]+)/) || [])[1];
}

// Sessions live in the database, so logins survive server restarts
async function getSession(req) {
  const token = sessionToken(req);
  if (!token) return null;
  const session = await one("SELECT * FROM sessions WHERE token = ?", [token]);
  if (!session) return null;
  if (session.expires < Date.now()) {
    await run("DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }
  return { token, userId: session.user_id, username: session.username };
}

async function requireAuth(req, res, next) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Please log in." });
  req.user = session;
  next();
}

const cookie = (req, value, maxAge) =>
  `th_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${req.secure ? "; Secure" : ""}`;

/* ---------- Validation ---------- */
const clean = (v, max) => String(v ?? "").trim().slice(0, max);

// Uploaded photos are stored in the database, built-in photos in the images folder
async function imageExists(p) {
  if (p.startsWith("images/uploads/")) {
    return !!(await one("SELECT 1 AS ok FROM uploads WHERE name = ?", [p.slice("images/uploads/".length)]));
  }
  return fs.existsSync(path.join(ROOT, p));
}

async function validatePlace(body) {
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
  if (!/^images\/[\w./-]+\.(jpe?g|png|webp)$/i.test(p.image) || p.image.includes("..") || !(await imageExists(p.image))) {
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
app.set("trust proxy", 1); // hosts like Render put the site behind an HTTPS proxy
app.use(express.json({ limit: "8mb" }));

// Uploaded photos (from the database)
app.get("/images/uploads/:name", async (req, res) => {
  const file = await one("SELECT mime, data FROM uploads WHERE name = ?", [req.params.name]);
  if (!file) return res.status(404).end();
  res.type(file.mime).set("Cache-Control", "public, max-age=31536000, immutable").send(Buffer.from(file.data));
});

// Public files only: never serve server.js, package.json or the database
app.use("/css", express.static(path.join(ROOT, "css")));
app.use("/js", express.static(path.join(ROOT, "js")));
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

app.post("/api/login", async (req, res) => {
  const ip = req.ip;
  const fail = failedLogins.get(ip);
  if (fail && fail.count >= 5 && fail.until > Date.now()) {
    return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  }
  const username = clean(req.body.username, 40);
  const user = await one("SELECT * FROM users WHERE username = ?", [username]);
  if (!user || !checkPassword(String(req.body.password || ""), user.password_hash)) {
    const count = (fail && fail.until > Date.now() ? fail.count : 0) + 1;
    failedLogins.set(ip, { count, until: Date.now() + 5 * 60 * 1000 });
    return res.status(401).json({ error: "Wrong username or password." });
  }
  failedLogins.delete(ip);
  const token = crypto.randomBytes(32).toString("hex");
  await run("DELETE FROM sessions WHERE expires < ?", [Date.now()]);
  await run("INSERT INTO sessions (token, user_id, username, expires) VALUES (?, ?, ?, ?)",
    [token, user.id, user.username, Date.now() + SESSION_HOURS * 3600 * 1000]);
  res.setHeader("Set-Cookie", cookie(req, token, SESSION_HOURS * 3600));
  res.json({ username: user.username });
});

app.post("/api/logout", async (req, res) => {
  const token = sessionToken(req);
  if (token) await run("DELETE FROM sessions WHERE token = ?", [token]);
  res.setHeader("Set-Cookie", cookie(req, "", 0));
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => res.json({ username: req.user.username, id: req.user.userId }));

/* Places — reading is public, changing needs login */
app.get("/api/places", async (req, res) => res.json(await loadPlaces()));

app.get("/api/places/:id", async (req, res) => {
  const [place] = await loadPlaces(req.params.id);
  place ? res.json(place) : res.status(404).json({ error: "Place not found." });
});

app.post("/api/places", requireAuth, async (req, res) => {
  const { place, errors } = await validatePlace(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  if ((await loadPlaces(place.id)).length) return res.status(409).json({ error: `A place with ID "${place.id}" already exists.` });
  await savePlace(place, true);
  res.status(201).json((await loadPlaces(place.id))[0]);
});

app.put("/api/places/:id", requireAuth, async (req, res) => {
  if (!(await loadPlaces(req.params.id)).length) return res.status(404).json({ error: "Place not found." });
  const { place, errors } = await validatePlace({ ...req.body, id: req.params.id });
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  await savePlace(place, false);
  res.json((await loadPlaces(place.id))[0]);
});

app.delete("/api/places/:id", requireAuth, async (req, res) => {
  const [, result] = await db.batch([
    { sql: "DELETE FROM place_texts WHERE place_id = ?", args: [req.params.id] },
    { sql: "DELETE FROM places WHERE id = ?", args: [req.params.id] },
  ], "write");
  result.rowsAffected ? res.json({ ok: true }) : res.status(404).json({ error: "Place not found." });
});

/* Photos */
app.get("/api/images", requireAuth, async (req, res) => {
  const uploaded = (await all("SELECT name FROM uploads ORDER BY created_at DESC")).map((r) => `images/uploads/${r.name}`);
  const builtIn = fs.readdirSync(path.join(ROOT, "images"))
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => `images/${f}`);
  res.json([...uploaded, ...builtIn]);
});

app.post("/api/upload", requireAuth, async (req, res) => {
  const match = String(req.body.data || "").match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "Only JPG, PNG or WebP images can be uploaded." });
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_UPLOAD_BYTES) return res.status(400).json({ error: "The image is larger than 5 MB." });
  const base = clean(req.body.name, 60).toLowerCase().replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "photo";
  const name = `${base}-${crypto.randomBytes(3).toString("hex")}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
  await run("INSERT INTO uploads (name, mime, data) VALUES (?, ?, ?)", [name, `image/${match[1]}`, buffer]);
  res.status(201).json({ path: `images/uploads/${name}` });
});

/* Admin accounts */
app.get("/api/users", requireAuth, async (req, res) => {
  res.json(await all("SELECT id, username, created_at AS createdAt FROM users ORDER BY id"));
});

app.post("/api/users", requireAuth, async (req, res) => {
  const username = clean(req.body.username, 40);
  const password = String(req.body.password || "");
  if (!/^[\w.-]{3,40}$/.test(username)) return res.status(400).json({ error: "Username: 3–40 letters, numbers, dots, dashes or underscores." });
  if (password.length < 8) return res.status(400).json({ error: "The password must be at least 8 characters." });
  if (await one("SELECT 1 AS taken FROM users WHERE username = ?", [username])) return res.status(409).json({ error: "This username is taken." });
  await run("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hashPassword(password)]);
  res.status(201).json({ ok: true });
});

app.delete("/api/users/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.userId) return res.status(400).json({ error: "You cannot delete your own account." });
  const result = await run("DELETE FROM users WHERE id = ?", [id]);
  if (!result.rowsAffected) return res.status(404).json({ error: "User not found." });
  await run("DELETE FROM sessions WHERE user_id = ?", [id]);
  res.json({ ok: true });
});

app.put("/api/users/me/password", requireAuth, async (req, res) => {
  const user = await one("SELECT * FROM users WHERE id = ?", [req.user.userId]);
  if (!checkPassword(String(req.body.current || ""), user.password_hash)) return res.status(400).json({ error: "The current password is wrong." });
  const next = String(req.body.next || "");
  if (next.length < 8) return res.status(400).json({ error: "The new password must be at least 8 characters." });
  await run("UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(next), user.id]);
  res.json({ ok: true });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.type === "entity.too.large" ? "The upload is too large." : "Server error." });
});

/* ---------- Start: create tables, seed places, first admin ---------- */
async function start() {
  if (process.env.RENDER && !remote) {
    console.warn("WARNING: TURSO_DATABASE_URL is not set — on Render, admin changes will be lost on every restart.");
  }
  await db.executeMultiple(SCHEMA);

  if ((await one("SELECT COUNT(*) AS n FROM places")).n === 0) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
    for (const p of seed) await savePlace(p, true);
    console.log(`Database created with ${seed.length} places.`);
  }

  if ((await one("SELECT COUNT(*) AS n FROM users")).n === 0) {
    const password = process.env.ADMIN_PASSWORD || "admin123";
    await run("INSERT INTO users (username, password_hash) VALUES (?, ?)", ["admin", hashPassword(password)]);
    if (process.env.ADMIN_PASSWORD) {
      console.log("Created admin account → username: admin, password: (the ADMIN_PASSWORD variable)");
    } else {
      console.log("Created admin account → username: admin, password: admin123");
      console.log("Log in at /admin.html and change this password under 'Users'.");
    }
  }

  // Forgotten password: start the server once with ADMIN_RESET_PASSWORD set (on Render: Environment tab),
  // log in, then remove the variable. Creates the account if it doesn't exist.
  if (process.env.ADMIN_RESET_PASSWORD) {
    const username = process.env.ADMIN_RESET_USERNAME || "admin";
    const password = process.env.ADMIN_RESET_PASSWORD;
    if (password.length < 8) {
      console.warn("ADMIN_RESET_PASSWORD must be at least 8 characters — password NOT reset.");
    } else {
      await run(`INSERT INTO users (username, password_hash) VALUES (?, ?)
        ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`, [username, hashPassword(password)]);
      console.log(`Password for "${username}" was reset from ADMIN_RESET_PASSWORD. Remove that variable now.`);
    }
  }

  app.listen(PORT, (err) => {
    if (err) {
      console.error(err.code === "EADDRINUSE"
        ? `Port ${PORT} is already in use — the site is probably already running in another terminal.`
        : `Could not start the server: ${err.message}`);
      process.exit(1);
    }
    console.log(`Database: ${remote ? "Turso (online)" : path.join(DATA_DIR, "travel.db")}`);
    console.log(`Travel Horizon is running → http://localhost:${PORT}`);
    console.log(`Admin panel              → http://localhost:${PORT}/admin.html`);
  });
}

start().catch((err) => {
  console.error("Could not start the server:", err.message);
  process.exit(1);
});
