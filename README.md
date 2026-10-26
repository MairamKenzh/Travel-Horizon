# Travel Horizon

A travel guide to Kyrgyzstan for foreign tourists, in 6 languages, with an admin panel for managing places.

## Running the site

Requires [Node.js](https://nodejs.org) 22.13 or newer.

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
| Server, REST API, login, database | `server.js` (Express + built-in `node:sqlite`) |
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

Opening the HTML files directly (without `npm start`) still works, but then the Destinations page
shows the places built into `destinations.html` and the admin panel is unavailable.
