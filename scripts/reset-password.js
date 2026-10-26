/* Reset (or create) an admin account's password from the command line.
   Usage:  npm run reset-password -- <username> <new-password>
   Example: npm run reset-password -- admin MyNewPass2026

   Works on the local database by default. To reset the password of the ONLINE
   site, set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first (see README).
   Places and other data are not touched. */

const { createClient } = require("@libsql/client");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

(async () => {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.log("Usage: npm run reset-password -- <username> <new-password>");
    process.exit(1);
  }
  if (password.length < 8) {
    console.log("The password must be at least 8 characters.");
    process.exit(1);
  }

  // Same database rules as server.js
  let db;
  if (process.env.TURSO_DATABASE_URL) {
    db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  } else {
    const dbFile = path.join(process.env.DATA_DIR || path.join(__dirname, "..", "data"), "travel.db");
    if (!fs.existsSync(dbFile)) {
      console.log(`No database at ${dbFile}. Start the site once with "npm start" first.`);
      process.exit(1);
    }
    db = createClient({ url: `file:${dbFile}` });
  }

  // Same hashing as hashPassword() in server.js
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;

  await db.execute({
    sql: `INSERT INTO users (username, password_hash) VALUES (?, ?)
          ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`,
    args: [username, hash],
  });
  console.log(`Password for "${username}" was set${process.env.TURSO_DATABASE_URL ? " on the online database" : ""}. You can log in now.`);
})().catch((err) => {
  console.error("Could not reset the password:", err.message);
  process.exit(1);
});
