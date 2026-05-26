# vercel-api-backend

Serverless API backend for [amit-tools](https://amitcsenita.github.io/online-tools/) — a personal tools site hosted on GitHub Pages. Deployed on Vercel as Node.js serverless functions.

## Overview

The frontend (static HTML/JS on GitHub Pages) cannot safely talk to a database directly — that would expose credentials in the browser. This backend acts as the secure middle layer:

```
Browser (GitHub Pages)
  │  Firebase ID token (JWT) in Authorization header
  ▼
Vercel Serverless Functions  ← this repo
  │  Verifies token with Firebase Admin SDK
  │  Queries Supabase with service key (never exposed to browser)
  ▼
Supabase (Postgres)
```

**Identity store:** Firebase Authentication (Google OAuth)  
**Data store:** Supabase (Postgres via REST API)  
**Auth model:** Every request carries a Firebase ID token. The backend verifies it server-side, extracts the `uid`, and scopes all database queries to that user.

---

## Project Structure

```
api/
  _auth.js          # Shared Firebase Admin token verification (not a public endpoint)
  calculations.js   # GET/POST calculator history
  tasks.js          # GET/POST/PATCH/DELETE daily planner tasks + heatmap
  admin.js          # Admin-only: all users' data with real names
package.json
```

Files prefixed with `_` are not exposed as Vercel endpoints.

---

## API Endpoints

All endpoints require a valid Firebase ID token:
```
Authorization: Bearer <firebase-id-token>
```

### `GET /api/calculations`
Returns the authenticated user's last 20 calculator history entries.

```json
[
  { "id": 1, "expression": "12 × 8", "result": "96", "created_at": "2026-05-26T..." }
]
```

### `POST /api/calculations`
Saves a calculation to history.

**Body:**
```json
{ "expression": "12 × 8", "result": "96" }
```

---

### `GET /api/tasks?date=YYYY-MM-DD`
Returns all tasks for the given date, scoped to the authenticated user.

```json
[
  { "task_id": 1, "hour": 9, "task_text": "Team standup", "category": "work", "completed": false }
]
```

### `GET /api/tasks?heatmap=true`
Returns task counts (total, done, pending) per day for the last 28 days — used to render the "This Week" stacked bar chart.

```json
{
  "2026-05-26": { "total": 4, "done": 2, "pending": 2 },
  "2026-05-25": { "total": 6, "done": 6, "pending": 0 }
}
```

### `POST /api/tasks`
Creates a task at a specific hour. Each hour can have at most one task (returns 409 if already occupied).

**Body:**
```json
{ "date": "2026-05-26", "hour": 9, "task_text": "Team standup", "category": "work" }
```

Valid categories: `work`, `personal`, `health`, `general`

### `PATCH /api/tasks?id=<task_id>`
Updates text, category, or completion status. Only fields provided are updated. Users can only patch their own tasks.

**Body (all fields optional):**
```json
{ "task_text": "Updated text", "category": "personal", "completed": true }
```

### `DELETE /api/tasks?id=<task_id>`
Deletes a task. Users can only delete their own tasks.

---

### `GET /api/admin?resource=summary` _(admin only)_
Returns all users with their calculation and task counts, enriched with real display names from Firebase.

```json
[
  { "uid": "abc123", "name": "Amit Kumar", "email": "...", "calculations": 42, "tasks": 130 }
]
```

### `GET /api/admin?resource=calculations` _(admin only)_
Returns the last 100 calculations across all users with real user names attached.

### `GET /api/admin?resource=tasks&date=YYYY-MM-DD` _(admin only)_
Returns all tasks for a given date across all users with real user names attached.

Admin access is restricted to a single hardcoded email address, verified server-side from the decoded Firebase token — not just the frontend.

---

## Environment Variables

Set these in the Vercel project dashboard (Settings → Environment Variables). **Never commit these values.**

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL, e.g. `https://xyz.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (has full DB access — keep secret) |
| `FIREBASE_SERVICE_ACCOUNT` | Full Firebase Admin SDK service account JSON, stringified |

To stringify the Firebase service account JSON for the env var:
```bash
cat amit-tools-firebase-adminsdk.json | jq -c . | pbcopy   # macOS
```
Or open the JSON file, minify it, and paste the single-line string into Vercel.

---

## Supabase Schema

```sql
create table calculations (
  id          bigserial primary key,
  user_id     text not null,
  expression  text not null,
  result      text not null,
  created_at  timestamptz default now()
);

create table tasks (
  task_id    bigserial primary key,
  user_id    text not null,
  date       date not null,
  hour       smallint not null check (hour >= 0 and hour <= 23),
  task_text  text not null,
  category   text not null default 'general',
  completed  boolean not null default false,
  unique (user_id, date, hour)
);
```

---

## Security Model

- **No secrets in source code.** All keys are read from `process.env.*`.
- **Every request is authenticated.** The shared `_auth.js` module verifies the Firebase ID token on every handler. Unauthenticated requests get a 401.
- **Data is user-scoped.** All Supabase queries include `user_id=eq.${uid}` — users can only read and write their own data.
- **Admin is server-enforced.** The admin email check happens on the decoded token server-side, not just the frontend UI.
- **CORS is allowlisted.** Only `https://amitcsenita.github.io` and `http://localhost` are permitted origins.

---

## Local Development

```bash
npm install
npx vercel dev
```

Create a `.env.local` file (already gitignored) with the three environment variables above.

---

## Deployment

Pushing to `master` triggers an automatic production deployment via the connected Vercel + GitHub integration.

Manual deploy:
```bash
vercel --prod
```
