# Indira BluePrint PMS

Project management system built with React + Vite + Supabase, deployed on Vercel.

## Stack

- **Frontend:** React 18, React Router 6, Vite 5
- **Backend:** Supabase (Postgres, Auth, Storage)
- **Hosting:** Vercel
- **Testing:** Vitest + React Testing Library
- **Linting:** ESLint 9

## Local setup

```bash
npm install
cp .env.example .env
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase project
npm run dev
```

App runs at http://localhost:5173.

## Scripts

| Command          | What it does                       |
| ---------------- | ---------------------------------- |
| `npm run dev`    | Vite dev server                    |
| `npm run build`  | Production build to `dist/`        |
| `npm run preview`| Preview the production build       |
| `npm run lint`   | ESLint over the repo               |
| `npm test`       | Run Vitest suite once              |
| `npm run test:watch` | Run Vitest in watch mode       |

## Project layout

```
src/
  components/   reusable UI pieces
  pages/        route-level components
  layouts/      page shells (nav, sidebar)
  services/     Supabase queries / API calls
  hooks/        custom React hooks
  lib/          third-party client setup (supabaseClient.js)
  utils/        pure helpers
supabase/
  migrations/   SQL migrations (via supabase CLI)
tests/          Vitest specs + setup
```

## Branching

- `main` — Production (Vercel Production deploy)
- `develop` — Integration (Vercel Preview)
- `feat/*`, `fix/*`, `chore/*` — short-lived, PR into `develop`

## Deployment (Vercel)

1. Import the repo into Vercel.
2. Framework preset: **Vite** (auto-detected).
3. Set env vars for all environments:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Production Branch: `main`. All other branches deploy as Previews.

## Supabase

Install the CLI once you're ready to manage schema:

```bash
npm i -D supabase
npx supabase init
npx supabase migration new <name>
npx supabase db push
```
