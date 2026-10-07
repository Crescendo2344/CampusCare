# Feature source map

These files are assembled in this exact order. Shared state remains in the compatibility runtime.

| File | Responsibility |
|---|---|
| `src/modules/00-supabase-client.js` | Supabase client |
| `src/modules/01-demo-data.js` | DATABASE |
| `src/modules/02-data-services.js` | SERVICES — a thin abstraction over direct DB access. Everything |
| `src/modules/03-utilities.js` | UTILITIES |
| `src/modules/04-clinic-information.js` | OFFICIAL CTU MAIN CLINIC INFORMATION |
| `src/modules/05-persistence.js` | PERSISTENCE — keeps every change across page reloads/browser tabs |
| `src/modules/06-audit-and-backups.js` | ACTIVITY LOGGING + LOCAL BACKUP FALLBACK (demo/offline only) |
| `src/modules/07-server-backups.js` | REAL AUTOMATED BACKUPS — SUPABASE DATABASE SNAPSHOTS |
| `src/modules/08-system-settings.js` | REAL SYSTEM SETTINGS |
| `src/modules/09-email-delivery.js` | OPERATIONAL EMAIL DELIVERY |
| `src/modules/10-theme.js` | THEME (light / dark) |
| `src/modules/11-input-validation.js` | LIVE INPUT SANITIZATION — keeps each field to characters that make |
| `src/modules/12-camera.js` | CAMERA CAPTURE (selfie + ID) — requests device camera permission |
| `src/modules/13-document-scanner.js` | REGISTRATION DOCUMENT SCANNER |
| `src/modules/14-predictive-analytics.js` | ---------- Predictive Campus Health Analytics ---------- |
| `src/modules/15-inventory-service.js` | REAL SUPABASE INVENTORY |
| `src/modules/16-notifications.js` | NOTIFICATIONS — REAL SUPABASE CENTER |
| `src/modules/17-assistant.js` | AI ASSISTANT — a built-in helper that answers from your live app |
| `src/modules/18-authentication.js` | AUTH |
| `src/modules/19-login-lockout.js` | LOGIN ATTEMPT LOCKOUT — basic brute-force protection |
| `src/modules/20-password-recovery.js` | FORGOT PASSWORD — real Supabase email recovery |
| `src/modules/21-session-security.js` | SESSION SECURITY — INACTIVITY TIMEOUT |
| `src/modules/22-app-initialization.js` | APP INIT |
| `src/modules/23-topbar-and-navigation.js` | TOP BAR — responsive date + role-aware navigation search |
| `src/modules/24-navigation-race-protection.js` | Some CampusCare pages load Supabase data asynchronously. If the user taps |
| `src/modules/25-privacy.js` | PRIVACY NOTICE & DATA REQUESTS |
| `src/modules/26-issue-reports.js` | REPORT AN ISSUE / FEEDBACK — REAL SUPABASE TRACKING |
| `src/modules/27-loading-skeletons.js` | DATABASE SKELETON LOADING |
| `src/modules/28-dashboard-chart-helpers.js` | Small inline sparkline used inside the Dashboard A stat cards. |
| `src/modules/29-dashboard.js` | DASHBOARD A — Priority + Trends for every CampusCare user role. |
| `src/modules/30-appointment-service.js` | REAL SUPABASE APPOINTMENTS |
| `src/modules/31-patient-appointments.js` | PATIENT – MY APPOINTMENTS |
| `src/modules/32-treatment-service.js` | REAL SUPABASE TREATMENT RECORDS |
| `src/modules/33-patient-records.js` | PATIENT – MY RECORDS |
| `src/modules/34-account-settings.js` | MY ACCOUNT |
| `src/modules/35-workflow-requests.js` | REAL ACCOUNT / DOCTOR WORKFLOW REQUESTS |
| `src/modules/36-name-change-requests.js` | NAME CHANGE REQUESTS — names can't be self-edited; must go through admin |
| `src/modules/37-doctor-schedule.js` | DOCTOR – SCHEDULE |
| `src/modules/38-doctor-patients.js` | DOCTOR – MY PATIENTS |
| `src/modules/39-patient-service.js` | REAL PATIENT MANAGEMENT |
| `src/modules/40-patient-management.js` | PATIENTS PAGE (Staff/Admin) |
| `src/modules/41-fitness-assessments.js` | FITNESS-TO-COMPETE ASSESSMENT — REAL SUPABASE WORKFLOW |
| `src/modules/42-appointments.js` | APPOINTMENTS PAGE (Staff/Admin/Doctor) |
| `src/modules/43-approval-queue.js` | APPROVALS |
| `src/modules/44-dental-survey.js` | DENTAL CLINIC PATIENT SURVEY / CLIENT SATISFACTION MEASUREMENT |
| `src/modules/45-treatment-list.js` | TREATMENTS |
| `src/modules/46-messaging.js` | SECURE CAMPUSCARE MESSAGING — REAL SUPABASE WORKFLOW |
| `src/modules/47-inventory.js` | INVENTORY |
| `src/modules/48-reports.js` | REPORTS |
| `src/modules/49-report-charts.js` | REPORT DATA VISUALIZATION (Chart.js, loaded on demand) + EXPORT |
| `src/modules/50-user-management.js` | USERS |
| `src/modules/51-settings-and-certificates.js` | RESTORED SETTINGS + PATIENT CERTIFICATE RENDERERS |
| `src/modules/52-certificate-service.js` | REAL SUPABASE MEDICAL CERTIFICATES |
| `src/modules/53-modals.js` | MODALS |
| `src/modules/54-calendar.js` | Modern reusable calendar |
| `src/modules/55-date-picker.js` | Reusable CampusCare date picker |
| `src/modules/56-booking-form.js` | Book Appointment |
| `src/modules/57-appointment-details.js` | View Appointment |
| `src/modules/58-patient-form.js` | Patient Modal |
| `src/modules/59-treatment-form.js` | Treatment Modal |
| `src/modules/60-inventory-forms.js` | Inventory Modals |
| `src/modules/61-user-form.js` | Add User Modal |
| `src/modules/62-startup.js` | Keyboard |
| `src/modules/63-schedule-and-drafts.js` | Schedule validation and session draft helpers |
