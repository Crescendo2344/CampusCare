# Student coverage and registration reports

Staff and administrators can choose **Reports → Student Coverage & Registration**. All student filters combine with the selected college and date range. Other report types and the clinical overview keep their existing date/college scope.

## Filters

- College, including actual directory values and unknown college.
- Class session: Morning, Evening, Mixed/both, or Not recorded.
- Dental care: recorded use, no recorded use, or no linked patient record.
- Medical care: recorded use or no recorded use. Combine with dental for both, dental-only, medical-only, or neither.
- Service-use period: selected range or all recorded history through the selected end date.
- Registration cohort: registered by end date or newly registered within the range.
- Current record scope: non-archived, all, or archived only.
- Account status, verification, sex, age at report end date, and name/university ID search.

## Meaning of totals

Registered students are unique **CampusCare student accounts**, not total university enrollment. A cohort includes demographic, registration, and record-scope filters. College totals use that cohort **before** dental/medical-use filters; matching student rows apply every filter. The report shows its applied filters so exported records can be interpreted consistently.

A completed dental booking or a recorded dental treatment/chart counts as dental use. Pending/cancelled appointments do not. Linked appointment/treatment/chart evidence is deduplicated. No recorded dental care means no evidence in CampusCare for the selected service-use period; it does not prove a student never received dental care elsewhere. Accounts with no linked patient record are separate from known non-users.

Class session is optional and stored on the patient record. Staff/administrators confirm it in **Patient Records → Edit → Student class session**; non-students do not retain a class session through the updated form. Existing records remain unclassified. The system never infers session from appointment times, student IDs, or college. Changes use the existing authorized patient-actions endpoint and audit path.

## Exports and source completeness

Matching students use the existing CSV/Excel/Word/print export controls. College totals have a separate summary CSV. Age/sex/session and service counts are included without exporting diagnoses, prescriptions, or clinical notes.

The student-reports endpoint validates the current authenticated user against an active Staff/Administrator database role and paginates every required source table. It fails explicitly beyond 100,000 rows in any source table rather than silently reporting incomplete totals. Existing table RLS/grants are unchanged. It is not available to patients/doctors as a campus roster report.

## Validation

Synthetic tests cover deduplication, completed-versus-pending use, unknown classification/coverage, date/history/cohort distinctions, combined filters, archival scope, age boundaries, authentication/role rejection, pagination beyond 1,000 students, database failures, class-session validation/saving, and browser filters/downloads. Real clinical records were not changed to perform tests.
