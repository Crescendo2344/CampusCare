# Five-month testing dataset

Batch: `CC-SAMPLE-5M-v1`. Imported into the existing CampusCare test project on **October 21, 2026 (Asia/Manila)**. Historical period: **May 21–October 20, 2026**. On **November 5, 2026** the batch was given realistic Filipino names, ID numbers, contacts and clinical wording, and topped up with bookings and requests from that date onward. Everyone and everything in it is fictional; the batch identifier stays in the tracking table, not in what users see.

## Test accounts

All people below are fictional. Sign-in emails use the reserved `example.test` domain, so no message can reach a real person; test real email delivery with your own accounts. The password is the one supplied privately for the October batch (it is never stored in Git). Administrators cannot reset another account's password in the app, and recovery emails cannot reach `example.test`. To choose a new one, run this yourself in the Supabase SQL editor with a password of your choice:

```sql
update auth.users set encrypted_password = crypt('<your test password>', gen_salt('bf'))
where raw_app_meta_data->>'sample_batch' = 'CC-SAMPLE-5M-v1';
```

| Username | Name | Role / scenario |
| --- | --- | --- |
| `carlo.mendoza` … `hannah.quijano` | 24 students (e.g. Carlo Mendoza, Andrea Villanueva, Miguel Ramos, Patricia Navarro) | Active patients across CCICT, COE, COED, CME, CAS and COT; Morning, Evening, Mixed and not-recorded class sessions |
| `ronaldo.villacorta`, `liza.montecillo` | Ronaldo Villacorta, Liza Montecillo | Teaching personnel (patients) |
| `antonio.cabatingan`, `rosemarie.tumulak` | Antonio Cabatingan, Rosemarie Tumulak | Non-teaching personnel (patients) |
| `daniel.ompad` | Daniel Ompad | Pending registration with placeholder ID and selfie images; approve him to test a patient with no visit history (the only test patient who can still book dental this semester) |
| `kevin.lumapas` | Kevin Lumapas | Suspended patient |
| `macristina.belarmino` | Ma. Cristina Belarmino | Archived patient with past care |
| `dr.ramon.villareal` | Dr. Ramon Villareal | General Medicine doctor (the only medical doctor) |
| `dr.katherine.uy` | Dr. Katherine Uy | Dentist |
| `lorna.gimenez` | Lorna Gimenez | Clinic staff |

Real accounts (the administrator, Dr. Jilt Sanchez, Dr. Jennifer Irene Buchan, staff and the registered patients) are never part of the batch and are not changed by these scripts. Dr. Jilt Sanchez's doctor-workflow examples are a second tracked batch, `CC-DOCTOR-JILT-v1`, using the same fictional patients.

## Suggested checks

