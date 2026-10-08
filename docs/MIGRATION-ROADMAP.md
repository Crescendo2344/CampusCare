# Migration and release status

## Implemented in the complete-module release

- The small entry HTML mounts imported shell templates, shared styles and extracted assets.
- All 67 feature modules have explicit ES imports/exports. Ordered source assembly and the window binding bridge are removed.
- Authentication/session, data and feature UI state have explicit owners; one auth subscription restores sessions, handles recovery and clears account caches on sign-out.
- Existing action transports, record rules and data synchronization use injected services/collaborators. Stale-account responses are discarded by the migrated synchronization service.
- Generated HTML events use lexical callbacks and delegated listeners; calendars resolve named callbacks through the application registry.
- Reporting, exports and camera implementation load on demand. Shared code and the pinned Supabase SDK are split into smaller bundles.
- Sidebar badges, schedule/draft behavior and existing page design are retained. Task Center and Recent Activity remain removed.

Normal JavaScript component modules complete this source migration; React is not required. Future improvements can refine component size and reduce cross-feature dependencies without returning to HTML assembly.

## Verification gates

| Gate | Evidence / status |
|---|---|
| Independent logic and architecture | `npm test`: 68 checks plus production-bundle regression scenarios |
| Production ES graph | VM integration checks startup, explicit state, role dashboards, badges, drafts, schedule rules, delegated clicks and redirect origin |
| Browser/API contracts | `npm run test:browser`: Chromium desktop/mobile role scenarios with intercepted synthetic Supabase responses |
| Deployed backend configuration | Read-only checks confirm 33/33 public tables have RLS; sensitive storage is private; required jobs are active; referenced Edge Functions are deployed |
| Existing data integrity | Backend report identifies one inconsistent patient archive/account-status link; requires review of intended account status |
| Live authenticated workflows | Remain a separate gate: real role test accounts, production callbacks/emails, writes, signed downloads and device camera behavior must be exercised |
| Final Vercel release | Check the exact merged commit is Ready in production and that public pages/assets load |

Fixture tests verify frontend behavior and request/response contracts. They do not establish real backend role authorization or delivery of confirmation/recovery emails. The read-only backend report does not substitute for role-based browser testing.

## Checks needed for a fully verified live release

Use dedicated Patient, Doctor, Staff and Administrator test accounts and synthetic patient records:

1. Verify confirmation, login/logout, expiry and password recovery on the production domain.
2. Exercise booking/cancellation, weekly work patterns, lunch boundaries, future schedules, conflicts and request approval.
3. Exercise patient/treatment/dental/reminder records, fitness and account-scoped drafts.
4. Exercise certificate request/preparation/doctor signing/rejection/download and messaging/read counts.
5. Exercise approvals, inventory, exports, settings, backups, privacy/issue requests and denied-role access.
6. Confirm private signed downloads, responsive forms, camera denial, network failure and production logs.
7. Review the existing archive-state inconsistency against the intended account/patient status.

The frontend can be deployed while these live verification gates remain open. A Ready build means deployment completed, not that every workflow has passed.
