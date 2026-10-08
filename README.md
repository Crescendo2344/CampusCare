# CampusCare

CampusCare is a Vite frontend backed by Supabase and hosted on Vercel. The original HTML application has been migrated to imported templates, 67 JavaScript feature modules, reusable UI controls, independent rules/services and explicit state.

## Local setup

Use Node.js 22.12 or newer:

```bash
# Install the versions recorded in the lockfile.
npm ci
# Copy the public configuration template and fill in your project values.
cp .env.example .env.local
# Start the application through Vite, which resolves its ES imports.
npm run dev
```

On Windows, copy `.env.example` to `.env.local` using VS Code. Opening `index.html` directly does not resolve component imports.

## Configuration

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public browser publishable key |
| `VITE_CAMPUSCARE_APP_URL` | Optional production origin for confirmation/recovery links; defaults to the current origin |

Existing public project settings remain compatibility defaults. Browser configuration must never contain service-role keys, database passwords or other secrets. `.env.local` is ignored by Git. The Supabase JavaScript SDK is pinned and bundled; it no longer depends on a CDN global.

## Architecture

- `src/main.js` mounts imported shell templates and starts the application once.
- `src/components/` contains landing/authentication, application, notification, modal and restore-skeleton templates.
- `src/features/` exports ordinary JavaScript component/action APIs for each feature.
- `src/app/` owns initialization, feature state, session cleanup and optional loaders.
- `src/domain/`, `src/services/`, `src/shared/` and `src/ui/` contain independent rules, injected transport/synchronization, formatting and event controls.
- `src/styles/` and `public/assets/` hold shared styling and extracted images.
- `public/bootstrap/theme.js` applies the initial appearance before the module graph loads.
- `archive/newchange.html` preserves the unchanged older alternate page for reference.

There is no source-concatenating Vite plugin, ordered fragment list, session bootstrap bridge or global inline-handler registry. Features import their dependencies and use named state containers. Generated HTML uses registered lexical event callbacks instead of executable HTML attributes. Reports, exports and the camera load on demand; the build splits shared code and the SDK into smaller chunks.

See the [module map](docs/MODULES.md), [export/dependency manifest](docs/feature-manifest.json), and [release verification status](docs/MIGRATION-ROADMAP.md). React is not required for this architecture.

Task Center and Recent Activity remain removed. Sidebar badges, administrator audit logging and account-scoped save/restore/discard drafts are retained.

## Verification

```bash
# Run module/architecture tests, build and exercise the production ES graph in JSDOM.
npm test
# Install Chromium once for local browser tests.
npx playwright install chromium
# Exercise login, profile loading, role navigation and schedule draft controls on desktop/mobile.
npm run test:browser
# Rebuild the feature export inventory after moving APIs.
npm run modules:map
# Build production assets.
npm run build
```

Browser tests self-host the built `dist/` output and intercept Supabase requests with synthetic responses. They send no patient records or test writes to the live backend. `CAMPUSCARE_TEST_URL` can select a deployed URL; the same fixture interception remains active. An environment with a preinstalled browser can set `CAMPUSCARE_CHROMIUM_PATH`.

Fixture checks do not replace authenticated production tests of Supabase permissions, deployed write actions, email callbacks, signed downloads or device camera behavior. The roadmap records those remaining gates and the observed backend integrity finding.

## Vercel

The GitHub integration builds previews and deploys `main`. Use Framework Preset **Vite**, Build Command `npm run build`, Output Directory `dist`, and the repository root as Root Directory. Set public variables for the intended environment. Match Supabase Site URL, redirect allowlist and existing Edge Function origins to the production domain.

`vercel.json` includes a SPA fallback. A Ready deployment means its build completed; confirm the exact commit and run production checks before calling the release fully verified.
