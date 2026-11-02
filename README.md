# Travel Horizon

A travel guide to Kyrgyzstan for foreign tourists, in 6 languages, with booking requests sent to
Telegram and an admin panel. Data and admin login are handled by [Supabase](https://supabase.com).

## Setup

Requires [Node.js](https://nodejs.org) 24.

### 1. Supabase

1. Create a project.
2. In the **SQL Editor**, run `supabase/schema.sql`, then `supabase/seed.sql` (the 17 starting places).
3. In **Authentication → Users**, create your admin user.
4. Make that user an admin (a login alone gives no access), replacing the email:

   ```sql
   insert into public.admins (user_id, role)
   select id, 'admin' from auth.users where email = 'you@example.com'
   on conflict (user_id) do update set role = 'admin';
   ```

### 2. Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Send your bot any message, or add it to a group that should receive requests.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` from the response.

### 3. Run

Copy `.env.example` to `.env.local` (or `.env`), fill it in, then:

```bash
npm install     # first time only
npm start
```

- Website: <http://localhost:3000>
- Admin panel: <http://localhost:3000/admin.html>

## Admin panel

- **Places:** add, edit or delete destinations, with texts in 6 languages, a photo, categories and a map location.
- **Bookings:** read requests, set their status (new, contacted, closed), or delete them.
- **Account:** change your password.

To add or remove an admin, use Supabase: **Authentication → Users** and the `admins` table.

## How it works

| Part | Where |
|---|---|
| Website, places API, booking requests, Telegram | `server.js` (Express) |
| Tables, security rules, photo storage | `supabase/schema.sql` |
| Starting places | `supabase/seed.sql` |
| Admin panel (talks to Supabase directly) | `admin.html`, `js/admin.js`, `css/admin.css` |
| Public site | `*.html`, `css/style.css`, `js/main.js` |
| Translations of the fixed site text | `js/i18n/*.js` |

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/places` | List places |
| POST | `/api/bookings` | Send a booking request (validated, saved, then sent to Telegram) |
| GET | `/api/config` | Public Supabase settings for the admin panel |
| GET | `/api/images` | Built-in photos offered in the admin panel |

**Security:** Row Level Security lets anyone read places, and only accounts in `admins` change places or
photos and read bookings. Visitors can't write to the database directly: bookings go through the server,
which holds `SUPABASE_SERVICE_KEY` and `TELEGRAM_BOT_TOKEN`. Keep both out of the browser and out of Git.

A booking is saved before the Telegram message is sent, so it isn't lost if Telegram is down. The admin
panel marks such requests as "not sent to Telegram".

## Putting the site online (Render)

1. Push the project to GitHub.
2. On [render.com](https://render.com): **New → Blueprint** → choose the repository.
3. Enter the 5 values from your `.env` when Render asks for them, then deploy.

Every push to GitHub updates the site. On the free plan the site sleeps after 15 minutes without
visitors and takes up to a minute to wake up. All data is in Supabase, so restarts lose nothing.

Opening the HTML files directly (without `npm start`) still shows the site, but with the places built
into `destinations.html`, and bookings and the admin panel don't work.
