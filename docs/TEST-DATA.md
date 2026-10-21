# Five-month testing dataset

Batch: `CC-SAMPLE-5M-v1`. Imported into the existing CampusCare test project on **October 21, 2026 (Asia/Manila)**. Historical period: **May 21–October 20, 2026**, plus a small current/upcoming appointment queue. All added people, conversations, clinical entries, stock and documents are fictional and labeled `Sample`, `SAMPLE`, or the batch identifier.

## Test accounts

The temporary password is supplied privately, never stored in Git. Existing administrator accounts remain the entry point for administrative checks; no new administrator login is created.

| Username | Role/scenario |
| --- | --- |
| `ccsample.p01`–`ccsample.p28` | Active patients; student and personnel examples |
| `ccsample.p29`, `ccsample.p30` | Pending registration review; labeled placeholder selfie/front/back images |
| `ccsample.p31` | Suspended patient |
| `ccsample.p32` | Archived patient with historical care |
| `ccsample.medical` | General medicine doctor |
| `ccsample.dental` | Dentist |
| `ccsample.staff` | Clinic staff |

The 24 initial students cover six colleges and Morning/Evening/Mixed/not-recorded class sessions. Some records intentionally omit optional data. Sample email addresses use the reserved `example.test` domain.

## Suggested checks

| Module | Data/scenarios and checks |
| --- | --- |
| Dashboard | Date filtering across the five-month period; clinical/dental totals and monthly demand changes |
| Patient records | Current, suspended and archived examples; demographics; combined college/session filters; linked care history |
| Appointments | 448 sample bookings, with Completed, Cancelled, No-show, Pending, Confirmed and Scheduled statuses; current/upcoming bookings for action tests |
| Treatments / dental chart | 375 linked treatments; active/archived entries; 169 dental charts; check matching patient, doctor, booking and date |
| Registration approvals | Two pending accounts; open and close each synthetic image preview; approve/reject only these clearly labeled accounts |
| Certificates | 20 requests across all five statuses; every document is watermarked **SAMPLE — NOT VALID** and has no real signature |
| Fitness assessments | 20 examples across all four statuses and all three decisions; fictional findings only |
| Inventory | Eight items; normal/low/zero/expiring/expired/archived scenarios; 458 transactions including restocks, usage and reductions; balances reconcile |
| Reports | Combine date, college, clinic, status and session filters; compare summary rows, matching records and CSV exports |
| Forecast | Select May 21–October 20 as history, compare shorter history and 4/8/12-week horizons; visit and individual medicine projections |
| Surveys | Synthetic ratings and satisfaction responses linked to completed dental visits |
| Messages | Fictional conversations plus actual uploaded TXT, PNG and test-tone WAV attachments and a sample link; filenames, preview, playback, forwarding and scroll behavior |
| User management | More than ten rows; all statuses; pending edit restrictions; approval, suspend/reactivate and change confirmation |
| Schedules / leave | Two sample doctors with weekly rules; a blocked slot, a day off, and name/schedule/day-off request scenarios |
| Notifications / email | In-app examples; sample outbox rows are **Skipped**, not falsely marked Sent; no sample email delivery is scheduled |
| Feedback / issues | Open, In Review, Resolved and Dismissed scenarios with follow-up replies |
| Resources / drafts | Published/archived sample content and unsent sample drafts |
| Activity / consent | Explicitly labeled import/audit examples and simulated sample-account consents |
| Settings / backups | Existing configuration and genuine backups are preserved. Test actual backup creation/restore separately; no fictitious successful backup is recorded |
| Camera / CAPTCHA / recovery | Test these live with the device/provider. Seed images are placeholders and do not demonstrate a successful identity check or email delivery |

Seeded UAT checklist rows remain **Not Tested** until a tester actually performs them. Loading sample records does not establish that every action has passed.

## Reproducibility and safety

- `scripts/test-data/seed-five-months.sql` creates the linked batch in one transaction and refuses duplicate imports. Supply a fresh private bcrypt password hash using the configuration named in the file. Never commit a plaintext password or hash for a deployed test account.
- `scripts/test-data/verify-five-months.sql` returns aggregate coverage and consistency checks without exposing existing patients' details.
- `scripts/test-data/populate-fixtures.py` signs in only as `ccsample.*` accounts using their own sessions and the public browser key. Private manifests contain no session tokens. Review assets upload under the owner's Auth UUID in the private verification bucket. Attachments are sent only between synthetic accounts.
- Historical appointment import briefly pauses only the past-date integrity trigger while holding an exclusive transaction lock. It restores the same trigger before commit; foreign-key/check/unique constraints and authorization policies remain in place. Both seed and cleanup were tested in rollback-only transactions first.
- Sample-only notification emails generated by database triggers are marked Skipped inside the import transaction, before dispatchers can observe them.
- Attachment preparation temporarily blanks only `ccsample.p01`'s public profile email, then restores it after sending fixtures. The loader refuses to run unless this suppression is in place. This prevents notification-email queuing while keeping the Auth email intact.

## Cleanup

First remove the sample fixture files through the Storage API while their sample accounts still exist. Verification paths start with `<sample-auth-uuid>/CC-SAMPLE-5M-v1`. Message attachment names contain the batch identifier under the synthetic staff account's folder. Use owner-authenticated deletion or an authorized administrator workflow; do not delete Storage metadata directly with SQL.

Then run `scripts/test-data/cleanup-five-months.sql` as the project owner. It deletes only IDs tracked in `presentation_sample_entities` for this batch, in dependency order, then revokes/removes the corresponding synthetic Auth accounts. It leaves real users, settings, backups and records intact. Foreign keys deliberately stop cleanup if testers created new untracked records that depend on the sample batch; review those records first instead of cascading into unrelated data.
