/* Reset (or create) an admin account's password from the command line.
   Usage:  npm run reset-password -- <username> <new-password>
   Example: npm run reset-password -- admin MyNewPass2026
   Places and other data are not touched. */

const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.log("Usage: npm run reset-password -- <username> <new-password>");
  process.exit(1);
}
if (password.length < 8) {
  console.log("The password must be at least 8 characters.");
  process.exit(1);
}

// Same location rules as server.js
const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "..", "data");
const dbFile = path.join(dataDir, "travel.db");
if (!fs.existsSync(dbFile)) {
  console.log(`No database at ${dbFile}. Start the site once with "npm start" first.`);
  process.exit(1);
}

// Same hashing as hashPassword() in server.js
const salt = crypto.randomBytes(16).toString("hex");
const hash = `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;

const db = new DatabaseSync(dbFile);
db.prepare(`INSERT INTO users (username, password_hash) VALUES (?, ?)
  ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`).run(username, hash);
console.log(`Password for "${username}" was set. Restart the server if it is running, then log in.`);
