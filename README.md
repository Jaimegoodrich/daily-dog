# Daily Dog

Dog hiking/boarding operations app — client & dog profiles, recurring weekly
hike schedules, route building, employee PIN login with pickup/dropoff/farm
time tracking, daily and weekly reports, and a tagged photo gallery.

**Live app:** https://daily-dog-five.vercel.app

## Stack

- Vite + React + TypeScript, Tailwind CSS
- Supabase (Postgres, Auth, Storage, Edge Functions)
- Deployed on Vercel, auto-deploying from the `main` branch

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project URL + anon key
npm run dev
```

## Database

`supabase/schema.sql` is the full schema (run once on a fresh Supabase
project). Everything after that ships as numbered files under
`supabase/migrations/` — run new ones in order against the SQL Editor as
they're added.

Two Edge Functions handle auth:
- `pin-login` — exchanges an employee's 4-digit PIN for a session
- `admin-create-employee` — lets an admin create employee (PIN-based) or
  additional admin (email/password) accounts

Deploy them with:

```bash
supabase functions deploy pin-login --no-verify-jwt
supabase functions deploy admin-create-employee
```