| Module | Data/scenarios and checks |
| --- | --- |
| Dashboard | Date filtering across the five-month period; clinical/dental totals and monthly demand changes |
| Patient records | Current, suspended and archived examples with addresses, emergency contacts, allergies and history; combined college/session filters; linked care history |
| Dental quota | The limit is 1 dental visit per semester and every active test patient already used it, so their dental booking is locked (**Limit Reached**). Approve Daniel Ompad to test a patient who can still book |
| Appointments | About 470 bookings with Completed, Cancelled, No-show, Pending, Confirmed and Scheduled statuses. From Nov 5, 2026: today's queue (medical and dental), tomorrow's bookings for **Send reminder**, next week's Pending/Scheduled bookings and one cancelled in advance. Late-October bookings still open appear under **Needs outcome** |
| Treatments / dental chart | 375 linked treatments; active/archived entries; 169 dental charts; check matching patient, doctor, booking and date |
| Registration approvals | Two pending accounts; open and close each synthetic image preview; approve/reject only these clearly labeled accounts |
| Certificates | 32 certificates across all statuses and the three purposes (OJT / Internship, Excused Absence, Sports). Numbers end in `T` (e.g. `CTU-MC-2026-T0001`) and every document body reads **TEST DOCUMENT — NOT VALID**; none has a real signature |
| Fitness assessments | 20 examples across all four statuses and all three decisions; fictional findings only |
| Inventory | Eight items (Paracetamol 500 mg, Cetirizine 10 mg, Chlorhexidine mouthwash, gloves, gauze…): normal, low (Paracetamol), zero and expired (Cetirizine), expiring within 90 days (Chlorhexidine), archived (cotton balls); 458 transactions; balances reconcile |
| Reports | Combine date, college, clinic, status and session filters; compare summary rows, matching records and CSV exports |
| Forecast | Select May 21–October 20 as history, compare shorter history and 4/8/12-week horizons; visit and individual medicine projections |
| Surveys | Synthetic ratings and satisfaction responses linked to completed dental visits |
| Messages | Fictional conversations plus actual uploaded TXT, PNG and test-tone WAV attachments and a sample link; filenames, preview, playback, forwarding and scroll behavior |
| User management | More than ten rows; all statuses; pending edit restrictions; approval, suspend/reactivate and change confirmation |
| Schedules / leave | Doctors with weekly rules; Dr. Uy's day off on Nov 13 and Dr. Villareal's blocked 10:00 slot on Nov 10; pending name, schedule (from Nov 16) and day-off (Nov 20) requests plus approved/rejected examples |
| Notifications / email | In-app examples; sample outbox rows are **Skipped**, not falsely marked Sent; no sample email delivery is scheduled |
| Feedback / issues | Open, In Review, Resolved and Dismissed reports with replies, plus an **Urgent** login problem and a **High** booking bug |
| Resources / drafts | Published/archived sample content and unsent sample drafts |
| Activity / consent | Explicitly labeled import/audit examples and simulated sample-account consents |
| Settings / backups | Existing configuration and genuine backups are preserved. Test actual backup creation/restore separately; no fictitious successful backup is recorded |
| Camera / CAPTCHA / recovery | Test these live with the device/provider. Seed images are placeholders and do not demonstrate a successful identity check or email delivery |

Seeded UAT checklist rows remain **Not Tested** until a tester actually performs them. Loading sample records does not establish that every action has passed.

## Reproducibility and safety

- `scripts/test-data/realistic-rename.sql` gives both batches realistic names and wording. It changes only tracked rows and is safe to re-run.
- `scripts/test-data/topup-november.sql` adds the November 5, 2026 bookings, day off, blocked slot and urgent issues, tracked as `CC-SAMPLE-5M-v1|topup-2026-11`. Any email its triggers queue is marked Skipped in the same transaction.

- `scripts/test-data/seed-five-months.sql` creates the linked batch in one transaction and refuses duplicate imports. Supply a fresh private bcrypt password hash using the configuration named in the file. Never commit a plaintext password or hash for a deployed test account.
- `scripts/test-data/verify-five-months.sql` returns aggregate coverage and consistency checks without exposing existing patients' details.
- `scripts/test-data/populate-fixtures.py` signs in only as `ccsample.*` accounts using their own sessions and the public browser key. Private manifests contain no session tokens. Review assets upload under the owner's Auth UUID in the private verification bucket. Attachments are sent only between synthetic accounts.
- Historical appointment import briefly pauses only the past-date integrity trigger while holding an exclusive transaction lock. It restores the same trigger before commit; foreign-key/check/unique constraints and authorization policies remain in place. Both seed and cleanup were tested in rollback-only transactions first.
- Sample-only notification emails generated by database triggers are marked Skipped inside the import transaction, before dispatchers can observe them.
- Attachment preparation temporarily blanks only `ccsample.p01`'s public profile email, then restores it after sending fixtures. The loader refuses to run unless this suppression is in place. This prevents notification-email queuing while keeping the Auth email intact.

## Cleanup

First remove the sample fixture files through the Storage API while their sample accounts still exist. Verification paths start with `<sample-auth-uuid>/CC-SAMPLE-5M-v1`. Message attachment names contain the batch identifier under the synthetic staff account's folder. Use owner-authenticated deletion or an authorized administrator workflow; do not delete Storage metadata directly with SQL.

Then run `scripts/test-data/cleanup-five-months.sql` as the project owner. It deletes only IDs tracked in `presentation_sample_entities` for this batch, in dependency order, then revokes/removes the corresponding synthetic Auth accounts. It leaves real users, settings, backups and records intact. Foreign keys deliberately stop cleanup if testers created new untracked records that depend on the sample batch; review those records first instead of cascading into unrelated data.
