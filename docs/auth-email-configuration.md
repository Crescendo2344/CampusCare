# CampusCare registration and email confirmation

Email confirmation is temporarily skipped for **new public registrations**. The server uses Auth Admin account creation with `email_confirm: true` and records `app_metadata.email_verification_skipped: true`. It sends no signup email. The application profile remains **Pending**, **Patient**, and **unverified** until clinic personnel approve it. Existing accounts are not changed.

Selfie verification uses camera capture only in the registration UI. The private document-holding selfie is stored in `campuscare-verification`, separately from editable profile images. Camera source is recorded in the request; clinic staff must still inspect the image, face, and matching document. This is not an automated biometric liveness check.

Registration accepts Student ID or Employee ID photos only, not COR or PDF. Both front and back are required and stored privately; clinic reviewers receive temporary signed links for all three verification images. Live ID framing checks guide distance, centering, lighting, and steadiness locally. Uploads receive a photo review step. These checks do not establish document authenticity, which remains a staff decision.

To restore email confirmation for future registrations, set the `CAMPUSCARE_REQUIRE_EMAIL_CONFIRMATION` Edge Function secret to `true` and redeploy `register-patient`. Restore the confirmation/resend controls and pending-screen instructions at the same time. Already skipped accounts remain marked as skipped; enabling the setting does not retroactively verify email ownership.

Confirmation and password-reset links retain Supabase-managed expiry. No permanent email tokens are created.

## Email redirect URLs

In Supabase **Authentication → URL Configuration**, set Site URL to `https://campuscare-brown-two.vercel.app/` and allow these Redirect URLs:

- `https://campuscare-brown-two.vercel.app/?auth=confirmed`
- `https://campuscare-brown-two.vercel.app/?auth=recovery`

Password recovery still requires these settings. When confirmation is re-enabled, request a fresh confirmation email and verify that it ends at Login. An earlier invalid-token probe returned `http://localhost:3000`; the connected Supabase API cannot change URL Configuration.
