# CampusCare authentication email URLs

In Supabase, open **Authentication → URL Configuration** for project `hgmvlklvobkqhyvjnzmx`.

Set **Site URL** to:

`https://campuscare-brown-two.vercel.app/`

Add both of these to **Redirect URLs**, then save:

- `https://campuscare-brown-two.vercel.app/?auth=confirmed`
- `https://campuscare-brown-two.vercel.app/?auth=recovery`

The signup, verification resend and password-reset functions use these fixed production callbacks. Supabase must allow the URLs; otherwise it falls back to Site URL. An invalid-token redirect check on October 19, 2026 returned `http://localhost:3000`, so the project settings still need correction.

After saving, request a fresh verification email for an existing unconfirmed account. Confirming it must show CampusCare Login, with the account still pending clinic approval if it has not been approved. A password-reset link should open Create a New Password.

Unknown email addresses and usernames are rejected before either email function calls Supabase Auth. No production emails are sent by the automated tests.
