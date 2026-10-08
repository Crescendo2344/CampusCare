# CampusCare module map

CampusCare now uses ordinary ES-module imports. There is no ordered source concatenation, virtual runtime or window binding bridge.

| Location | Responsibility |
|---|---|
| `src/main.js` | Mount imported shell templates, install events and start the application |
| `src/components/` | Landing/authentication, application shell, notification panel, modal host and restore skeleton templates |
| `src/features/` | Feature page renderers, controls and actions exported as normal JavaScript APIs |
| `src/app/state.js` | Named feature state containers, with dedicated authentication and data namespaces |
| `src/app/application.js` | Single initialization lifecycle and application API |
| `src/app/features.js` | Explicit feature imports and initialization calls |
| `src/app/session-state.js` | Account cache cleanup and navigation invalidation on sign-out |
| `src/app/callbacks.js` | Explicit callback registry for reusable calendar/date controls |
| `src/app/optional-features.js` | On-demand reporting, exports and camera imports, with stale-route protection |
| `src/app/optional-state.js` | Optional-feature state defaults without importing their implementation |
| `src/domain/` | Independent schedule and record normalization rules |
| `src/services/` | Injected client/HTTP access, draft storage and backend synchronization |
| `src/shared/` | Value sanitization, formatting and contact masking |
| `src/ui/` | Stateless display markup and delegated callback events |
| `src/dependencies.js` | Explicit dependency exports used by feature adapters |
| `public/bootstrap/theme.js` | Small appearance script that prevents a theme flash before modules load |
| `tests/` | Module, architecture, production-bundle and Chromium fixture checks |

`src/features/` contains 67 modules, including separate authentication/session logic, dashboards, appointments, treatments, patients, certificate/fitness workflows, messaging, inventory, approvals, reports, settings and reusable form/calendar controls. See [feature-manifest.json](feature-manifest.json) for each module's exports, imports and state ownership. Run `npm run modules:map` after moving feature APIs.

Page renderers are JavaScript components. They keep the existing design and behavior; this migration does not require React.

## Adding or changing a feature

1. Put pure record/schedule logic in `src/domain/` and transport/loading in `src/services/`. Inject the client, request function, state or collaborators they need.
2. Import dependencies explicitly in the feature module. Put feature-owned state under its namespace; keep authenticated account state in `state.auth`.
3. Export component/action functions. If a new feature needs initialization, add its explicit initializer to `src/app/features.js`.
4. Use `bindAction(eventType, callback)` to create event attributes in generated markup. Callbacks capture values directly; do not serialize executable code into HTML or publish functions on window.
5. Use the explicit callback registry for calendar callbacks by name. Use optional loaders for expensive UI features.
6. Run the relevant tests and production build before release.

## State and events

Account/profile state belongs to `state.auth`; records belong to `state.data.DB`; UI controls use named feature namespaces. Modules import state rather than depending on browser globals. Account-scoped drafts remain isolated by account and live/demo mode. Backend synchronization discards responses if the authenticated account changed while the request was in flight.

Shell actions register persistent callbacks. Dynamic page markup registers lexical callbacks in `src/ui/events.js`; one delegated listener per event type dispatches them and discarded markup releases its callbacks. There is no runtime eval or Function compilation. The application emits `campuscare:ready` so diagnostics/test fixtures can observe its explicit API without a window bridge.

Task Center and Recent Activity remain removed. Sidebar attention badges and the administrator audit log remain available.
