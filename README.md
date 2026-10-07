# CampusCare

CampusCare's existing JavaScript interface, organized into feature files and built with Vite. Supabase remains the database, authentication, storage and backend provider. Vercel hosts the frontend.

## Local setup

Install Node.js 22.12 or newer (Node.js 24 LTS is suitable), then run:

```bash
# Install the exact versions recorded in the lockfile.
npm ci

# Copy the configuration template and fill in the public Supabase settings.
cp .env.example .env.local

# Start the local site after configuring the environment.
npm run dev
```

On Windows, copying `.env.example` to `.env.local` in VS Code works too. Open the local URL printed by Vite. Opening index.html directly does not assemble the components or feature files.

## Configuration

- `VITE_SUPABASE_URL`: existing project's URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the public publishable key.
- `VITE_CAMPUSCARE_APP_URL`: optional production origin for email links. Without it, the current site's origin is used.

The existing public project settings remain as compatibility defaults. Never place a service-role key, database password or other secret in a `VITE_` variable. Variables with this prefix appear in browser code. `.env.local` is ignored by git.

## File layout

- `index.html`: small entry document.
- `src/components/`: landing/authentication shell, app shell and modal host.
- `src/styles/`: shared styling and draft controls.
- `src/domain/schedule.js`: independent schedule/date/slot rules with explicit record inputs.
- `src/services/draft-storage.js`: account-scoped draft storage with injected storage/account access.
- `src/domain/inventory-records.js`: inventory selection, mapping and snapshot assembly.
- `src/services/inventory.js`: inventory API actions and queries with an injected client/request function.
- `src/shared/`: independent input-value sanitization and formatting.
- `src/ui/display-markup.js`: stateless display badges and icons.
- `src/modules/`: 64 ordered feature source files; see [module map](docs/MODULES.md).
- `src/module-order.json`: source assembly order.
- `src/main.js`: Vite entry point.
- `src/legacy-dependencies.js`: explicit imports used by the remaining compatibility adapters.
- `public/bootstrap/`: early theme and session UI helpers.
- `public/assets/`: extracted, deduplicated images.
- `public/ctu-campus.png`: existing campus image.
- `tests/migration.test.cjs`: production-bundle compatibility checks with remote requests disabled.
- `archive/newchange.html`: unchanged older alternate page, kept for reference.

## How the first migration works

Legacy feature files retain shared state, while schedule rules, draft storage, formatting, input-value sanitization, display markup and inventory data access are now ordinary ES modules with explicit inputs. Small adapters preserve the existing form handlers. The independent modules can be imported directly without initializing the application.

Legacy feature files retain their original functions. The Vite plugin joins them in their original order into one runtime, and exposes the bindings needed by existing inline handlers and early session helpers. The plugin discovers new top-level declarations automatically.

This separates the source and removes embedded image duplication; it does not yet isolate feature state, remove inline handlers, convert pages to React, or lazy-load feature bundles. Those changes can follow feature by feature with regression checks. Do not import the fragment files independently yet: initialization order and shared variables still matter.

For new independent logic, use `src/domain/` or `src/services/` with explicit imports and dependencies. Use `src/shared/` for reusable value helpers and `src/ui/` for presentation helpers. Keep DOM operations in UI adapters. Do not access `DB`, `currentUser`, or `window` inside these modules.

To add a new legacy feature file, add its relative path and purpose to `src/module-order.json`. Edit templates in `src/components/`, not the generated HTML in `dist/`.

Task Center and Recent Activity are removed. Sidebar attention badges and the administrator audit log are retained. Save/Restore/Discard Draft remain in appointment and schedule forms.

## Verification

```bash
# Build and exercise the production bundle without sending data to Supabase.
npm test

# Create the production files Vercel will publish.
npm run build
```

Inventory service checks use injected clients and requests to cover missing sessions, action errors, query failures, forecast fallback and demo/live row separation. Independent-module checks cover input character/length policies, formatting, display classes, schedule conflicts, future schedule selection, configurable lunch boundaries, validation context, and account/mode isolation for draft storage. DOM checks cover startup, role dashboards, sidebar badges, drafts, inline handler access, schedule validation, slot boundaries and redirect origin. Visual browser QA and live authenticated Supabase workflows still need checking. The single shared bundle intentionally remains large in this first migration.

## Vercel deployment

1. Import the CampusCare GitHub repository into the correct Vercel account/team.
2. Set Framework Preset to **Vite**, Build Command to `npm run build`, Output Directory to `dist`, and keep the repository root as Root Directory.
3. Add the three public environment variables above. Set the production app URL to the final production origin.
4. Deploy the migration branch as a preview before changing production.
5. In Supabase Authentication URL Configuration, allow the required local/preview/production redirect URLs and set the production Site URL. Check the origins accepted by existing Edge Functions too.
6. Verify confirmation/recovery emails, login, every role's navigation, booking, certificates, messages and file downloads before promotion.

The project includes a SPA fallback in `vercel.json`. Existing hash navigation remains supported.
