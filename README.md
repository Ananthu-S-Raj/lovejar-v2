# LoveJar

A full-stack PWA for two people: a daily Love Jar with mood-based AI messages, real-time chat,
a Heart Catch mini-game, streaks with a growing garden, letters, a shared bucket list, calendar,
virtual pet, and weather — plus a full admin control panel.

```
Frontend   React + Vite + TypeScript, installable PWA
Backend    Cloudflare Workers + TypeScript (Hono)
Database   Cloudflare D1
Realtime   Durable Objects + WebSockets (chat)
AI         Gemini API (jar messages)
Weather    OpenWeatherMap-compatible API
```

## What's implemented

- **Auth**: 6-digit PIN login for the user, email/password for admin, PBKDF2-hashed secrets,
  admin-approved password reset requests, wrong-PIN detection with an admin notification
  pushed over the chat WebSocket, and a "Hello Abhi" fade-in on login.
- **Love Jar**: 4 moods, Gemini-generated message per mood (with a built-in fallback bank if the
  API key is missing or the call fails), once-per-day opening pinned to the IST calendar day,
  30-day non-repeat window, and a birthday theme + message every March 19th.
- **Streak**: consecutive-day tracking off jar openings, with a seed that appears at 30 days and
  grows through further milestones.
- **Chat**: real-time via a Durable Object WebSocket hub — presence, typing indicators, delete /
  delete-for-everyone, clear-history, and light UI sounds/vibration. Push notifications are
  intentionally *not* wired to background push, since the spec calls for in-app-only notifications.
- **Heart Catch game**: canvas mini-game, 30s round, increasing fall speed/spawn rate, max score 25,
  score-scaled romantic message.
- **Letters, Bucket List, Calendar, Virtual Pet, Weather**: full CRUD/interaction routes shared
  between user and admin views, with role-appropriate permissions (e.g. only admin composes letters).
- **Admin Settings**: disable/enable user login with a custom reason, generate new PIN/password
  hashes, review reset requests, manually adjust the streak, and set nicknames.

## What you'll need to finish yourself

This is a genuinely large app — the scaffold is complete and typechecks/builds cleanly, but a few
things are inherently things *you* configure, not code:

- A Cloudflare account with Workers + D1 + Durable Objects enabled (all on the free tier for this
  scale of app).
- A Gemini API key (jar still works without one, using fallback messages).
- A weather API key (OpenWeatherMap or similar).
- Real device testing for vibration/sound feel, since that's subjective polish.
- Tightening the CORS/CSRF allowlist for production. The Worker runs in two modes
  controlled by the `ENVIRONMENT` binding (see `lib/security.ts`): in **production**
  only `https://lovejar-v2.pages.dev` is accepted and session cookies use
  `SameSite=None` (cross-site Pages → Worker auth); in development the localhost
  origins in `wrangler.toml` (`ALLOWED_ORIGINS`) are used with `SameSite=Strict`.
  Before going live set `ENVIRONMENT=production` on the deployed Worker — see the
  "Deploying the backend" section.

## Project layout

```
backend/            Cloudflare Worker (Hono API + Durable Object)
  src/
    routes/          One file per feature area
    durable-objects/ ChatRoom.ts — the realtime chat hub
    lib/             auth, crypto, time, gemini helpers
    db/schema.sql    D1 schema
  wrangler.toml

frontend/            React + Vite PWA
  src/
    pages/            One page per nav tab (user + admin/)
    components/        Jar, NavBar, ProtectedRoute
    lib/               api client, auth context, sound/vibration helpers
    styles/global.css

scripts/hash-secret.mjs   Generates the PIN/password hash you paste into wrangler secrets
```

## Deploying the backend

1. `cd backend && npm install`
2. `npx wrangler login`
3. Create the D1 database and paste its ID into `wrangler.toml`:
   ```
   npx wrangler d1 create lovejar-db
   ```
4. Run the schema against it:
   ```
   npm run db:migrate:remote
   ```
   If the database was created before the Hug/Kiss chat feature, run the upgrade
   migration once as well (it adds the `kind` column; `schema.sql` already
   includes it for fresh databases):
   ```
   npm run db:migrate:upgrade
   ```
5. Generate your PIN and admin password hashes:
   ```
   node ../scripts/hash-secret.mjs 000000        # your 6-digit PIN
   node ../scripts/hash-secret.mjs "your-password"
   ```
6. Set secrets (paste each generated hash when prompted):
   ```
   npx wrangler secret put USER_PIN_HASH
   npx wrangler secret put ADMIN_PASSWORD_HASH
   npx wrangler secret put ADMIN_EMAIL
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put WEATHER_API_KEY
   ```
7. Configure the security mode. The Worker runs in **development** mode by default
   (same-site `SameSite=Strict` cookies + the localhost-only dev CORS allowlist).
   For production — where the Pages frontend and the Worker backend are different
   sites — enable production mode so session cookies become `SameSite=None` and
   CORS/CSRF origin checks accept exactly your deployed frontend origin:
   ```
   npx wrangler secret put ENVIRONMENT    # enter: production
   ```
   Production mode ignores `ALLOWED_ORIGINS` in `wrangler.toml`; the accepted
   origin is fixed to `https://lovejar-v2.pages.dev` in `backend/src/lib/security.ts`.
8. Deploy:
   ```
   npm run deploy
   ```
   Note the `*.workers.dev` URL Wrangler prints — you'll need it for the frontend.

## Deploying the frontend

Cloudflare Pages is the natural free-tier pairing here:

1. `cd frontend && npm install`
2. Copy `.env.example` to `.env` and set `VITE_API_BASE` to your deployed Worker URL.
3. `npm run build` (outputs to `frontend/dist`)
4. Deploy `dist/` via Cloudflare Pages (drag-and-drop in the dashboard, or `npx wrangler pages deploy dist`).
5. Ensure the backend has `ENVIRONMENT=production` set (step 7 of "Deploying the backend"),
   then redeploy the backend so the new security configuration takes effect.

## Local development

```
# terminal 1
cd backend && npm run db:migrate:local && npm run dev   # http://localhost:8787

# terminal 2
cd frontend && npm run dev                                # http://localhost:5173
```

## Resetting the PIN/password later

When the user forgets their PIN, the login screen's forgot flow creates a reset request. The admin
Settings page lists pending requests: **Approve** applies the PIN the user actually chose (it returns
the hash for `wrangler secret put USER_PIN_HASH`), or **Deny** discards it. The "Generate PIN hash" /
"Generate password hash" buttons compute a fresh hash manually.

Because Workers secrets can't be rewritten by the Worker itself at runtime, applying any hash still
requires running the `wrangler secret put` command the UI shows you and redeploying. This is a
Cloudflare Workers constraint, not a shortcut I skipped — there's no way around it without a
different secrets backend.
