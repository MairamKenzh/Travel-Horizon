/* ==========================================================================
   Travel Horizon — web server
   Serves the website, reads places from Supabase and receives booking requests
   (saved to Supabase, then sent to Telegram). Secret keys stay on this server.
   The admin panel talks to Supabase directly and is protected by its RLS rules.
   Run with:  npm start   →   http://localhost:3000   (admin: /admin.html)
   ========================================================================== */

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const fs = require("node:fs");
const path = require("node:path");

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const NOT_CONFIGURED = { error: "The database is not configured on the server." };
const clean = (v, max) => String(v ?? "").trim().slice(0, max);

/* ---------- Booking requests ---------- */
function validateBooking(body) {
  const b = {
    name: clean(body.name, 100),
    email: clean(body.email, 150),
    phone: clean(body.phone, 40),
    country: clean(body.country, 80),
    destination: clean(body.destination, 120),
    arrival: clean(body.arrival, 10),
    days: Number(body.days),
    travelers: Number(body.travelers),
    interests: (Array.isArray(body.interests) ? body.interests : []).map((i) => clean(i, 60)).filter(Boolean).slice(0, 10),
    budget: clean(body.budget, 80),
    message: clean(body.message, 1500),
    language: clean(body.language, 5),
  };
  // A day of leeway: the visitor's "today" can be ahead of or behind the server's
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const valid = b.name.length >= 2
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)
    && (!b.phone || /^[+\d@\w][\d\w\s()@._-]{4,39}$/.test(b.phone))
    && b.country
    && /^\d{4}-\d{2}-\d{2}$/.test(b.arrival) && !Number.isNaN(Date.parse(b.arrival)) && b.arrival >= yesterday
    && Number.isInteger(b.days) && b.days >= 1 && b.days <= 60
    && Number.isInteger(b.travelers) && b.travelers >= 1 && b.travelers <= 30;
  return valid ? b : null;
}

const escapeTelegram = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function notifyTelegram(b) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  const rows = [
    ["👤 Name", b.name],
    ["✉️ Email", b.email],
    ["📞 Phone", b.phone],
    ["🌍 Country", b.country],
    ["📍 Destination", b.destination],
    ["🗓 Arrival", b.arrival],
    ["⏳ Days", b.days],
    ["👥 Travellers", b.travelers],
    ["🎯 Interests", b.interests.join(", ")],
    ["💰 Budget", b.budget],
    ["💬 Message", b.message],
  ].filter(([, value]) => value);
  const text = ["<b>🧳 New booking request</b>", ...rows.map(([label, value]) => `<b>${label}:</b> ${escapeTelegram(value)}`)].join("\n");
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("Telegram error:", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("Telegram error:", err.message);
    return false;
  }
}

/* ---------- App ---------- */
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // hosts like Render put the site behind an HTTPS proxy
app.use(express.json({ limit: "20kb" }));

// Public files only: never serve server.js, package.json or .env
app.use("/css", express.static(path.join(ROOT, "css")));
app.use("/js", express.static(path.join(ROOT, "js")));
app.use("/images", express.static(path.join(ROOT, "images")));
app.get("/vendor/supabase.js", (req, res) => {
  res.sendFile(path.join(ROOT, "node_modules/@supabase/supabase-js/dist/umd/supabase.js"));
});
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path === "/") return res.sendFile(path.join(ROOT, "index.html"));
  const page = req.path.match(/^\/([a-z-]+\.html)$/);
  if (page && fs.existsSync(path.join(ROOT, page[1]))) return res.sendFile(path.join(ROOT, page[1]));
  next();
});

// Public Supabase settings for the admin panel. The anon key is safe in a browser: RLS protects the data.
app.get("/api/config", (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(503).json(NOT_CONFIGURED);
  res.json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
});

app.get("/api/places", async (req, res) => {
  if (!supabase) return res.status(503).json(NOT_CONFIGURED);
  const { data, error } = await supabase.from("places").select("*").order("sort").order("id");
  if (error) throw error;
  res.json(data);
});

// Photos that ship with the site, offered in the admin panel's photo list
app.get("/api/images", (req, res) => {
  res.json(fs.readdirSync(path.join(ROOT, "images")).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => `images/${f}`));
});

const recentBookings = new Map(); // ip -> { count, until }

app.post("/api/bookings", async (req, res) => {
  if (!supabase) return res.status(503).json(NOT_CONFIGURED);
  if (req.body?.website) return res.status(201).json({ ok: true }); // hidden field only bots fill in

  const limit = recentBookings.get(req.ip);
  const count = limit && limit.until > Date.now() ? limit.count : 0;
  if (count >= 5) return res.status(429).json({ error: "Too many requests." });

  const booking = validateBooking(req.body || {});
  if (!booking) return res.status(400).json({ error: "Please check the form." });
  if (recentBookings.size > 5000) recentBookings.clear(); // keep memory bounded
  recentBookings.set(req.ip, { count: count + 1, until: count ? limit.until : Date.now() + 10 * 60 * 1000 });

  // Save first: a Telegram outage must not lose the request
  const { data, error } = await supabase.from("bookings").insert(booking).select("id").single();
  if (error) throw error;
  if (await notifyTelegram(booking)) {
    const { error: updateError } = await supabase.from("bookings").update({ telegram_sent: true }).eq("id", data.id);
    if (updateError) console.error("Could not mark booking as sent:", updateError.message);
  }
  res.status(201).json({ ok: true });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: "Bad request." });
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

app.listen(PORT, (err) => {
  if (err) {
    console.error(err.code === "EADDRINUSE"
      ? `Port ${PORT} is already in use — the site is probably already running in another terminal.`
      : `Could not start the server: ${err.message}`);
    process.exit(1);
  }
  if (!supabase || !SUPABASE_ANON_KEY) console.warn("Supabase is not configured: set the variables from .env.example.");
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) console.warn("Telegram is not configured: booking requests will only be saved.");
  console.log(`Travel Horizon is running → http://localhost:${PORT}`);
  console.log(`Admin panel              → http://localhost:${PORT}/admin.html`);
});
