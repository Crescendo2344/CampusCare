# CampusCare migration and deployment roadmap

## Current state

The Vite frontend is already deployed on Vercel with GitHub-triggered builds. Supabase supplies authentication, database, storage and existing Edge Functions. Deployment readiness and finishing the source migration are separate milestones.

The original HTML has been split into entry HTML, shell templates, styles, assets and 64 feature source files. Schedule rules, account-scoped drafts, formatting, display markup, input policies, inventory, appointments, treatments/dental/reminders, patients, notifications and certificate data now have independent ES-module boundaries. Certificate extraction is included in this change.

Most page rendering, forms and shared state still live in the assembled compatibility runtime. The file split therefore does not mean the entire app is independently componentized. Sidebar badges remain; Task Center and Recent Activity remain removed. The administrator audit log is retained.

## Remaining phases

Each phase may require several focused pull requests. This is a sequence of completion criteria, not a claim that seven small changes will finish the work.

| Order | Work | Completion criterion |
|---|---|---|
| 1 | Merge the certificate extraction after its preview passes | New certificate module tests and production-bundle integration checks pass; the exact main commit has a Ready production deployment |
| 2 | Extract remaining data/workflow services | Fitness assessments, messaging, approvals/account/name/schedule requests, surveys, privacy requests, issue reports, settings, email and backups use explicit dependencies; existing endpoints and access rules are covered by fixtures |
| 3 | Isolate authentication and application state | Client configuration, auth/session lifecycle, role permissions, account state, demo state and persistence have clear owners; bootstrap ordering and session recovery are covered |
| 4 | Convert feature pages and reusable controls to imported components | Dashboard, lists, forms, calendar/date picker, navigation/badges, notifications, reports and media controls render through explicit APIs; their events no longer depend on inline global handlers |
| 5 | Retire the compatibility runtime and split bundles | Entry code imports features normally; ordered source concatenation and the window binding bridge are removed; heavier reports/media/features load when needed; builds and regression checks pass |
| 6 | Verify the complete authenticated application | Representative Patient, Doctor, Staff and Administrator workflows pass through browser, API and Supabase; redirects, permissions, row-level access, storage/downloads and failure states are verified |
| 7 | Verify the final production release | Preview passes, the approved commit is merged, Vercel production is Ready and serves the intended commit, public configuration/redirects match the production domain, and production smoke checks show no blocking browser/API errors |

React is not a prerequisite. Normal JavaScript modules and imported UI components can complete this migration without introducing a framework change.

## End-to-end checks before calling the release fully verified

Use dedicated test accounts and synthetic records, rather than real patient information. Check role authorization on the backend as well as visibility in the interface.

- Registration/confirmation, login/logout, expired sessions, password reset and email redirects.
- Appointment availability, booking, cancellation, recurring work days, lunch breaks, capacity, conflicting/future schedules and schedule request/approval.
- Account-scoped save/restore/discard drafts and account switching.
- Patient/treatment/dental/reminder records, fitness assessments and document attachments.
- Certificate request, preparation, assigned-doctor review/signing, rejection and download.
- Messaging and notification read/read-all, including persistent sidebar counts.
- Staff/admin approvals, inventory, reporting/export, settings and backup access.
- Privacy/issue requests and role-restricted records, signed storage URLs and denied access.
- Responsive navigation/forms, camera permission failures, network/server failures and browser console errors.

## What the existing checks prove

`npm test` runs independent-module tests, builds the production assets and exercises the assembled interface in JSDOM with synthetic clients and requests. It checks runtime bindings, dashboards, badges, drafts, schedule rules, redirect origin and migrated data adapters. It does not verify real Supabase row-level security, deployed Edge Functions, email delivery, browser rendering, device camera behavior or authenticated production writes.

A Ready Vercel build proves the deployment completed. It does not establish that every authenticated workflow passed. The site can remain deployed throughout the migration; each tested change reaches production incrementally.
