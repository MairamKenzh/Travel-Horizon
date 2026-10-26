# Travel Horizon

A travel guide to Kyrgyzstan for foreign tourists, in 6 languages, with an admin panel for managing places.

## Running the site

Requires [Node.js](https://nodejs.org) 24.

```bash
npm install     # first time only
npm start
```

- Website: <http://localhost:3000>
- Admin panel: <http://localhost:3000/admin.html>

On the first start the database (`data/travel.db`) is created with 17 places, and an admin account is created:

| Username | Password |
|---|---|
| `admin` | `admin123` |

**Change this password right away** in the admin panel under **Users → Change my password**.
To choose a different first password, start the server with `ADMIN_PASSWORD=yourpassword npm start`
(PowerShell: `$env:ADMIN_PASSWORD="yourpassword"; npm start`) before the database exists.

## Using the admin panel

- **Places** — add, edit or delete destinations. Each place has:
  - texts in 6 languages (English is required; empty languages show the English text),
  - a photo (upload one or pick an existing one) and a photo credit,
  - categories, a map icon, an order number and a location picked on the map.
  Changes appear on the Destinations page and the map immediately.
- **Users** — give another person access by creating an account for them, remove accounts,
  and change your own password.

## How it works

| Part | File |
|---|---|
| Server, REST API, login, database | `server.js` (Express + SQLite via `@libsql/client`; local file or Turso) |
| Admin panel | `admin.html`, `js/admin.js`, `css/admin.css` |
| Public site | `*.html`, `css/style.css`, `js/main.js` |
| Translations of the fixed site text | `js/i18n/*.js` |
| Starting data for the database | `data/seed-places.json` |

API (writing requires login):

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/places` | List places (public) |
| POST / PUT / DELETE | `/api/places`, `/api/places/:id` | Add / edit / delete a place |
| POST | `/api/upload` | Upload a photo |
| POST | `/api/login`, `/api/logout` | Log in / out |
| GET / POST / DELETE | `/api/users`, `/api/users/:id` | Manage admin accounts |
| PUT | `/api/users/me/password` | Change own password |

To start over with the original 17 places, stop the server and delete `data/travel.db`.

## Passwords

| Situation | What to do |
|---|---|
| Change your password | Admin panel → **Users → Change my password** |
| Give someone access | Admin panel → **Users → Add a person** |
| Choose the first admin password on a new server | Set the variable `ADMIN_PASSWORD` before the first start |
| Forgot the password (online site) | Render → service → **Environment** → add `ADMIN_RESET_PASSWORD` = new password (8+ characters) → **Save, rebuild and deploy**. Log in, then **delete the variable**. |
| Forgot the password (on your computer) | `npm run reset-password -- admin NewPassword123` |

Resetting a password never deletes places or photos.

## Putting the site online (Render + Turso, free)

The website runs on **Render** (free web service). The data — places, admin accounts, logins and
uploaded photos — is stored in a free **Turso** online database, because Render's free plan erases
its disk on every restart.

1. Upload the project to GitHub (VS Code: **Source Control → Publish Branch**).
2. **Turso:** sign up at [turso.tech](https://turso.tech) with GitHub → create a database →
   copy its **URL** (`libsql://….turso.io`) and create a **token**.
3. **Render:** sign up at [render.com](https://render.com) with GitHub → **New → Blueprint** →
   choose the repository. Render reads `render.yaml` and asks for:
   - `TURSO_DATABASE_URL` — the Turso URL
   - `TURSO_AUTH_TOKEN` — the Turso token
   - `ADMIN_PASSWORD` — the admin password for the online site
4. Click **Deploy**. The site appears at `https://travel-horizon-xxxx.onrender.com`.

Every push to GitHub updates the website automatically. On the free plan the site sleeps after
15 minutes without visitors and takes up to a minute to wake up.

Without the Turso variables the server uses the local file `data/travel.db` (or `DATA_DIR`).

Opening the HTML files directly (without `npm start`) still works, but then the Destinations page
shows the places built into `destinations.html` and the admin panel is unavailable.
